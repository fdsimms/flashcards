import { Stack } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { deleteNote, deleteNotes, type NoteStore } from '../anki/noteService';
import { parseSearch } from '../core/ankiSearch';
import { failureText } from '../core/failure';
import { deckChipRows, deleteNotesWarning, deleteNoteWarning, matchesNoteFilter, NOTE_FILTERS, notePreview, notesStillThere, searchNotes, type NoteFilter } from '../core/noteEditing';
import { deleteNotesTitle } from '../core/selection';
import { markerText, noteMarkers, type NoteMarker } from '../core/noteMarkers';
import type { Card, Note } from '../core/types';
import { reviewWrites } from '../core/writeQueue';
import type { NoteEditorResult, NoteEditorTarget } from './AppContext';
import { Chip, Divider, Icon, Loading, Screen, SwipeAction, SwipeToReveal } from './kit';
import { SelectBar } from './SelectBar';
import { useSelection } from './useSelection';
import { hairline, radius, smooth, space, type, useTheme, readable } from './theme';
import { useKeyboardScroll } from './useKeyboardScroll';

/** What the empty list says the search box takes, besides words. */
const SYNTAX_HINT = 'Search also takes Anki\'s syntax, e.g. deck:Polski, tag:verb, note:Basic, is:new, flag:1, added:7, Front:kot*, "or", "-" for not, and parentheses.';

/**
 * Every note, searchable and narrowed to a deck or any of its subdecks, and to a state its cards
 * are in (new, due today, a leech, suspended, flagged); tap one to edit it, or Add a new one. A swipe
 * on a row deletes the note (after asking), as the editor's Delete does.
 * Search reads Anki's syntax (deck:, tag:, is:due, flag:1, or, -; src/core/ankiSearch.ts), and a
 * plain word matches in any field, a tag or the deck name, closest matches first (a word on the
 * front, then in the meaning, then elsewhere; src/core/noteEditing.ts). A search that can't be
 * read says why where the list would be. A row says when its
 * cards are suspended, buried, flagged or the note is a leech (src/core/noteMarkers.ts).
 */
