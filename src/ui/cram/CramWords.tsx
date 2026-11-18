import React, { useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import type { NoteStore } from '../../anki/noteService';
import { cramNotes, cramTag, meaningOf, noteAddedAt } from '../../core/cram';
import { failureText } from '../../core/failure';
import { headword } from '../../core/forms';
import { noteHasTag } from '../../core/priority';
import type { Note } from '../../core/types';
import { haptic } from '../haptics';
import { Divider, Field, Icon, Loading, Screen } from '../kit';
import { MIN_TAP, readable, space, type, useTheme } from '../theme';
import { capCramCards, setCramTag, useCollection, useCrams } from '../useCrams';

/** How many notes the list shows at once: a search narrows it. */
const SHOWN = 80;

/**
 * Add words: every note in the collection, searched by its word or meaning, the most recently added
 * first. A tap adds the cram's tag to the note or takes it off; the check shows at once and is put
 * back, with the reason, if the note can't be saved.
 */
export function CramWords({ repo, id }: { repo: NoteStore; id: string }) {
  const c = useTheme();
  const { crams } = useCrams(repo);
  const collection = useCollection(repo);
  const cram = crams.find((x) => x.id === id);
  const [query, setQuery] = useState('');
  // What each tap asked for, shown until the notes are read again and agree; a note being saved
  // takes no second tap, so an add and a take-out of one note can't race.
  const [asked, setAsked] = useState<Map<string, boolean>>(new Map());
  const saving = useRef(new Set<string>());
  const [problem, setProblem] = useState<string>();

  const inCram = useMemo(() => new Set(cram ? cramNotes(cram, collection.notes).map((n) => n.id) : []), [cram, collection.notes]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = collection.notes.map((n) => ({ note: n, word: headword(n), meaning: meaningOf(n) }));
    const hits = q ? all.filter((r) => r.word.toLowerCase().includes(q) || r.meaning.toLowerCase().includes(q)) : all;
    return hits.sort((a, b) => noteAddedAt(b.note) - noteAddedAt(a.note)).slice(0, SHOWN);
  }, [collection.notes, query]);

  if (!cram || !collection.loaded) return <Screen title="Add words"><Loading /></Screen>;
  const tag = cramTag(cram);
  const checked = (note: Note) => asked.get(note.id) ?? inCram.has(note.id);
  const toggle = async (note: Note) => {
    if (saving.current.has(note.id)) return;
    const on = !checked(note);
    saving.current.add(note.id);
    haptic.select();
    setProblem(undefined);
    setAsked((p) => new Map(p).set(note.id, on));
    try {
      await setCramTag(repo, cram, [note.id], on);
      collection.reload();
      if (on) capCramCards(repo).catch(() => undefined);
    } catch (e) {
      setAsked((p) => { const next = new Map(p); next.delete(note.id); return next; });
      setProblem(failureText(e, { what: `Couldn't ${on ? 'add' : 'take out'} ${headword(note)}.`, next: 'Try again.' }));
    } finally {
      saving.current.delete(note.id);
    }
  };

  return (
    <Screen title="Add words" largeTitle={false}>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl }}
        ListHeaderComponent={(
          <View style={{ gap: space.s, paddingVertical: space.m }}>
            <Field label={`${inCram.size === 1 ? '1 word' : `${inCram.size} words`} in ${cram.name}`} value={query} onChangeText={setQuery} placeholder="Search by word or meaning" autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" />
            {problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text> : null}
          </View>
        )}
        data={rows}
        keyExtractor={(r) => r.note.id}
        renderItem={({ item, index }) => {
          const on = checked(item.note);
          return (
            <Pressable
              onPress={() => toggle(item.note)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${item.word}, ${item.meaning}`}
              style={({ pressed }) => ({
                minHeight: MIN_TAP + space.m, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s, paddingHorizontal: space.m,
                backgroundColor: pressed ? c.fill : c.surface,
              })}
            >
              {index === 0 ? null : <Divider inset={space.m} />}
              <Icon name={on ? 'checkmark.circle.fill' : 'circle'} size={22} color={on ? c.accent : c.textTertiary} weight="regular" />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ ...type.body, color: c.text }}>{item.word || 'Untitled'}</Text>
                <Text numberOfLines={1} style={{ ...type.footnote, color: c.textSecondary }}>{[item.meaning, item.note.deck.split('::').pop()].filter(Boolean).join(' · ')}</Text>
              </View>
              {noteHasTag(item.note, tag) !== on ? <Text style={{ ...type.caption, color: c.textSecondary }}>Saving</Text> : null}
            </Pressable>
          );
        }}
        ListFooterComponent={rows.length === SHOWN ? <Text style={{ ...type.footnote, color: c.textSecondary, paddingTop: space.m }}>{`Showing the ${SHOWN} most recently added. Search to find others.`}</Text> : undefined}
      />
    </Screen>
  );
}
