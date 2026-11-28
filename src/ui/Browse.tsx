import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { deleteNote, deleteNotes, type NoteStore } from '../anki/noteService';
import { browseProblem, parseSearch, readsAnswers } from '../core/ankiSearch';
import { cardHomeDeck } from '../core/deckTree';
import { browseSearch } from '../core/filteredDeck';
import { retrievability } from '../core/order';
import { paramsForDeck } from '../core/scheduler';
import { answersFrom } from '../core/stats';
import type { AnkiLink } from '../db/ankiLink';
import { failureText } from '../core/failure';
import { deckChipRows, deleteNotesWarning, deleteNoteWarning, matchesNoteFilter, NOTE_FILTERS, notePreview, notesStillThere, searchNotes, type NoteFilter } from '../core/noteEditing';
import { deleteNotesTitle } from '../core/selection';
import { markerText, noteMarkers, type NoteMarker } from '../core/noteMarkers';
import type { Card, Note } from '../core/types';
import { reviewWrites } from '../core/writeQueue';
import type { NoteEditorResult, NoteEditorTarget } from './AppContext';
import { Chip, Divider, EmptyState, ErrorNote, Icon, Loading, Screen, SwipeAction, SwipeToReveal } from './kit';
import { SelectBar } from './SelectBar';
import { useSelection } from './useSelection';
import { hairline, radius, smooth, space, type, useTheme, readable } from './theme';
import { useKeyboardScroll } from './useKeyboardScroll';
import { HoverPressable } from './hover';
import { BrowseNotePanel } from './BrowseNotePanel';
import { SIDE_PANEL_WIDTH, sidePanelFits } from '../core/wide';
import { withThaiLineHeight } from '../core/script';

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
 *
 * On a window wide enough for a panel beside the list (`sidePanelFits`), a tap picks the note and
 * shows it there instead (BrowseNotePanel.tsx), with Edit note to open the editor.
 */
export function Browse({ repo, onEditNote, onCardInfo, initialDeck }: { repo: NoteStore & Pick<AnkiLink, 'ankiReviewLog'>; onEditNote: (target: NoteEditorTarget, onClose: (result?: NoteEditorResult) => void) => void; /** Opens Card info on one of the picked note's cards (the wide window's panel). */ onCardInfo: (cardId: string) => void; initialDeck: string | null }) {
  const { bottomPadding } = useKeyboardScroll();
  const c = useTheme();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const router = useRouter();
  const [cards, setCards] = useState<{ byNote: Map<string, Card[]>; now: Date; dayStartsAtHour: number; retrievabilityOf: (card: Card) => number | undefined } | null>(null);
  // Every card's answers, read only once a search asks for them (`rated:`): Anki's review log and Franki's own.
  const [answers, setAnswers] = useState<Map<string, { at: number; ease: number }[]> | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<string | null>(initialDeck);
  const [filter, setFilter] = useState<NoteFilter | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // After the answers Review has shown but not yet written (src/core/writeQueue.ts).
      await reviewWrites.idle();
      const [loaded, all, { dayStartsAtHour }, params] = await Promise.all([repo.listNotes(), repo.listCards(), repo.collectionSettings(), repo.listDeckParams()]);
      const byNote = new Map<string, Card[]>();
      for (const card of all) byNote.set(card.noteId, [...(byNote.get(card.noteId) ?? []), card]);
      const now = new Date();
      const deckOfNote = new Map(loaded.map((n) => [n.id, n.deck]));
      // `prop:r`: by FSRS with the weights of the card's own deck.
      const retrievabilityOf = (card: Card) => retrievability(card, now, paramsForDeck(cardHomeDeck(card, deckOfNote.get(card.noteId) ?? ''), params)?.weights ?? []);
      setCards({ byNote, now, dayStartsAtHour, retrievabilityOf });
      setAnswers(null);
      setNotes(notesStillThere(loaded, all));
    } catch (e) {
      setError(failureText(e, { what: "Couldn't load your notes.", next: 'Try again.' }));
    }
  }, [repo]);
  useEffect(() => { load(); }, [load]);

  const parsedQuery = useMemo(() => parseSearch(query), [query]);
  const wantsAnswers = parsedQuery.ok && readsAnswers(parsedQuery.node);
  useEffect(() => {
    if (!wantsAnswers || answers) return;
    let live = true;
    (async () => {
      const [reviews, revlog, all] = await Promise.all([repo.listReviews(new Date(0)), repo.ankiReviewLog(new Date(0)), repo.listCards()]);
      const byCard = new Map<string, { at: number; ease: number }[]>();
      for (const a of answersFrom({ revlog, reviews, cards: all })) (byCard.get(a.cardId) ?? byCard.set(a.cardId, []).get(a.cardId)!).push({ at: a.at.getTime(), ease: a.rating });
      if (live) setAnswers(byCard);
    })().catch((e) => { if (live) setError(failureText(e, { what: "Couldn't load your answers for rated:.", next: 'Try again.' })); });
    return () => { live = false; };
  }, [wantsAnswers, answers, repo]);
  const chipRows = useMemo(() => deckChipRows(notes ?? [], scope), [notes, scope]);
  const found = useMemo(() => {
    if (!notes || !cards || (wantsAnswers && !answers)) return [];
    const matched = searchNotes(notes, query, scope, { ...cards, answersOf: answers ? (card) => answers.get(card.id) ?? [] : undefined });
    if (!filter) return matched;
    return matched.filter((n) => matchesNoteFilter(filter, n, cards.byNote.get(n.id) ?? [], cards.now, cards.dayStartsAtHour));
  }, [notes, cards, query, scope, filter, wantsAnswers, answers]);
  const searchProblem = useMemo(() => (parsedQuery.ok ? browseProblem(parsedQuery.node) ?? null : parsedQuery.error), [parsedQuery]);
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
  // A wide window: the note picked shows beside the list, while it's still among those found.
  const wide = sidePanelFits(useWindowDimensions().width);
  const [picked, setPicked] = useState<string | null>(null);
  const pickedNote = wide && picked ? found.find((n) => n.id === picked) : undefined;

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
          {!sel.selecting && !searchProblem && (query.trim() || scope || filter) ? (
            <Stack.Toolbar.Button
              icon="line.3.horizontal.decrease.circle"
              accessibilityLabel="Make a filtered deck from this search"
              onPress={() => { haptic.tap(); router.push({ pathname: '/filtered-deck', params: { search: browseSearch(query, scope, filter) } }); }}
            />
          ) : null}
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
        style={wide ? { marginRight: SIDE_PANEL_WIDTH } : undefined}
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
          <View style={{ paddingTop: space.xl }}><ErrorNote message={`Couldn't read the search. ${searchProblem}`} /></View>
        ) : query.trim() || filter ? (
          <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center', paddingTop: space.xl }}>
            {query.trim() ? `No notes match "${query.trim()}".\n${SYNTAX_HINT}` : 'No notes here match this filter.'}
          </Text>
        ) : (
          <View style={{ paddingTop: space.xl }}><EmptyState icon="rectangle.stack" title="No notes yet" body="Tap + to add one." /></View>
        )}
        renderItem={({ item, index }) => (
          <NoteRow
            note={item}
            markers={cards ? noteMarkers(item, cards.byNote.get(item.id) ?? [], cards.now, cards.dayStartsAtHour) : []}
            first={index === 0}
            last={index === found.length - 1}
            selecting={sel.selecting}
            selected={sel.selecting ? sel.selected.has(item.id) : pickedNote?.id === item.id}
            shows={wide}
            open={openNote === item.id}
            onOpenChange={(o) => setOpenNote(o ? item.id : null)}
            onDelete={() => confirmDelete(item)}
            // Tapping a row that's slid open closes it, rather than opening the note.
            onPress={() => (sel.selecting ? sel.toggle(item.id) : openNote === item.id ? setOpenNote(null) : wide ? setPicked(item.id) : edit({ noteId: item.id }))}
          />
        )}
      />
      {wide && cards ? (
        <BrowseNotePanel
          repo={repo}
          note={pickedNote}
          cards={pickedNote ? cards.byNote.get(pickedNote.id) ?? [] : []}
          now={cards.now}
          dayStartsAtHour={cards.dayStartsAtHour}
          onEdit={() => { if (pickedNote) edit({ noteId: pickedNote.id }); }}
          onDelete={() => { if (pickedNote) confirmDelete(pickedNote); }}
          onCardInfo={onCardInfo}
        />
      ) : null}
    </Screen>
  );
}