export function Browse({ repo, onEditNote, initialDeck }: { repo: NoteStore; onEditNote: (target: NoteEditorTarget, onClose: (result?: NoteEditorResult) => void) => void; initialDeck: string | null }) {
  const { bottomPadding } = useKeyboardScroll();
  const c = useTheme();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [cards, setCards] = useState<{ byNote: Map<string, Card[]>; now: Date; dayStartsAtHour: number } | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<string | null>(initialDeck);
  const [filter, setFilter] = useState<NoteFilter | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // After the answers Review has shown but not yet written (src/core/writeQueue.ts).
      await reviewWrites.idle();
      const [loaded, all, { dayStartsAtHour }] = await Promise.all([repo.listNotes(), repo.listCards(), repo.collectionSettings()]);
      const byNote = new Map<string, Card[]>();
      for (const card of all) byNote.set(card.noteId, [...(byNote.get(card.noteId) ?? []), card]);
      setCards({ byNote, now: new Date(), dayStartsAtHour });
      setNotes(notesStillThere(loaded, all));
    } catch (e) {
      setError(failureText(e, { what: "Couldn't load your notes.", next: 'Try again.' }));
    }
  }, [repo]);
  useEffect(() => { load(); }, [load]);

  const chipRows = useMemo(() => deckChipRows(notes ?? [], scope), [notes, scope]);
  const found = useMemo(() => {
    if (!notes || !cards) return [];
    const matched = searchNotes(notes, query, scope, cards);
    if (!filter) return matched;
    return matched.filter((n) => matchesNoteFilter(filter, n, cards.byNote.get(n.id) ?? [], cards.now, cards.dayStartsAtHour));
  }, [notes, cards, query, scope, filter]);
  const searchProblem = useMemo(() => { const p = parseSearch(query); return p.ok ? null : p.error; }, [query]);
  // The editor is a sheet over this screen; a saved or deleted note means the list is out of date.
  // The row slid open on its Delete action; one at a time.
  const [openNote, setOpenNote] = useState<string | null>(null);
  const confirmDelete = (note: Note) => Alert.alert('Delete this note?', deleteNoteWarning(cards?.byNote.get(note.id)?.length ?? 2), [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete', style: 'destructive',
      onPress: async () => {
        try {
          await deleteNote(repo, note.id);
          setNotes((all) => (all ? all.filter((n) => n.id !== note.id) : all));
        } catch (e) {
          Alert.alert("Couldn't delete the note", failureText(e, { next: 'Try again.' }));
        }
      },
    },
  ]);
  const foundIds = useMemo(() => found.map((n) => n.id), [found]);
  const sel = useSelection(foundIds);
  const deleteSelected = () => {
    const picked = [...sel.selected];
    const cardCount = picked.reduce((n, id) => n + (cards?.byNote.get(id)?.length ?? 0), 0);
    Alert.alert(deleteNotesTitle(picked.length), deleteNotesWarning(cardCount), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const { deleted, failed, error } = await deleteNotes(repo, picked);
          const gone = new Set(deleted);
          setNotes((all) => (all ? all.filter((n) => !gone.has(n.id)) : all));
          if (failed.length) Alert.alert(`Couldn't delete ${failed.length === 1 ? '1 note' : `${failed.length} notes`}`, failureText(error, { next: 'They are still selected. Try again.' }));
          else sel.stop();
        },
      },
    ]);
  };
  const edit = (target: NoteEditorTarget) => onEditNote(target, (result) => { if (result) load(); });

  return (
    <Screen
      title="Browse"
      footer={sel.selecting ? (
        <SelectBar count={sel.selected.size} total={found.length} onSelectAll={() => sel.selectAll(foundIds)} onClear={sel.clear} actions={[{ label: 'Delete notes', hint: 'Asks first', destructive: true, onPress: deleteSelected }]} />
      ) : undefined}
      toolbar={
        <Stack.Toolbar placement="right">
          {sel.selecting ? <Stack.Toolbar.Button accessibilityLabel="Done selecting" onPress={sel.stop}>Done</Stack.Toolbar.Button> : null}
          {!sel.selecting && found.length ? <Stack.Toolbar.Button accessibilityLabel="Select notes" onPress={sel.start}>Select</Stack.Toolbar.Button> : null}
          {!sel.selecting ? <Stack.Toolbar.Button icon="plus" accessibilityLabel="Add a note" onPress={() => edit({ deck: scope })} /> : null}
        </Stack.Toolbar>
      }
    >
      <Stack.SearchBar placeholder="Words, or e.g. deck:Polski is:due" autoCapitalize="none" onChangeText={(e) => setQuery(e.nativeEvent.text)} />
      <FlatList
        data={found}
        keyExtractor={(n) => n.id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l + bottomPadding }}
        ListHeaderComponent={
          <View style={{ gap: space.s, paddingBottom: space.s }}>
            {chipRows.map((row, i) => (
              <ScrollView key={i} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }} keyboardShouldPersistTaps="handled">
                {row.map((chip) => <Chip key={chip.deck ?? '*'} label={chip.label} selected={chip.selected} onPress={() => setScope(chip.deck)} />)}
              </ScrollView>
            ))}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }} keyboardShouldPersistTaps="handled">
              {[{ value: null, label: 'Any' }, ...NOTE_FILTERS].map((f) => (
                <Chip key={f.value ?? '*'} label={f.label} selected={filter === f.value} onPress={() => setFilter(f.value)} />
              ))}
            </ScrollView>
            {notes ? (
              <Text style={{ ...type.footnote, color: c.textSecondary }}>
                {found.length.toLocaleString()} {found.length === 1 ? 'note' : 'notes'}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={!notes ? <Loading error={error} onRetry={load} /> : searchProblem ? (
          <Text style={{ ...type.subhead, color: c.danger, paddingTop: space.xl }}>{`Couldn't read the search. ${searchProblem}`}</Text>
        ) : (
          <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center', paddingTop: space.xl }}>
            {query.trim() ? `No notes match "${query.trim()}".\n${SYNTAX_HINT}` : filter ? 'No notes here match this filter.' : 'No notes yet. Tap + to add one.'}
          </Text>
        )}
        renderItem={({ item, index }) => (
          <NoteRow
            note={item}
            markers={cards ? noteMarkers(item, cards.byNote.get(item.id) ?? [], cards.now, cards.dayStartsAtHour) : []}
            first={index === 0}
            last={index === found.length - 1}
            selecting={sel.selecting}
            selected={sel.selected.has(item.id)}
            open={openNote === item.id}
            onOpenChange={(o) => setOpenNote(o ? item.id : null)}
            onDelete={() => confirmDelete(item)}
            // Tapping a row that's slid open closes it, rather than opening the note.
            onPress={() => (sel.selecting ? sel.toggle(item.id) : openNote === item.id ? setOpenNote(null) : edit({ noteId: item.id }))}
          />
        )}
      />
    </Screen>
  );
}

