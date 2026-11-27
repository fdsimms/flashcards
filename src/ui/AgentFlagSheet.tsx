import React, { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AGENT_FLAG_REASONS, FLAG_NOTE_MAX, canFixNow, type AgentFlagReason } from '../core/agentFlag';
import { failureText } from '../core/failure';
import type { AskTurn } from '../core/askCard';
import { REPLY_MAX, followUpThread, threadAfter, type FixProposal } from '../core/fixCard';
import { Button, Chip, ErrorNote, Field, SheetHeader } from './kit';
import { radius, smooth, space, type, useTheme } from './theme';
import { AskingText } from './AskingText';
import { FixProposalView } from './FixProposalView';

/**
 * "Flag for Claude to check", shared by Review's menu and Trouble cards: a reason, and a note in the
 * user's own words about what to fix. It opens as iOS's page sheet over the card. `onSave` writes the
 * flag and throws when it can't, and the sheet says why and stays open; it closes itself after a save.
 * `onRemove` is present only when the card already has the purple flag. Closing it changes nothing.
 *
 * `fix` is present while Read & Listen is signed in: "Fix with Claude now" flags the card, asks the
 * server for a fix and shows it, each changed field old above new. Nothing is changed until Apply
 * (`onApply`, which also clears the flag); Not now leaves the card flagged for the MCP. Under a
 * proposal, "Reply to Claude" asks about it or pushes back: the flag, the suggestion and the reply go to the
 * server as a chat (`fix`'s third argument) and the answer replaces the proposal, with the reply shown above it.
 */
