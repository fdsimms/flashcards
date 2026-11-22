import { Stack, usePreventRemove } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View, type TextInputInstance } from 'react-native';
import { cardsFor, deleteNote, saveNote, setCardStates, type NoteStore } from '../anki/noteService';
import { cardStateOf, FLAG_NAMES, type CardState } from '../core/cardState';
import { runningCramTags, type Cram } from '../core/cram';
import { omnilanguageFieldNames } from '../import/models';
import { readerLanguageOf } from '../core/leechHint';
import { untiered } from '../core/deckTree';
import { failureText, NOT_IN_ANKI } from '../core/failure';
import type { AnkiLink } from '../db/ankiLink';
import { isOmnilanguage } from '../core/cards';
import { clearFormatting, formattedRuns, hasFormatting, toggleMark, type Mark, type Selection } from '../core/formatting';
import { applyTagSuggestion, canAddAnother, clozeChoices, nextNoteFields, typedTag, wrapCloze } from '../core/noteDrafting';
import { suggestTags, tagCounts } from '../core/priority';
import { addDraftChanged, asEdited, checksDuplicate, deleteNoteWarning, duplicateOf, editTextToField, fieldToEditText, notesStillThere, parseTags, startNoteFor } from '../core/noteEditing';
import type { WordChoice } from '../core/quickAdd';
import type { Note, NoteType } from '../core/types';
import { reviewWrites } from '../core/writeQueue';
import type { NoteEditorResult } from './AppContext';
import type { RecordDeps, Recording } from '../anki/recordService';
import { Button, Card, Chip, Field, Help, Loading, Screen, Select } from './kit';
import { afterSave, RecordAudio, useVoiceSettings } from './RecordAudio';
import { radius, smooth, space, type, useTheme, readable } from './theme';
import { useHeaderInset } from './useHeaderInset';
import { useKeyboardScroll } from './useKeyboardScroll';
import { cramsNow, loadCrams } from './useCrams';
import { WordChoiceCard } from './WordChoice';

const OMNI_CARD_NAMES: Record<string, string> = { forward: 'Front', reverse: 'Reverse', audio: 'Audio' };
const MARK_LABELS: Record<Mark, string> = { b: 'Bold', i: 'Italic', u: 'Underline' };
const TAG_SUGGESTIONS = 6;

/**
 * Adding or editing a note, as a sheet over whatever opened it (Review, Browse), so that screen
 * keeps its place. Saving goes through the note service, which also writes the change into the
 * Anki collection; Delete removes the note there too. With changes made, leaving any way (Cancel
 * or a swipe down) asks first.
 */
