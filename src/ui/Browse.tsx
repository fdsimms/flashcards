import { Stack } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import type { NoteStore } from '../anki/noteService';
import { deckChipRows, notePreview, searchNotes } from '../core/noteEditing';
import type { Note } from '../core/types';
import type { NoteEditorResult, NoteEditorTarget } from './AppContext';
import { Chip, Screen } from './kit';
import { hairline, space, type, useTheme } from './theme';
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

  const load = useCallback(async () => setNotes(await repo.listNotes()), [repo]);
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
        ItemSeparatorComponent={() => <View style={{ height: hairline, backgroundColor: c.border }} />}
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
        renderItem={({ item }) => <NoteRow note={item} onPress={() => edit({ noteId: item.id })} />}
      />
    </Screen>
  );
}

function NoteRow({ note, onPress }: { note: Note; onPress: () => void }) {
  const c = useTheme();
  const { front, back } = notePreview(note);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${front}, ${back}. Edit`}
      style={({ pressed }) => ({ paddingVertical: space.m, gap: 2, opacity: pressed ? 0.6 : 1 })}
    >
      <Text numberOfLines={1} style={{ ...type.body, color: c.text }}>{front || '(empty)'}</Text>
      {back ? <Text numberOfLines={1} style={{ ...type.subhead, color: c.textSecondary }}>{back}</Text> : null}
      <Text numberOfLines={1} style={{ ...type.footnote, color: c.textSecondary }}>{note.deck}</Text>
    </Pressable>
  );
}