export function AgentFlagSheet({ word, reason: initialReason, note: initialNote, visible = true, onDismiss, onSave, onRemove, fix, onApply, onClose }: {
  /** The card's front, named in the heading. */
  word: string;
  /** What the card's note already says, when it's flagged. */
  reason?: AgentFlagReason | null;
  note?: string;
  /** False while the sheet is on its way out: it stays mounted until iOS reports it gone (`onDismiss`), as Review's other sheets do (src/core/sheetQueue.ts). */
  visible?: boolean;
  onDismiss?: () => void;
  onSave: (reason: AgentFlagReason, note: string) => Promise<void>;
  onRemove?: () => Promise<void>;
  /** Asks for a fix for the card as flagged; throws when it can't. */
  fix?: (reason: AgentFlagReason, note: string, thread?: AskTurn[]) => Promise<FixProposal>;
  /** Applies a proposal and clears the flag; throws when it can't. */
  onApply?: (proposal: FixProposal) => Promise<void>;
  onClose: () => void;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<AgentFlagReason>(initialReason ?? 'typo');
  const [note, setNote] = useState(initialNote ?? '');
  const [phase, setPhase] = useState<'form' | 'asking' | 'proposal'>('form');
  const [proposal, setProposal] = useState<FixProposal | null>(null);
  // The follow-up so far, as sent to the server: empty until the first reply, then ending with Claude's
  // latest suggestion. `lastReply` is the reply that suggestion answers, shown above it.
  const [thread, setThread] = useState<AskTurn[]>([]);
  const [reply, setReply] = useState('');
  const [lastReply, setLastReply] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = useRef(true);
  useEffect(() => () => { open.current = false; }, []);

  const run = async (what: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      if (open.current) setError(failureText(e, { what, next: 'Nothing was changed. Try again.' }));
    } finally {
      if (open.current) setBusy(false);
    }
  };

  const save = () => run("Couldn't flag this card.", async () => { await onSave(reason, note); onClose(); });
  const remove = () => run("Couldn't remove the flag.", async () => { await onRemove?.(); onClose(); });
  const apply = () => run("Couldn't apply this fix.", async () => { if (proposal) await onApply?.(proposal); onClose(); });

  // Flags the card first, so a fix that can't be had still leaves it for the MCP, then asks.
  const askForFix = async () => {
    if (busy || !fix) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(reason, note);
    } catch (e) {
      if (open.current) { setError(failureText(e, { what: "Couldn't flag this card.", next: 'Nothing was changed. Try again.' })); setBusy(false); }
      return;
    }
    if (!open.current) return;
    setPhase('asking');
    try {
      const got = await fix(reason, note);
      if (!open.current) return;
      setProposal(got);
      setPhase('proposal');
    } catch (e) {
      if (!open.current) return;
      setPhase('form');
      setError(failureText(e, { what: "Couldn't get a fix from Claude.", next: 'The card is still flagged. Try again, or ask Claude about it in a chat.' }));
    } finally {
      if (open.current) setBusy(false);
    }
  };

  const sendReply = async () => {
    if (busy || !fix || !proposal || !reply.trim()) return;
    const sent = followUpThread(thread, proposal, reply);
    const text = reply.trim();
    setBusy(true);
    setReplying(true);
    setError(null);
    try {
      const got = await fix(reason, note, sent);
      if (!open.current) return;
      setProposal(got);
      setThread(threadAfter(sent, got));
      setLastReply(text);
      setReply('');
    } catch (e) {
      if (open.current) setError(failureText(e, { what: "Couldn't get a reply from Claude.", next: 'Your reply is still in the box. Try again.' }));
    } finally {
      if (open.current) { setBusy(false); setReplying(false); }
    }
  };

  const asking = phase === 'asking';
  const fixable = !!fix && canFixNow(reason);
  const heading = phase === 'proposal'
    ? (proposal?.changes.length ? `Claude suggests ${proposal.changes.length === 1 ? 'one change' : `${proposal.changes.length} changes`}` : 'Claude found nothing to change')
    : asking ? null : word ? `Flag ${word} for Claude to check` : 'Flag for Claude to check';
  return (
    <Modal visible={visible} onDismiss={onDismiss} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!busy} onRequestClose={() => { if (!busy) onClose(); }} backdropColor={c.surface}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        style={{ flex: 1, backgroundColor: c.surface }}
        contentContainerStyle={{ paddingHorizontal: space.l, paddingTop: space.xl, paddingBottom: Math.max(insets.bottom, space.l), gap: space.m }}
      >
        <SheetHeader onClose={onClose} disabled={busy}>
          {heading === null ? <AskingText style={{ ...type.headline, color: c.text }} /> : <Text style={{ ...type.headline, color: c.text }}>{heading}</Text>}
          {phase === 'form' ? (
            <Text style={{ ...type.footnote, color: c.textSecondary }}>
              {fixable
                ? 'Claude can suggest a fix now, or check this card later when you ask in a chat. The card gets the purple flag either way.'
                : 'Claude checks this card when you ask in a chat, and suggests a fix for you to approve. The card gets the purple flag.'}
            </Text>
          ) : null}
        </SheetHeader>

        {phase === 'form' ? (
          <>
            <Text style={{ ...type.overline, color: c.textSecondary }}>What's wrong</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {AGENT_FLAG_REASONS.map((r) => <Chip key={r.slug} label={r.label} selected={reason === r.slug} onPress={() => setReason(r.slug)} />)}
            </View>
            <Field
              label="Note for Claude (optional)"
              value={note}
              onChangeText={setNote}
              placeholder="e.g. the word shouldn't be in its own definition"
              multiline
              maxLength={FLAG_NOTE_MAX}
            />
            <Text style={{ ...type.footnote, color: c.textSecondary }}>
              Up to {FLAG_NOTE_MAX} characters. Syncs to your other devices.
            </Text>
            {error ? <ErrorNote message={error} /> : null}
            {fixable ? (
              <>
                <Button label="Fix with Claude now" onPress={() => void askForFix()} busy={busy} />
                <Button label={onRemove ? 'Update flag for later' : 'Flag for later'} variant="secondary" onPress={() => void save()} disabled={busy} />
                <Text style={{ ...type.footnote, color: c.textSecondary }}>
                  Fixing now sends this note's text to Claude through Read & Listen's server and uses its Claude key. You approve any change before it's saved.
                </Text>
              </>
            ) : (
              <>
                <Button label={onRemove ? (fix ? 'Update flag for later' : 'Update flag') : (fix ? 'Flag for later' : 'Flag card')} onPress={() => void save()} busy={busy} />
                {fix ? (
                  <Text style={{ ...type.footnote, color: c.textSecondary }}>
                    Claude can't fix a recording here. Ask in a chat and it can record the text again with a voice.
                  </Text>
                ) : null}
              </>
            )}
            {onRemove ? <Button label="Remove flag" variant="destructive" onPress={() => void remove()} disabled={busy} /> : null}
            <Button label="Cancel" variant="secondary" onPress={onClose} disabled={busy} />
          </>
        ) : null}

        {asking ? (
          <>
            <Text style={{ ...type.subhead, color: c.textSecondary }}>{`Checking ${word || 'this card'} and your note. Closing this keeps the flag.`}</Text>
            <Button label="Close" variant="secondary" onPress={onClose} />
          </>
        ) : null}

        {phase === 'proposal' && proposal ? (
          <>
            {lastReply ? (
              <View style={{ alignSelf: 'flex-end', backgroundColor: c.accent, borderRadius: radius.l, ...smooth, paddingHorizontal: space.m, paddingVertical: space.s, maxWidth: '85%' }}>
                <Text style={{ ...type.subhead, color: c.onAccent }}>{lastReply}</Text>
              </View>
            ) : null}
            <FixProposalView proposal={proposal} />
            {fix ? (
              <>
                <Field
                  label="Reply to Claude"
                  value={reply}
                  onChangeText={setReply}
                  placeholder={'e.g. why did you drop "next"?'}
                  multiline
                  maxLength={REPLY_MAX}
                />
                <Button label="Send reply" variant="secondary" onPress={() => void sendReply()} busy={replying} disabled={busy || !reply.trim()} />
              </>
            ) : null}
            {error ? <ErrorNote message={error} /> : null}
            {proposal.changes.length ? (
              <>
                <Button label="Apply fix" onPress={() => void apply()} busy={busy && !replying} disabled={replying} />
                <Button label="Not now" variant="secondary" onPress={onClose} disabled={busy} />
                <Text style={{ ...type.footnote, color: c.textSecondary }}>
                  Applying also clears the flag. Replying sends your words and this suggestion to Claude through Read & Listen's server.
                </Text>
              </>
            ) : (
              <>
                <Text style={{ ...type.footnote, color: c.textSecondary }}>The card stays flagged. You can also ask Claude about it in a chat, or edit the note yourself.</Text>
                <Button label="Close" variant="secondary" onPress={onClose} disabled={busy} />
              </>
            )}
          </>
        ) : null}
      </ScrollView>
    </Modal>
  );
}