export function NoteEditor(props: {
  repo: NoteStore & Pick<AnkiLink, 'setAnkiCardStates'>;
  /**
   * Edit this note, or add one (starting in `deck`, and with `model` and `fields` filled in when
   * given, as Read & Listen's marked words do). `fieldNotes` is a line under a field to check
   * before saving ("Written by AI"), by field name. `tags` start the new note's Tags field. `choice`:
   * a queued word that could be more than one word, asked above the fields (WordChoice.tsx).
   */
  target: { noteId: string } | { deck: string | null; model?: string; fields?: Record<string, string>; fieldNotes?: Record<string, string>; tags?: string[]; choice?: WordChoice };
  onClose: (result?: NoteEditorResult) => void;
  /** A card was unsuspended, unburied or unflagged here, which stands whether or not the note is saved. */
  onCardsChanged?: () => void;
  /** Every deck on the deck list, empty ones included, so a deck just made can be picked. */
  decks?: string[];
  /** Recording audio with an Azure voice (useRecorder); null while Read & Listen is off. */
  recorder?: RecordDeps | null;
  /** A note saved with Save and add another, while the editor stays open for the next one. */
  onSaved?: (note: Note) => void;
}) {
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const c = useTheme();
  const [notes, setNotes] = useState<Note[]>([]);
  const [filteredDecks, setFilteredDecks] = useState<Set<string>>(new Set());
  const [noteTypes, setNoteTypes] = useState<Map<string, NoteType>>(new Map());
  const [original, setOriginal] = useState<Note>();
  const [deck, setDeck] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [tags, setTags] = useState('');
  // What a note being added opened with (filled in by Read & Listen or a cram), so opening it isn't a change.
  const [start, setStart] = useState<{ fields: Record<string, string>; tags: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Until the note (or, adding one, the decks and note types) is in, the form isn't shown.
  const [loaded, setLoaded] = useState(false);
  /** Adding a note: the running crams, and the language and tags the crams' tags were last worked out for. */
  const cramContext = useRef<{ crams: Cram[]; notes: Note[]; hour: number; language: ReturnType<typeof readerLanguageOf>; tags: string[] }>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The note's cards, for undoing a suspend, bury or flag set while studying.
  const [noteCardList, setNoteCardList] = useState<CardRow[]>([]);
  const [dayStartsAtHour, setDayStartsAtHour] = useState(4);
  const editing = 'noteId' in props.target;
  // The field being typed in, its selection, and each field's input, for the formatting buttons.
  const [focused, setFocused] = useState<string | null>(null);
  const selections = useRef(new Map<string, Selection>());
  const inputs = useRef(new Map<string, TextInputInstance | null>());
  const voiceSettings = useVoiceSettings(props.repo);
  // A recording made here (Record audio), sent once the note is saved with it.
  const [recording, setRecording] = useState<Recording>();
  // Save and add another (a note started from nothing): the fields kept for the next note, and how many were added.
  const addAnother = canAddAnother(props.target);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState(0);
  const [tagsFocused, setTagsFocused] = useState(false);

  const format = (name: string, apply: (text: string, sel: Selection) => { text: string; selection: Selection }) => {
    const text = fields[name] ?? '';
    const sel = selections.current.get(name) ?? { start: text.length, end: text.length };
    const out = apply(text, sel);
    setFields((f) => ({ ...f, [name]: out.text }));
    selections.current.set(name, out.selection);
    // After the new text renders, select what was selected, so a second tap undoes the first.
    requestAnimationFrame(() => inputs.current.get(name)?.setSelection(out.selection.start, out.selection.end));
  };

  useEffect(() => {
    setLoadError(null);
    (async () => {
      // An answer still being written can tag the note a leech; read before it lands, a save here
      // would write the tags as they were and drop the tag.
      await reviewWrites.idle();
      const [all, types, params, cards] = await Promise.all([props.repo.listNotes(), props.repo.listNoteTypes(), props.repo.listDeckParams(), props.repo.listCards()]);
      // Not a note deleted in Anki: it isn't a duplicate of anything anymore.
      setNotes(notesStillThere(all, cards));
      setNoteTypes(types);
      // A filtered deck borrows cards and holds no notes of its own, so a note can't go in one.
      setFilteredDecks(new Set([...params].filter(([, p]) => p.filtered).map(([d]) => d)));
      if ('noteId' in props.target) {
        const n = all.find((x) => x.id === (props.target as { noteId: string }).noteId);
        if (!n) { setMissing(true); setLoaded(true); return; }
        const cs = await props.repo.collectionSettings();
        setDayStartsAtHour(cs.dayStartsAtHour);
        setNoteCardList(cards.filter((x) => x.noteId === n.id && !x.retired));
        setOriginal(n);
        setDeck(n.deck);
        setModel(n.model);
        setFields(Object.fromEntries(Object.entries(n.fields).map(([k, v]) => [k, fieldToEditText(v)])));
        setTags(n.tags.join(' '));
      } else {
        // Start in the deck asked for, else the first the Deck picker lists (never a blank one), with
        // the note type its notes use most, or a new deck's language (`startNoteFor`).
        const filtered = new Set([...params].filter(([, p]) => p.filtered).map(([d]) => d));
        const listed = [...new Set([...all.map((n) => untiered(n.deck)), ...(props.decks ?? []).filter((d) => !filtered.has(d))])].sort((a, b) => a.localeCompare(b));
        const startDeck = props.target.deck ?? listed[0] ?? '';
        const own = await props.repo.listDeckSettings();
        const begun = startNoteFor(all, [...types.keys()], startDeck, own.get(startDeck));
        setDeck(startDeck);
        const asked = props.target.model;
        const askedKnown = !!asked && (types.has(asked) || all.some((n) => n.model === asked));
        const startModel = askedKnown ? asked : begun.model;
        setModel(startModel);
        const startFields = { ...(askedKnown ? {} : begun.fields), ...(props.target.fields ?? {}) };
        if (Object.keys(startFields).length) setFields(startFields);
        // What the deck filled in (its language, asking both ways) is kept for Save and add another, as
        // if marked to keep: blanked, the next note would lose its language and its reverse card.
        if (!askedKnown) setKept(new Set(Object.keys(begun.fields)));
        // A running cram that adds new cards tags the note (src/core/cram.ts); the tag shows here and can be taken off.
        const cs = await props.repo.collectionSettings();
        // Only crams in the note's language take it: read from its Language field, else its deck.
        const language = readerLanguageOf({ id: '', deck: startDeck, model: startModel, fields: startFields, tags: [] });
        const running = await loadCrams(props.repo).catch(() => cramsNow());
        const crams = runningCramTags(running, all, language, new Date(), cs.dayStartsAtHour);
        cramContext.current = { crams: running, notes: all, hour: cs.dayStartsAtHour, language, tags: crams };
        const startTags = [...new Set([...(props.target.tags ?? []), ...crams])];
        if (startTags.length) setTags(startTags.join(' '));
        setStart({ fields: startFields, tags: startTags.join(' ') });
      }
      setLoaded(true);
    })().catch((e) => setLoadError(failureText(e, { what: "Couldn't open the note.", next: 'Try again.' })));
  }, [props.repo, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const decks = useMemo(
    () => [...new Set([...notes.map((n) => untiered(n.deck)), ...(props.decks ?? []).filter((d) => !filteredDecks.has(d))])].sort((a, b) => a.localeCompare(b)),
    [notes, props.decks, filteredDecks],
  );
  const models = useMemo(() => [...new Set([...noteTypes.keys(), ...notes.map((n) => n.model)])].sort((a, b) => a.localeCompare(b)), [noteTypes, notes]);
  // The fields of the note type, in Anki's order; for a note type Franki holds no copy of, those of a note of it.
  const fieldNames = useMemo(() => {
    const nt = noteTypes.get(model);
    if (nt?.fields.length) return nt.fields;
    const like = (original?.model === model ? original : notes.find((n) => n.model === model))?.fields;
    // An Omnilanguage note in a collection with no copy of the type (a deck made in Franki): its fields as Anki's type has them.
    const base = like ? Object.keys(like) : model === 'Omnilanguage' ? omnilanguageFieldNames : ['Front', 'Back'];
    // And any field it started with (a plain note's Language in a deck set to no language, `startNoteFor`).
    return [...base, ...Object.keys(start?.fields ?? {}).filter((f) => !base.includes(f))];
  }, [model, noteTypes, notes, original, start]);

  const stored = useMemo(() => Object.fromEntries(fieldNames.map((f) => [f, editTextToField(fields[f] ?? '')])), [fieldNames, fields]);
  const draftNote: Note = { id: original?.id ?? '', deck, model, fields: stored, tags: parseTags(tags) };
  // A new note joins the running crams in its own language. Those tags were worked out from the deck
  // and Language field it started with, so when either changes the language, the crams' tags put
  // there are swapped for the new language's; any other tag, typed or kept, stays.
  const cramLanguage = loaded && !editing ? readerLanguageOf({ id: '', deck, model, fields: stored, tags: [] }) : undefined;
  useEffect(() => {
    const ctx = cramContext.current;
    if (!ctx || !loaded || editing || cramLanguage === ctx.language) return;
    const next = runningCramTags(ctx.crams, ctx.notes, cramLanguage, new Date(), ctx.hour);
    const old = new Set(ctx.tags);
    setTags((prev) => [...new Set([...parseTags(prev).filter((t) => !old.has(t) || next.includes(t)), ...next])].join(' '));
    cramContext.current = { ...ctx, language: cramLanguage, tags: next };
  }, [cramLanguage, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const cardNames = useMemo(() => {
    const nt = noteTypes.get(model);
    return cardsFor(draftNote, noteTypes, new Date()).map((card) =>
      isOmnilanguage(draftNote) ? OMNI_CARD_NAMES[card.kind] ?? card.kind : nt?.templates.find((t) => `t${t.ord}` === card.kind)?.name ?? 'Card');
  }, [stored, model, noteTypes]); // eslint-disable-line react-hooks/exhaustive-deps
  const isCloze = noteTypes.get(model)?.kind === 'cloze';
  const cloze = clozeChoices(fields);
  // The collection's tags, suggested as the Tags field is typed in, as the tag fields elsewhere suggest them (TagTokenField).
  const collectionTags = useMemo(() => tagCounts(notes), [notes]);
  const suggestedTags = useMemo(() => (tagsFocused ? suggestTags(collectionTags, typedTag(tags), parseTags(tags), TAG_SUGGESTIONS).map((t) => t.tag) : []), [tagsFocused, collectionTags, tags]);
  // Warned of only where `saveNote` would refuse it (`checksDuplicate`): an edit that keeps its first field saves.
  const duplicate = fieldNames[0] && checksDuplicate(original, { deck, model, fields: stored }, fieldNames[0])
    ? duplicateOf(notes, { id: original?.id, deck, model, fields: stored }, fieldNames[0])
    : undefined;
  const changed = editing
    ? !!original && (deck !== original.deck || JSON.stringify(stored) !== JSON.stringify(Object.fromEntries(fieldNames.map((f) => [f, asEdited(original.fields[f] ?? '')])))
      || parseTags(tags).join(' ') !== original.tags.join(' '))
    : !!start && addDraftChanged(start, { fields, tags });

  // A ref, not `busy`: a second tap on the header's Save can land before the re-render that disables
  // it reaches the native button, and would add the note twice.
  const saving = useRef(false);
  const save = async (another = false) => {
    if (saving.current) return;
    if (!deck.trim()) { setError('The note has no deck. Choose one under Deck, then save.'); return; }
    saving.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const saved = await saveNote(props.repo, { id: original?.id, deck, model, fields: stored, tags: parseTags(tags) });
      afterSave(props.recorder ?? null, saved, { added: !editing, recording, settings: voiceSettings });
      if (another) {
        // The form starts over in the same deck and note type with the same tags, the kept fields
        // still filled in; the note just added counts for the duplicate warning and the tag suggestions.
        const next = nextNoteFields(fieldNames, fields, kept);
        setNotes((all) => [...all, saved]);
        for (const f of fieldNames) if (!kept.has(f)) selections.current.delete(f);
        setFields(next);
        setStart({ fields: next, tags });
        setAdded((n) => n + 1);
        props.onSaved?.(saved);
        const first = fieldNames.find((f) => !kept.has(f));
        if (first) requestAnimationFrame(() => inputs.current.get(first)?.focus());
        return;
      }
      stopAsking();
      props.onClose({ saved });
    } catch (e) {
      setError(failureText(e, { what: "Couldn't save the note.", next: 'Try again.' }));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  // Leaving with changes asks first, whether by Cancel or by swiping the sheet down. Saving and
  // deleting turn the question off (`stopAsking`) before they close it themselves.
  const stopAsking = usePreventRemove(changed, ({ repeat }) => {
    Alert.alert('Discard changes?', "If you leave now, they'll be lost.", [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: repeat },
    ]);
  });
  const cancel = () => props.onClose();

  // An error shows above the first card, so the screen goes back to the top to show it: a Save
  // tapped at the bottom of a long note otherwise looked like it did nothing. The scroll view's
  // top at rest is the header's height above zero (contentInsetAdjustmentBehavior).
  const header = useHeaderInset();
  useEffect(() => {
    if (error) scrollProps.ref.current?.scrollTo({ y: -header.top, animated: true });
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = () => {
    if (!original) return;
    Alert.alert(
      'Delete this note?',
      deleteNoteWarning(cardNames.length),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            setBusy(true);
            try {
              await deleteNote(props.repo, original.id);
              stopAsking();
              props.onClose({ deleted: original.id });
            } catch (e) {
              setError(failureText(e, { what: "Couldn't delete the note.", next: 'Try again.' }));
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Screen
      title={editing ? 'Edit note' : 'Add note'}
      largeTitle={false}
      lockGesture={changed}
      toolbar={
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button accessibilityLabel="Cancel" onPress={cancel}>Cancel</Stack.Toolbar.Button>
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button accessibilityLabel="Save the note" disabled={busy || !loaded || missing} onPress={() => save()}>{busy ? 'Saving…' : 'Save'}</Stack.Toolbar.Button>
          </Stack.Toolbar>
        </>
      }
    >
      {!loaded ? <Loading error={loadError} onRetry={() => setAttempt((n) => n + 1)} /> : missing ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l }}>
          <Help>Couldn't find this note. It may have been deleted, here or in Anki.</Help>
        </ScrollView>
      ) : (
        <View ref={header.ref} onLayout={header.onLayout} style={{ flex: 1 }}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l + bottomPadding, gap: space.m }} keyboardShouldPersistTaps="handled" {...scrollProps}>
          {error ? (
            <View accessibilityRole="alert" style={{ backgroundColor: c.dangerFill, borderRadius: radius.m, ...smooth, padding: space.m }}>
              <Text style={{ ...type.subhead, color: c.danger }}>{error}</Text>
            </View>
          ) : null}
          {added ? <Help>Added {added === 1 ? '1 note' : `${added} notes`} to {untiered(deck)}.</Help> : null}
          {'choice' in props.target && props.target.choice ? (
            <WordChoiceCard
              choice={props.target.choice}
              onChoose={(word) => { stopAsking(); props.onClose({ chose: word }); }}
              onRemove={() => { stopAsking(); props.onClose({ dropped: true }); }}
            />
          ) : null}
          <Card>
            {/* A note in a frequency tier shows as its language's deck, and choosing that deck again leaves it where it is. */}
            <Select label="Deck" options={decks} value={untiered(deck)} onChange={(d) => { setDeck(original && d === untiered(original.deck) ? original.deck : d); setError(undefined); }} />
            {editing ? (
              // A note keeps its note type, as in Anki without its Change Note Type tool.
              <View style={{ gap: space.xs }}>
                <Text style={{ ...type.subhead, color: c.textSecondary }}>Note type</Text>
                <Text style={{ ...type.body, color: c.text }}>{model}</Text>
              </View>
            ) : (
              <Select label="Note type" options={models} value={model} onChange={(m) => { setModel(m); setError(undefined); }} />
            )}
          </Card>
          <Card>
            {fieldNames.map((name) => (
              <View key={name} style={{ gap: space.s }}>
                <Field
                  ref={(r) => { inputs.current.set(name, r); }}
                  label={name}
                  value={fields[name] ?? ''}
                  onChangeText={(v) => { setFields((f) => ({ ...f, [name]: v })); setError(undefined); }}
                  onFocus={() => { setFocused(name); setTagsFocused(false); }}
                  onSelectionChange={(e) => selections.current.set(name, e.nativeEvent.selection)}
                  multiline
                  autoCorrect={false}
                />
                {focused === name ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                    {(['b', 'i', 'u'] as Mark[]).map((m) => (
                      <Chip key={m} label={MARK_LABELS[m]} selected={false} onPress={() => format(name, (t, sel) => toggleMark(t, sel, m))} />
                    ))}
                    <Chip label="Plain text" selected={false} onPress={() => format(name, clearFormatting)} />
                    {isCloze ? <Chip label={`Cloze ${cloze.next}`} selected={false} onPress={() => format(name, (t, sel) => wrapCloze(t, sel, cloze.next))} /> : null}
                    {isCloze && cloze.same ? <Chip label={`Cloze ${cloze.same} again`} selected={false} onPress={() => format(name, (t, sel) => wrapCloze(t, sel, cloze.same!))} /> : null}
                    {addAnother ? (
                      <Chip
                        label="Keep for next note"
                        selected={kept.has(name)}
                        onPress={() => setKept((k) => { const out = new Set(k); if (!out.delete(name)) out.add(name); return out; })}
                      />
                    ) : null}
                  </View>
                ) : kept.has(name) ? <Text style={{ ...type.footnote, color: c.textSecondary }}>Kept for the next note.</Text> : null}
                {hasFormatting(fields[name] ?? '') ? <Preview text={fields[name] ?? ''} /> : null}
                {'fieldNotes' in props.target && props.target.fieldNotes?.[name] && fields[name] ? (
                  <Text style={{ ...type.footnote, color: c.warning }}>{props.target.fieldNotes[name]}</Text>
                ) : null}
              </View>
            ))}
            <View style={{ gap: space.s }}>
              <Field label="Tags" value={tags} onChangeText={setTags} onFocus={() => { setTagsFocused(true); setFocused(null); }} autoCapitalize="none" autoCorrect={false} placeholder="Separated by spaces" />
              {tagsFocused && suggestedTags.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                  {suggestedTags.map((t) => <Chip key={t} label={t} selected={false} onPress={() => setTags((x) => applyTagSuggestion(x, t))} />)}
                </View>
              ) : null}
            </View>
            {/* A new note is recorded automatically once it's saved (afterSave), so the button is only for editing one. */}
            {editing ? (
              <RecordAudio
                recorder={props.recorder ?? null}
                note={draftNote}
                settings={voiceSettings}
                onRecorded={(r) => { setRecording(r); setFields((f) => ({ ...f, Audio: [f.Audio?.trim(), `[sound:${r.name}]`].filter(Boolean).join(' ') })); }}
              />
            ) : null}
          </Card>
          {duplicate ? (
            <Text style={{ ...type.subhead, color: c.warning }}>
              {untiered(duplicate.deck)} already has a note with this {fieldNames[0]}, so this note can't be saved.
            </Text>
          ) : null}
          <Help>
            {cardNames.length
              ? `Makes ${cardNames.length === 1 ? '1 card' : `${cardNames.length} cards`}: ${cardNames.join(', ')}.`
              : 'No cards yet. Fill in the fields shown on the front.'}
            {' '}Select text in a field to make it bold, italic or underlined, {isCloze ? 'take its formatting away, or make it a cloze' : 'or take its formatting away'}. A formatted
            field shows a preview below it.
          </Help>
          {addAnother ? <Button label="Save and add another" variant="secondary" onPress={() => save(true)} disabled={busy} /> : null}
          {editing ? (
            <CardStates
              cards={noteCardList}
              nameOf={(kind) => (original && isOmnilanguage(original) ? OMNI_CARD_NAMES[kind] ?? kind : noteTypes.get(model)?.templates.find((t) => `t${t.ord}` === kind)?.name ?? 'Card')}
              dayStartsAtHour={dayStartsAtHour}
              onChange={async (card, change) => {
                let result: Awaited<ReturnType<typeof setCardStates>>;
                try {
                  result = await setCardStates(props.repo, [card], change, new Date(), dayStartsAtHour);
                } catch (e) {
                  setError(failureText(e, { what: "Couldn't change this card.", next: 'Try again.' }));
                  return;
                }
                const { cards, ankiError } = result;
                props.onCardsChanged?.();
                setNoteCardList((list) => list.map((x) => (x.id === card.id ? cards[0] : x)));
                if (ankiError) setError(failureText(ankiError, { next: NOT_IN_ANKI }));
              }}
            />
          ) : null}
          {editing ? <Button label="Delete note" variant="destructive" onPress={remove} disabled={busy} /> : null}
        </ScrollView>
        </View>
      )}
    </Screen>
  );
}

type CardRow = import('../core/types').Card;

/**
 * The note's cards that are suspended, buried or flagged (set while studying, or in Anki), each
 * with the button that undoes it. Shows nothing when none is.
 */
function CardStates({ cards, nameOf, dayStartsAtHour, onChange }: {
  cards: CardRow[]; nameOf: (kind: string) => string; dayStartsAtHour: number;
  onChange: (card: CardRow, change: (s: CardState) => CardState) => Promise<void>;
}) {
  const c = useTheme();
  const now = new Date();
  const marked = cards.map((card) => ({ card, s: cardStateOf(card, now, dayStartsAtHour) })).filter(({ s }) => s.suspended || s.buried || s.flag);
  if (!marked.length) return null;
  return (
    <Card>
      <Text style={{ ...type.headline, color: c.text }}>Cards</Text>
      {marked.map(({ card, s }) => (
        <View key={card.id} style={{ gap: space.s }}>
          <Text style={{ ...type.body, color: c.text }}>
            {nameOf(card.kind)}: {[s.suspended && 'suspended', s.buried && 'buried until tomorrow', s.flag && `flagged ${FLAG_NAMES[s.flag].toLowerCase()}`].filter(Boolean).join(', ')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {s.suspended ? <Button label="Unsuspend" variant="secondary" onPress={() => onChange(card, (x) => ({ ...x, suspended: false }))} /> : null}
            {s.buried ? <Button label="Unbury" variant="secondary" onPress={() => onChange(card, (x) => ({ ...x, buried: false }))} /> : null}
            {s.flag ? <Button label="Remove flag" variant="secondary" onPress={() => onChange(card, (x) => ({ ...x, flag: 0 }))} /> : null}
          </View>
        </View>
      ))}
    </Card>
  );
}

/** How a field with formatting will read on the card. */
function Preview({ text }: { text: string }) {
  const c = useTheme();
  return (
    <Text accessibilityLabel="Shows as" style={{ ...type.subhead, color: c.textSecondary }}>
      {formattedRuns(text).map((r, i) => (
        <Text key={i} style={{ fontWeight: r.bold ? '700' : undefined, fontStyle: r.italic ? 'italic' : undefined, textDecorationLine: r.underline ? 'underline' : undefined }}>
          {r.text}
        </Text>
      ))}
    </Text>
  );
}
