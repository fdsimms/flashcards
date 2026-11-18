import React, { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AGENT_FLAG_REASONS, FLAG_NOTE_MAX, type AgentFlagReason } from '../core/agentFlag';
import { failureText } from '../core/failure';
import { Button, Chip, ErrorNote, Field } from './kit';
import { space, type, useTheme } from './theme';

/**
 * "Flag for Claude to check", shared by Review's menu and Trouble cards: a reason, and a note in the
 * user's own words about what to fix. It opens as iOS's page sheet over the card. `onSave` writes the
 * flag and throws when it can't, and the sheet says why and stays open. `onRemove` is present only
 * when the card already has the purple flag. Closing it changes nothing.
 */
export function AgentFlagSheet({ word, reason: initialReason, note: initialNote, visible = true, onDismiss, onSave, onRemove, onClose }: {
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
  onClose: () => void;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<AgentFlagReason>(initialReason ?? 'typo');
  const [note, setNote] = useState(initialNote ?? '');
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

  return (
    <Modal visible={visible} onDismiss={onDismiss} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!busy} onRequestClose={() => { if (!busy) onClose(); }} backdropColor={c.surface}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        style={{ flex: 1, backgroundColor: c.surface }}
        contentContainerStyle={{ paddingHorizontal: space.l, paddingTop: space.xl, paddingBottom: Math.max(insets.bottom, space.l), gap: space.m }}
      >
        <View style={{ gap: space.xs }}>
          <Text style={{ ...type.headline, color: c.text }}>{word ? `Flag ${word} for Claude to check` : 'Flag for Claude to check'}</Text>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>
            Claude finds this card through the Franki MCP, checks it and suggests a fix for you to approve. The card gets the purple flag.
          </Text>
        </View>
        <Text style={{ ...type.overline, color: c.textSecondary }}>What's wrong</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          {AGENT_FLAG_REASONS.map((r) => <Chip key={r.slug} label={r.label} selected={reason === r.slug} onPress={() => setReason(r.slug)} />)}
        </View>
        <Field
          label="Note for Claude (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="For example: the word shouldn't be in its own definition"
          multiline
          maxLength={FLAG_NOTE_MAX}
        />
        <Text style={{ ...type.footnote, color: c.textSecondary }}>
          Up to {FLAG_NOTE_MAX} characters. The note is saved with the card's tags and syncs to your other devices.
        </Text>
        {error ? <ErrorNote message={error} /> : null}
        <Button label={onRemove ? 'Update flag' : 'Flag card'} onPress={() => void run("Couldn't flag this card.", () => onSave(reason, note))} busy={busy} />
        {onRemove ? <Button label="Remove flag" variant="destructive" onPress={() => void run("Couldn't remove the flag.", onRemove)} disabled={busy} /> : null}
        <Button label="Cancel" variant="secondary" onPress={onClose} disabled={busy} />
      </ScrollView>
    </Modal>
  );
}