/**
 * A row of the card the notes sit on, drawn row by row (the list stays virtualized, so the card
 * can't be one view): the first and last round its corners, and every row but the first draws the
 * divider above it, as a `Group`'s rows do.
 */
function NoteRow({ note, markers, first, last, selecting, selected, shows, open, onOpenChange, onDelete, onPress }: {
  note: Note; markers: NoteMarker[]; first: boolean; last: boolean; /** Select mode: a circle leads the row, and the swipe is off. */ selecting: boolean; /** Checked in select mode; otherwise the note showing beside the list. */ selected: boolean; /** A tap shows the note beside the list (a wide window) rather than opening it. */ shows: boolean; open: boolean; onOpenChange: (open: boolean) => void; onDelete: () => void; onPress: () => void;
}) {
  const c = useTheme();
  const { front, back } = notePreview(note);
  const row = (
    <HoverPressable
      onPress={onPress}
      accessibilityRole={selecting ? 'checkbox' : 'button'}
      accessibilityState={selecting ? { checked: selected } : undefined}
      accessibilityLabel={[front || 'Empty note', back, note.deck, ...markers.map(markerText)].filter(Boolean).join(', ')}
      accessibilityHint={selecting ? undefined : shows ? 'Shows the note beside the list' : 'Opens the note to edit'}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m, paddingHorizontal: space.l, backgroundColor: pressed ? c.fill : selected ? c.accentFill : c.surface })}
    >
      {first ? null : <Divider inset={space.l} />}
      {selecting ? <Icon name={selected ? 'checkmark.circle.fill' : 'circle'} size={22} color={selected ? c.accent : c.textTertiary} weight="regular" /> : null}
      <View style={{ flex: 1, gap: space.xs }}>
        <Text numberOfLines={1} style={{ ...withThaiLineHeight(type.body, front), color: c.text }}>{front || '(empty)'}</Text>
        {back ? <Text numberOfLines={1} style={{ ...type.subhead, color: c.textSecondary }}>{back}</Text> : null}
        <Text numberOfLines={1} style={{ ...type.footnote, color: c.textSecondary }}>{note.deck}</Text>
        {markers.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.m, rowGap: space.xs, paddingTop: space.xs }}>
            {markers.map((m) => <MarkerChip key={`${m.kind}${m.flag ?? ''}`} marker={m} />)}
          </View>
        ) : null}
      </View>
    </HoverPressable>
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
      <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: dot }} />
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{markerText(marker)}</Text>
    </View>
  );
}
