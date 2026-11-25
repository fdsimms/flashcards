import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ScrollView } from 'react-native';
import { failureText } from '../core/failure';
import { noteTypeSummary } from '../core/noteTypeEdits';
import type { NoteType } from '../core/types';
import type { Repo } from '../db/repo';
import { ErrorNote, Group, Help, Loading, NavRow, Screen, Section, SECTION_GAP } from './kit';
import { readable, space } from './theme';

/** Settings, Decks and cards, Note types: the collection's note types, each opening its own screen. */
export function NoteTypes({ repo, onOpen }: { repo: Repo; onOpen: (name: string) => void }) {
  const [rows, setRows] = useState<{ type: NoteType; notes: number }[]>();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Read each time the screen shows: a note type is changed on the screen over this one.
  useFocusEffect(useCallback(() => {
    let live = true;
    setError(null);
    Promise.all([repo.listNoteTypes(), repo.listNotes()]).then(([types, notes]) => {
      if (!live) return;
      const counts = new Map<string, number>();
      for (const n of notes) counts.set(n.model, (counts.get(n.model) ?? 0) + 1);
      setRows([...types.values()].sort((a, b) => a.name.localeCompare(b.name)).map((type) => ({ type, notes: counts.get(type.name) ?? 0 })));
    }).catch((e) => { if (live) setError(failureText(e, { what: "Couldn't load the note types.", next: 'Try again.' })); });
    return () => { live = false; };
  }, [repo, attempt]));

  return (
    <Screen title="Note types">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l, gap: SECTION_GAP, ...readable }}>
        <Section footer={rows?.length ? <Help>Change how a note type's cards look. Changes reach Anki at the next sync. Fields and card types are added in Anki.</Help> : undefined}>
          {error ? <ErrorNote message={error} onRetry={() => setAttempt((n) => n + 1)} /> : !rows ? <Loading /> : rows.length ? (
            <Group>
              {rows.map((r, i) => <NavRow key={r.type.name} first={i === 0} label={r.type.name} detail={noteTypeSummary(r.type, r.notes)} onPress={() => onOpen(r.type.name)} />)}
            </Group>
          ) : <Help>No note types yet. They come with a deck imported or synced from Anki.</Help>}
        </Section>
      </ScrollView>
    </Screen>
  );
}