/**
 * A row of the card the notes sit on, drawn row by row (the list stays virtualized, so the card
 * can't be one view): the first and last round its corners, and every row but the first draws the
 * divider above it, as a `Group`'s rows do.
 */
function NoteRow({ note, markers, first, last, selecting, selected, open, onOpenChange, onDelete, onPress }: {
  note: Note; markers: NoteMarker[]; first: boolean; last: boolean; /** Select mode: a circle leads the row, and the swipe is off. */ selecting: boolean; selected: boolean; open: boolean; onOpenChange: (open: boolean) => void; onDelete: () => void; onPress: () => void;
}) {
  const c = useTheme();
  const { front, back } = notePreview(note);
  const row = (
    <Pressable
      onPress={onPress}
      accessibilityRole={selecting ? 'checkbox' : 'button'}
      accessibilityState={selecting ? { checked: selected } : undefined}
      accessibilityLabel={[front || 'Empty note', back, note.deck, ...markers.map(markerText)].filter(Boolean).join(', ')}
      accessibilityHint={selecting ? undefined : 'Opens the note to edit'}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m, paddingHorizontal: space.l, backgroundColor: pressed ? c.fill : selected ? c.accentFill : c.surface })}
    >
      {first ? null : <Divider inset={space.l} />}
      {selecting ? <Icon name={selected ? 'checkmark.circle.fill' : 'circle'} size={22} color={selected ? c.accent : c.textTertiary} weight="regular" /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ ...type.body, color: c.text }}>{front || '(empty)'}</Text>
        {back ? <Text numberOfLines={1} style={{ ...type.subhead, color: c.textSecondary }}>{back}</Text> : null}
        <Text numberOfLines={1} style={{ ...type.footnote, color: c.textSecondary }}>{note.deck}</Text>
        {markers.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.m, rowGap: space.xs, paddingTop: space.xs }}>
            {markers.map((m) => <MarkerChip key={`${m.kind}${m.flag ?? ''}`} marker={m} />)}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
  // The card's edges and corners are on the wrapper, which clips the Delete action sliding out
  // from under the row, so it never pokes past a rounded corner.
  return (
    <View
      style={{
        overflow: 'hidden', ...smooth, borderColor: c.border, borderLeftWidth: hairline, borderRightWidth: hairline,
        borderTopWidth: first ? hairline : 0, borderBottomWidth: last ? hairline : 0,
        borderTopLeftRadius: first ? radius.l : 0, borderTopRightRadius: first ? radius.l : 0,
        borderBottomLeftRadius: last ? radius.l : 0, borderBottomRightRadius: last ? radius.l : 0,
      }}
    >
      {selecting ? row : (
        <SwipeToReveal
          open={open}
          onOpenChange={onOpenChange}
          onFullSwipe={onDelete}
          action={<SwipeAction destructive icon="trash" label="Delete" accessibilityLabel={`Delete ${front || 'empty note'}`} onPress={() => { onOpenChange(false); onDelete(); }} />}
        >
          {row}
        </SwipeToReveal>
      )}
    </View>
  );
}

/**
 * One state marker: a colored dot and its word, so color is never the only signal (the same
 * pill shape as the card state chips on the review screen). Suspended is gray, a bury violet, a
 * leech amber, and a flag the flag's own color.
 */
function MarkerChip({ marker }: { marker: NoteMarker }) {
  const c = useTheme();
  const dot = marker.kind === 'suspended' ? c.textTertiary : marker.kind === 'buried' ? c.violet : marker.kind === 'leech' ? c.warning : c.flags[marker.flag ?? 0];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{markerText(marker)}</Text>
    </View>
  );
}
