import React, { useRef, useState } from 'react';
import { ActivityIndicator, Alert, LayoutAnimation, ScrollView, Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import { type NoteQueue, type QueuedNote } from '../../reader/api';
import type { HeldWords } from '../../reader/heldNotes';
import { counts, droppedNotice, firstReady, isRetrying, isWorking, needsChoice } from '../../reader/noteQueue';
import type { DroppedWord } from '../../reader/noteQueueStore';
import { haptic } from '../haptics';
import type { Approval } from '../useApproveQueued';
import { Button, ErrorNote, Group, Help, HeaderAction, Icon, Screen, SectionTitle, Tappable } from '../kit';
import { hairline, MIN_TAP, space, type, useTheme, readable } from '../theme';

/** Time for one note editor to finish closing before the next opens over it. */
const BETWEEN_EDITORS_MS = 400;

const STATUS = {
  ready: { icon: 'checkmark.circle.fill', label: 'Ready' },
  waiting: { icon: 'clock', label: 'Waiting' },
  failed: { icon: 'exclamationmark.triangle.fill', label: 'Failed' },
} as const;

/** A failed word the server will try again by itself: no button, since there's nothing to do yet. */
const RETRYING = { icon: 'clock', label: 'Trying again' } as const;

/** A ready note the deck refused when it was approved (a duplicate): shown instead of "Ready". */
const REFUSED = { icon: 'exclamationmark.triangle.fill', label: 'Not added' } as const;

/** A ready word that could be more than one word: opened to choose, and left out of Approve all. */
const CHOOSE = { icon: 'questionmark.circle.fill', label: 'Choose a word' } as const;

/** A note "Approve all" has saved, while the list holds still until the approval ends. */
const ADDED = { icon: 'checkmark.circle.fill', label: 'Added' } as const;

function NoteRow({ note, first, refusal, added, locked, pending, onOpen, onRetry, onRemove }: {
  note: QueuedNote;
  first: boolean;
  /** Why the deck refused this note the last time it was approved; it stays queued, marked, until it's opened or removed. */
  refusal?: string;
  /** Saved by "Approve all" while the list is held still: shown as "Added" until the approval ends and the row leaves. */
  added?: boolean;
  /** An approval is running: nothing on the row can be tapped. */
  locked?: boolean;
  /** A retry or removal for this word is waiting on the server: its buttons show it and can't be tapped again. */
  pending?: boolean;
  onOpen: () => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const c = useTheme();
  const choose = needsChoice(note);
  const retrying = isRetrying(note);
  const { icon, label } = added ? ADDED : refusal ? REFUSED : choose ? CHOOSE : retrying ? RETRYING : STATUS[note.state];
  const color = refusal ? c.danger : choose ? c.warningInk : note.state === 'ready' ? c.good : note.state === 'failed' && !retrying ? c.danger : c.textSecondary;
  const meaning = note.fields.Meaning ?? note.meaning;
  // A word typed the way it sounds shows how it's really written beside it.
  const word = note.spelling ? `${note.entry} → ${note.spelling}` : note.entry;
  return (
    <View style={{ borderTopWidth: first ? 0 : hairline, borderTopColor: c.border, opacity: added ? 0.55 : 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Tappable
          onPress={() => { haptic.tap(); onOpen(); }}
          disabled={note.state === 'waiting' || retrying || locked || pending}
          accessibilityRole="button"
          accessibilityLabel={`${note.spelling ? `${note.entry}, written ${note.spelling}` : note.entry}. ${meaning ? `${meaning}. ` : ''}${label}. ${note.state === 'ready' ? 'Review' : note.state === 'failed' && !retrying ? 'Fill in by hand' : ''}`}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: MIN_TAP + space.l, paddingVertical: space.m, paddingLeft: space.l }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ ...type.headline, color: c.text }}>{word}</Text>
            {meaning ? <Text numberOfLines={1} style={{ ...type.subhead, color: c.textSecondary }}>{meaning}</Text> : null}
            <Text numberOfLines={1} style={{ ...type.footnote, color: c.textTertiary }}>{note.deck}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Icon name={icon} size={16} color={color} />
            <Text style={{ ...type.footnote, color }}>{label}</Text>
          </View>
        </Tappable>
        <Tappable
          onPress={() => { haptic.tap(); onRemove(); }}
          disabled={locked || pending}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${note.entry} from the queue`}
          style={{ width: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}
        >
          {pending ? <ActivityIndicator size="small" color={c.textSecondary} /> : <Icon name="xmark" size={14} color={c.textSecondary} />}
        </Tappable>
      </View>
      {refusal ? (
        <View style={{ paddingHorizontal: space.l, paddingBottom: space.m }}>
          <Text style={{ ...type.footnote, color: c.danger }}>{refusal}</Text>
        </View>
      ) : null}
      {retrying ? (
        <View style={{ paddingHorizontal: space.l, paddingBottom: space.m }}>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>{note.error ? `${note.error.replace(/ Try again\.$/, '')} Claude will try again in a few minutes.` : 'Claude will try again in a few minutes.'}</Text>
        </View>
      ) : note.state === 'failed' ? (
        <View style={{ paddingHorizontal: space.l, paddingBottom: space.m, gap: space.s, alignItems: 'flex-start' }}>
          <Text style={{ ...type.footnote, color: c.danger }}>{note.error || "Couldn't fill this one in."}</Text>
          <HeaderAction label="Try again" onPress={onRetry} busy={pending} />
        </View>
      ) : null}
    </View>
  );
}

/** A word held on the phone while offline (heldNotes.ts): not on the server yet, so there's nothing to open. */
function HeldRow({ entry, meaning, deck, first, onRemove }: { entry: string; meaning: string; deck: string; first: boolean; onRemove: () => void }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: first ? 0 : hairline, borderTopColor: c.border }}>
      <View accessible accessibilityLabel={`${entry}. ${meaning ? `${meaning}. ` : ''}Not sent yet`} style={{ flex: 1, gap: 2, minHeight: MIN_TAP + space.l, paddingVertical: space.m, paddingLeft: space.l, justifyContent: 'center' }}>
        <Text style={{ ...type.headline, color: c.text }}>{entry}</Text>
        {meaning ? <Text numberOfLines={1} style={{ ...type.subhead, color: c.textSecondary }}>{meaning}</Text> : null}
        <Text numberOfLines={1} style={{ ...type.footnote, color: c.textTertiary }}>{deck}</Text>
      </View>
      <Tappable
        onPress={() => { haptic.tap(); onRemove(); }}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${entry}`}
        style={{ width: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="xmark" size={14} color={c.textSecondary} />
      </Tappable>
    </View>
  );
}

/**
 * The words in the note queue, by state. A ready note (or a failed one, to fill in by hand) opens in the
 * note editor with what Claude wrote in it; saving there is the approval, and the word leaves the queue
 * once it's saved. "Review" goes through the ready notes one after another until one is cancelled.
 * "Approve all" adds every ready note as written, after an alert naming how many. This screen writes
 * nothing to the deck itself: both ways save through its props (CLAUDE.md, Read & Listen).
 */
export function ReadNoteQueue({ queue, error, dropped, held, getItems, onReview, onApproveAll, onRetry, onRemove, onRemoveHeld, onRefresh }: {
  /** Null until the server has answered. */
  queue: NoteQueue | null;
  /** The last problem reaching the server, if the last ask failed. */
  error: string | null;
  /** Words taken off the queue because the deck already had them (useNoteQueue), said once here. */
  dropped: DroppedWord[];
  /** Words added while offline, sent to the server when the connection comes back (useNoteQueue). */
  held: HeldWords[];
  onRemoveHeld: (deck: string, entry: string) => void;
  /** The queue as it is now, since the screen's own copy is stale once an editor has closed. */
  getItems: () => QueuedNote[];
  /** Opens the note editor with the word filled in, resolving true once the note is saved. */
  onReview: (note: QueuedNote) => Promise<boolean>;
  /** Saves every ready note as it is and takes it off the queue (useApproveQueued); the alert asking first is this screen's. */
  onApproveAll: (notes: QueuedNote[], onProgress: (done: number, id: number, saved: boolean) => void) => Promise<Approval>;
  onRetry: (id: number) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
  onRefresh: () => void;
}) {
  const c = useTheme();
  const [problem, setProblem] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  /** Queue id to the reason the last "Approve all" didn't add it. Replaced on each approval. */
  const [refused, setRefused] = useState<Record<number, string>>({});
  const reviewing = useRef(false);
  /**
   * While "Approve all" runs, the ready notes as they were when it was tapped. The list shows these instead
   * of the live queue, so rows stay put (marked "Added" as they save) and the counts hold still, then the
   * saved ones leave together when the approval ends.
   */
  const [freeze, setFreeze] = useState<{ notes: QueuedNote[]; added: number[]; done: number } | null>(null);

  /** Queue ids with a retry or removal in flight, so a slow server shows on the row and a second tap does nothing. */
  const [pending, setPending] = useState<number[]>([]);

  /** `what` says what failed, e.g. "Couldn't remove kot from the queue." */
  const act = async (id: number, what: string, job: () => Promise<void>) => {
    if (pending.includes(id)) return;
    setProblem(null);
    setPending((p) => [...p, id]);
    try { await job(); } catch (e) { setProblem(failureText(e, { what, next: 'Try again.' })); }
    finally { setPending((p) => p.filter((x) => x !== id)); }
  };

  // `all` goes on through the ready notes after this one; a failed word filled in by hand is just itself.
  const review = async (first: QueuedNote, all: boolean) => {
    // A second tap while an editor is open would open another over it.
    if (reviewing.current) return;
    reviewing.current = true;
    setProblem(null);
    try {
      let note: QueuedNote | undefined = first;
      while (note) {
        const saved = await onReview(note);
        if (!saved) break;
        try {
          await onRemove(note.id);
        } catch {
          setProblem("Saved the note, but couldn't take it off the queue. Remove it from the list yourself.");
          break;
        }
        note = all ? firstReady(getItems()) : undefined;
        if (note) await new Promise((resolve) => setTimeout(resolve, BETWEEN_EDITORS_MS));
      }
    } finally {
      reviewing.current = false;
    }
  };

  // The alert names how many notes are added, and its button is the approval (useApproveQueued).
  const approveAll = () => {
    const ready = getItems().filter((x) => x.state === 'ready' && !(x.id in refused));
    // A word that could be more than one is the owner's to choose, so it's never approved unopened.
    const notes = ready.filter((x) => !needsChoice(x));
    const left = ready.length - notes.length;
    const leftLine = left === 1
      ? '1 word matches more than one entry, so it stays here until you open it and pick one.'
      : `${left} words each match more than one entry, so they stay here until you open each one and pick.`;
    if (!notes.length) {
      if (left) Alert.alert(left === 1 ? 'This word needs a choice' : 'These words need a choice', leftLine);
      return;
    }
    Alert.alert(
      notes.length === 1 ? 'Add 1 note to your deck?' : `Add ${notes.length} notes to your deck?`,
      `They're saved as Claude wrote them, without opening each one. To change one first, open it from the list instead.${left ? ` ${leftLine}` : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: notes.length === 1 ? 'Add 1 note' : `Add ${notes.length} notes`,
          onPress: async () => {
            if (reviewing.current) return;
            reviewing.current = true;
            setApproving(true);
            setProblem(null);
            setFreeze({ notes, added: [], done: 0 });
            try {
              const done = await onApproveAll(notes, (count, id, saved) => {
                setFreeze((f) => (f ? { ...f, done: count, added: saved ? [...f.added, id] : f.added } : f));
              });
              haptic.success();
              // The saved rows leave together, once, instead of one at a time as each is saved.
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setFreeze(null);
              setRefused(Object.fromEntries(done.refused.map((r) => [r.id, r.reason])));
              const lines = [
                ...(done.refused.length ? [`Added ${done.saved} of ${notes.length} notes. ${done.refused.length === 1 ? 'The one' : 'The ones'} that weren't added ${done.refused.length === 1 ? 'is' : 'are'} still queued, with the reason on ${done.refused.length === 1 ? 'its' : 'their'} row.`] : []),
                ...(done.stuck.length ? [`Saved ${done.stuck.join(', ')} but couldn't take ${done.stuck.length === 1 ? 'it' : 'them'} off the queue. Remove ${done.stuck.length === 1 ? 'it' : 'them'} from the list yourself.`] : []),
              ];
              if (lines.length) setProblem(lines.join('\n'));
            } catch (e) {
              setFreeze(null);
              setProblem(failureText(e, { what: "Couldn't add the notes.", next: 'Try again.' }));
            } finally {
              reviewing.current = false;
              setApproving(false);
            }
          },
        },
      ],
    );
  };

  const items = queue?.items ?? [];
  const n = counts(items);
  // During an approval the ready section shows the notes as they were when it started, not the shrinking queue.
  const readyRows = freeze ? freeze.notes : items.filter((x) => x.state === 'ready');
  const sections = [
    { key: 'ready', title: 'Ready to review', rows: readyRows },
    { key: 'waiting', title: 'Filling in', rows: items.filter(isWorking) },
    { key: 'failed', title: "Couldn't fill in", rows: items.filter((x) => x.state === 'failed' && !isRetrying(x)) },
  ].filter((s) => s.rows.length);
  const ready = freeze ? freeze.notes[0] : firstReady(items);
  // Approve all skips the notes the deck just refused; Review still opens them, to change the word.
  const approvable = items.filter((x) => x.state === 'ready' && !(x.id in refused)).length;

  return (
    <Screen
      title="Queued notes"
      footer={ready ? (
        <>
          <Button label={(freeze ? freeze.notes.length : n.ready) === 1 ? 'Review 1 note' : `Review ${freeze ? freeze.notes.length : n.ready} notes`} onPress={() => review(ready, true)} disabled={approving} />
          {approvable || freeze ? <Button variant="secondary" label={approvable === 1 ? 'Approve 1 note' : `Approve all ${approvable}`} onPress={approveAll} busy={approving} busyLabel={freeze ? `Adding ${Math.min(freeze.done + 1, freeze.notes.length)} of ${freeze.notes.length}` : undefined} /> : null}
        </>
      ) : undefined}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
        {queue && !queue.available ? (
          <ErrorNote message="Your Read & Listen server has no Claude key, so it can't fill in notes. Add the key to the server's settings, then try again." onRetry={onRefresh} />
        ) : null}
        {error ? <ErrorNote message={error} onRetry={onRefresh} /> : null}
        {problem ? <ErrorNote message={problem} /> : null}
        {droppedNotice(dropped).map((line) => <Help key={line}>{line}</Help>)}
        {!queue && !error ? <ActivityIndicator color={c.accent} style={{ padding: space.xl }} /> : null}
        {held.map((group, g) => (
          <View key={`held-${g}`} style={{ gap: space.s }}>
            <SectionTitle>{`${group.problem ? "Couldn't send to Claude" : 'Waiting to send'} (${group.entries.length})`}</SectionTitle>
            {group.problem ? <ErrorNote message={group.problem} /> : <Help>{"Couldn't reach your server when these were added. They go to Claude once it answers."}</Help>}
            <Group accessibilityRole="list">
              {group.entries.map((e, i) => (
                <HeldRow key={e.entry} entry={e.entry} meaning={e.meaning} deck={group.deck} first={i === 0} onRemove={() => onRemoveHeld(group.deck, e.entry)} />
              ))}
            </Group>
          </View>
        ))}
        {queue && !items.length && !held.length ? <Help>Nothing is queued. Use Quick add on the deck list to add words, and Claude fills in the rest.</Help> : null}
        {sections.map((section) => (
          <View key={section.key} style={{ gap: space.s }}>
            <SectionTitle>{`${section.title} (${section.rows.length})`}</SectionTitle>
            <Group accessibilityRole="list">
              {section.rows.map((note, i) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  first={i === 0}
                  refusal={freeze ? undefined : refused[note.id]}
                  added={freeze?.added.includes(note.id)}
                  locked={approving}
                  pending={pending.includes(note.id)}
                  onOpen={() => review(note, note.state === 'ready')}
                  onRetry={() => act(note.id, `Couldn't ask Claude again for ${note.entry}.`, () => onRetry(note.id))}
                  onRemove={() => act(note.id, `Couldn't remove ${note.entry} from the queue.`, () => onRemove(note.id))}
                />
              ))}
            </Group>
          </View>
        ))}
        {items.length ? <Help>Claude fills in new words within a few minutes. Nothing is added to your deck until you save it.</Help> : null}
      </ScrollView>
    </Screen>
  );
}
