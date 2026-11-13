import React, { useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { failureText } from '../core/failure';
import { type NoteQueue, type QueuedNote } from '../reader/api';
import { counts, firstReady } from '../reader/noteQueue';
import { haptic } from './haptics';
import { Button, ErrorNote, Group, Help, HeaderAction, Icon, Screen, SectionTitle, Tappable } from './kit';
import { hairline, MIN_TAP, space, type, useTheme } from './theme';

/** Time for one note editor to finish closing before the next opens over it. */
const BETWEEN_EDITORS_MS = 400;

const STATUS = {
  ready: { icon: 'checkmark.circle.fill', label: 'Ready' },
  waiting: { icon: 'clock', label: 'Waiting' },
  failed: { icon: 'exclamationmark.triangle.fill', label: 'Failed' },
} as const;

function NoteRow({ note, first, onOpen, onRetry, onRemove }: {
  note: QueuedNote;
  first: boolean;
  onOpen: () => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const c = useTheme();
  const { icon, label } = STATUS[note.state];
  const color = note.state === 'ready' ? c.good : note.state === 'failed' ? c.danger : c.textSecondary;
  const meaning = note.fields.Meaning ?? note.meaning;
  return (
    <View style={{ borderTopWidth: first ? 0 : hairline, borderTopColor: c.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Tappable
          onPress={onOpen}
          disabled={note.state === 'waiting'}
          accessibilityRole="button"
          accessibilityLabel={`${note.entry}. ${meaning ? `${meaning}. ` : ''}${label}. ${note.state === 'ready' ? 'Review' : note.state === 'failed' ? 'Fill in by hand' : ''}`}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: MIN_TAP + space.l, paddingVertical: space.m, paddingLeft: space.l }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ ...type.headline, color: c.text }}>{note.entry}</Text>
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
          accessibilityRole="button"
          accessibilityLabel={`Remove ${note.entry} from the queue`}
          style={{ width: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="xmark" size={14} color={c.textSecondary} />
        </Tappable>
      </View>
      {note.state === 'failed' ? (
        <View style={{ paddingHorizontal: space.l, paddingBottom: space.m, gap: space.s, alignItems: 'flex-start' }}>
          <Text style={{ ...type.footnote, color: c.danger }}>{note.error || "Couldn't fill this one in."}</Text>
          <HeaderAction label="Try again" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The words in the note queue, by state. A ready note (or a failed one, to fill in by hand) opens in the
 * note editor with what Claude wrote in it; saving there is the approval, and the word leaves the queue
 * once it's saved. "Review" goes through the ready notes one after another until one is cancelled. This
 * screen writes nothing to the deck itself (CLAUDE.md, Read & Listen).
 */
export function ReadNoteQueue({ queue, error, getItems, onReview, onRetry, onRemove, onRefresh }: {
  /** Null until the server has answered. */
  queue: NoteQueue | null;
  /** The last problem reaching the server, if the last ask failed. */
  error: string | null;
  /** The queue as it is now, since the screen's own copy is stale once an editor has closed. */
  getItems: () => QueuedNote[];
  /** Opens the note editor with the word filled in, resolving true once the note is saved. */
  onReview: (note: QueuedNote) => Promise<boolean>;
  onRetry: (id: number) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
  onRefresh: () => void;
}) {
  const c = useTheme();
  const [problem, setProblem] = useState<string | null>(null);
  const reviewing = useRef(false);

  const act = async (job: () => Promise<void>) => {
    setProblem(null);
    try { await job(); } catch (e) { setProblem(failureText(e, { what: "That didn't work.", next: 'Try again.' })); }
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

  const items = queue?.items ?? [];
  const n = counts(items);
  const sections = [
    { key: 'ready', title: 'Ready to review', rows: items.filter((x) => x.state === 'ready') },
    { key: 'waiting', title: 'Filling in', rows: items.filter((x) => x.state === 'waiting') },
    { key: 'failed', title: "Couldn't fill in", rows: items.filter((x) => x.state === 'failed') },
  ].filter((s) => s.rows.length);
  const ready = firstReady(items);

  return (
    <Screen
      title="Queued notes"
      footer={ready ? <Button label={n.ready === 1 ? 'Review 1 note' : `Review ${n.ready} notes`} onPress={() => review(ready, true)} /> : undefined}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
        {queue && !queue.available ? (
          <ErrorNote message="Claude isn't set up on the server, so notes can't be filled in. Add its key to the server's .env, then try again." onRetry={onRefresh} />
        ) : null}
        {error ? <ErrorNote message={error} onRetry={onRefresh} /> : null}
        {problem ? <ErrorNote message={problem} /> : null}
        {!queue && !error ? <ActivityIndicator color={c.textSecondary} style={{ padding: space.xl }} /> : null}
        {queue && !items.length ? <Help>Nothing is queued. Use Quick add on the deck list to add words, and Claude fills in the rest.</Help> : null}
        {sections.map((section) => (
          <View key={section.key} style={{ gap: space.s }}>
            <SectionTitle>{`${section.title} (${section.rows.length})`}</SectionTitle>
            <Group accessibilityRole="list">
              {section.rows.map((note, i) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  first={i === 0}
                  onOpen={() => review(note, note.state === 'ready')}
                  onRetry={() => act(() => onRetry(note.id))}
                  onRemove={() => act(() => onRemove(note.id))}
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
