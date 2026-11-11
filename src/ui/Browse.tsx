import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import type { NoteStore } from '../anki/noteService';
import { notePreview, searchNotes } from '../core/noteEditing';
import type { Note } from '../core/types';
import { Chip, Field, HeaderAction, Screen } from './kit';
import { NoteEditor } from './NoteEditor';
import { space, type, useTheme } from './theme';

/**
 * Every note, searchable and narrowed to a top-level deck; tap one to edit it, or Add a new one.
 * Search matches every word in any field, a tag or the deck name (src/core/noteEditing.ts).
 */
export function Browse({ repo, onDone }: { repo: NoteStore; onDone: () => void }) {
  const c = useTheme();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ noteId: string } | { deck: string | null } | null>(null);

  const load = useCallback(async () => setNotes(await repo.listNotes()), [repo]);
  useEffect(() => { load(); }, [load]);

  const tops = useMemo(() => [...new Set((notes ?? []).map((n) => n.deck.split('::')[0]))].sort((a, b) => a.localeCompare(b)), [notes]);
  const found = useMemo(() => (notes ? searchNotes(notes, query, scope) : []), [notes, query, scope]);

  return (
    <Screen onBack={onDone} title="Browse" right={<HeaderAction label="Add" onPress={() => setEditing({ deck: scope })} accessibilityLabel="Add a note" />}>
      <View style={{ paddingHorizontal: space.l, gap: space.s, paddingBottom: space.s }}>
        <Field label="Search" value={query} onChangeText={setQuery} placeholder="Words in a note, a tag or a deck" autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" />
        {tops.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }} keyboardShouldPersistTaps="handled">
            {[null, ...tops].map((d) => <Chip key={d ?? '*'} label={d ?? 'All decks'} selected={scope === d} onPress={() => setScope(d)} />)}
          </ScrollView>
        ) : null}
        {notes ? (
          <Text style={{ ...type.footnote, color: c.textSecondary }}>
            {found.length.toLocaleString()} {found.length === 1 ? 'note' : 'notes'}
          </Text>
        ) : null}
      </View>
      <FlatList
        data={found}
        keyExtractor={(n) => n.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l }}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: c.border }} />}
        renderItem={({ item }) => <NoteRow note={item} onPress={() => setEditing({ noteId: item.id })} />}
      />
      {editing ? (
        <NoteEditor
          repo={repo}
          target={editing}
          onClose={(result) => { setEditing(null); if (result) load(); }}
        />
      ) : null}
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
      <Text numberOfLines={1} style={{ ...type.footnote, color: c.textTertiary }}>{note.deck}</Text>
    </Pressable>
  );
}
