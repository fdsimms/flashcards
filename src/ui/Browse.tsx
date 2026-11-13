import { Stack } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import type { NoteStore } from '../anki/noteService';
import { failureText } from '../core/failure';
import { deckChipRows, notePreview, searchNotes } from '../core/noteEditing';
import type { Note } from '../core/types';
import type { NoteEditorResult, NoteEditorTarget } from './AppContext';
import { Chip, Divider, Loading, Screen } from './kit';
import { hairline, radius, smooth, space, type, useTheme } from './theme';
import { useKeyboardScroll } from './useKeyboardScroll';

/**
 * Every note, searchable and narrowed to a deck or any of its subdecks; tap one to edit it, or Add a new one.
 * Search matches every word in any field, a tag or the deck name (src/core/noteEditing.ts).
 */
export function Browse({ repo, onEditNote }: { repo: NoteStore; onEditNote: (target: NoteEditorTarget, onClose: (result?: NoteEditorResult) => void) => void }) {
  const { bottomPadding } = useKeyboardScroll();
  const c = useTheme();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setNotes(await repo.listNotes());
    } catch (e) {
      setError(failureText(e, { what: "Couldn't load your notes.", next: 'Try again.' }));
    }
  }, [repo]);
  useEffect(() => { load(); }, [load]);

  const chipRows = useMemo(() => deckChipRows(notes ?? [], scope), [notes, scope]);
  const found = useMemo(() => (notes ? searchNotes(notes, query, scope) : []), [notes, query, scope]);
  // The editor is a sheet over this screen; a saved or deleted note means the list is out of date.
  const edit = (target: NoteEditorTarget) => onEditNote(target, (result) => { if (result) load(); });

  return (
    <Screen
      title="Browse"
      toolbar={
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="plus" accessibilityLabel="Add a note" onPress={() => edit({ deck: scope })} />
        </Stack.Toolbar>
      }
    >
      <Stack.SearchBar placeholder="Words in a note, a tag or a deck" autoCapitalize="none" onChangeText={(e) => setQuery(e.nativeEvent.text)} />
      <FlatList
        data={found}
        keyExtractor={(n) => n.id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l + bottomPadding }}
        ListHeaderComponent={
          <View style={{ gap: space.s, paddingBottom: space.s }}>
            {chipRows.map((row, i) => (
              <ScrollView key={i} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }} keyboardShouldPersistTaps="handled">
                {row.map((chip) => <Chip key={chip.deck ?? '*'} label={chip.label} selected={chip.selected} onPress={() => setScope(chip.deck)} />)}
              </ScrollView>
            ))}
            {notes ? (
              <Text style={{ ...type.footnote, color: c.textSecondary }}>
                {found.length.toLocaleString()} {found.length === 1 ? 'note' : 'notes'}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={notes ? (
          <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center', paddingTop: space.xl }}>
            {query.trim() ? `No notes match "${query.trim()}".` : 'No notes yet. Tap + to add one.'}
          </Text>
        ) : <Loading error={error} onRetry={load} />}
        renderItem={({ item, index }) => <NoteRow note={item} first={index === 0} last={index === found.length - 1} onPress={() => edit({ noteId: item.id })} />}
      />
    </Screen>
  );
}

/**
 * A row of the card the notes sit on, drawn row by row (the list stays virtualized, so the card
 * can't be one view): the first and last round its corners, and every row but the first draws the
 * divider above it, as a `Group`'s rows do.
 */
function NoteRow({ note, first, last, onPress }: { note: Note; first: boolean; last: boolean; onPress: () => void }) {
  const c = useTheme();
  const { front, back } = notePreview(note);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[front || 'Empty note', back, note.deck].filter(Boolean).join(', ')}
      accessibilityHint="Opens the note to edit"
      style={({ pressed }) => ({
        paddingVertical: space.m, paddingHorizontal: space.l, gap: 2, backgroundColor: pressed ? c.fill : c.surface, ...smooth,
        borderColor: c.border, borderLeftWidth: hairline, borderRightWidth: hairline,
        borderTopWidth: first ? hairline : 0, borderBottomWidth: last ? hairline : 0,
        borderTopLeftRadius: first ? radius.l : 0, borderTopRightRadius: first ? radius.l : 0,
        borderBottomLeftRadius: last ? radius.l : 0, borderBottomRightRadius: last ? radius.l : 0,
      })}
    >
      {first ? null : <Divider inset={space.l} />}
      <Text numberOfLines={1} style={{ ...type.body, color: c.text }}>{front || '(empty)'}</Text>
      {back ? <Text numberOfLines={1} style={{ ...type.subhead, color: c.textSecondary }}>{back}</Text> : null}
      <Text numberOfLines={1} style={{ ...type.footnote, color: c.textSecondary }}>{note.deck}</Text>
    </Pressable>
  );
}
