import { Stack, usePreventRemove } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View, type TextInputInstance } from 'react-native';
import { cardsFor, deleteNote, saveNote, setCardStates, type NoteStore } from '../anki/noteService';
import { cardStateOf, FLAG_NAMES, type CardState } from '../core/cardState';
import { failureText } from '../core/failure';
import type { AnkiLink } from '../db/ankiLink';
import { isOmnilanguage } from '../core/cards';
import { clearFormatting, formattedRuns, hasFormatting, toggleMark, type Mark, type Selection } from '../core/formatting';
import { asEdited, duplicateOf, editTextToField, fieldToEditText, parseTags } from '../core/noteEditing';
import type { Note, NoteType } from '../core/types';
import type { NoteEditorResult } from './AppContext';
import type { RecordDeps, Recording } from '../anki/recordService';
import { Button, Card, Chip, Field, Help, Loading, Screen, Select } from './kit';
import { afterSave, RecordAudio, useVoiceSettings } from './RecordAudio';
import { radius, smooth, space, type, useTheme } from './theme';
import { useHeaderInset } from './useHeaderInset';
import { useKeyboardScroll } from './useKeyboardScroll';

const OMNI_CARD_NAMES: Record<string, string> = { forward: 'Front', reverse: 'Reverse', audio: 'Audio' };
const MARK_LABELS: Record<Mark, string> = { b: 'Bold', i: 'Italic', u: 'Underline' };

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
   * given, as Read & Listen's marked words do).
   */
  target: { noteId: string } | { deck: string | null; model?: string; fields?: Record<string, string> };
  onClose: (result?: NoteEditorResult) => void;
  /** A card was unsuspended, unburied or unflagged here, which stands whether or not the note is saved. */
  onCardsChanged?: () => void;
  /** Every deck on the deck list, empty ones included, so a deck just made can be picked. */
  decks?: string[];
  /** Recording audio with an Azure voice (useRecorder); null while Read & Listen is off. */
  recorder?: RecordDeps | null;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Until the note (or, adding one, the decks and note types) is in, the form isn't shown.
  const [loaded, setLoaded] = useState(false);
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
      const [all, types, params] = await Promise.all([props.repo.listNotes(), props.repo.listNoteTypes(), props.repo.listDeckParams()]);
      setNotes(all);
      setNoteTypes(types);
      // A filtered deck borrows cards and holds no notes of its own, so a note can't go in one.
      setFilteredDecks(new Set([...params].filter(([, p]) => p.filtered).map(([d]) => d)));
      if ('noteId' in props.target) {
        const n = all.find((x) => x.id === (props.target as { noteId: string }).noteId);
        if (!n) { setMissing(true); setLoaded(true); return; }
        const [cs, cards] = await Promise.all([props.repo.collectionSettings(), props.repo.listCards()]);
        setDayStartsAtHour(cs.dayStartsAtHour);
        setNoteCardList(cards.filter((x) => x.noteId === n.id && !x.retired));
        setOriginal(n);
        setDeck(n.deck);
        setModel(n.model);
        setFields(Object.fromEntries(Object.entries(n.fields).map(([k, v]) => [k, fieldToEditText(v)])));
        setTags(n.tags.join(' '));
      } else {
        // Start in the deck asked for, with the note type its notes use most.
        const startDeck = props.target.deck ?? all[0]?.deck ?? '';
        const inDeck = all.filter((n) => n.deck === startDeck || n.deck.startsWith(`${startDeck}::`));
        const counts = new Map<string, number>();
        for (const n of inDeck.length ? inDeck : all) counts.set(n.model, (counts.get(n.model) ?? 0) + 1);
        const startModel = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? [...types.keys()][0] ?? '';
        setDeck(startDeck);
        const asked = props.target.model;
        setModel(asked && (types.has(asked) || all.some((n) => n.model === asked)) ? asked : startModel);
        if (props.target.fields) setFields(props.target.fields);
      }
      setLoaded(true);
    })().catch((e) => setLoadError(failureText(e, { what: "Couldn't open the note.", next: 'Try again.' })));
  }, [props.repo, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const decks = useMemo(
    () => [...new Set([...notes.map((n) => n.deck), ...(props.decks ?? []).filter((d) => !filteredDecks.has(d))])].sort((a, b) => a.localeCompare(b)),
    [notes, props.decks, filteredDecks],
  );
  const models = useMemo(() => [...new Set([...noteTypes.keys(), ...notes.map((n) => n.model)])].sort((a, b) => a.localeCompare(b)), [noteTypes, notes]);
  // The fields of the note type, in Anki's order; for a note type Franki holds no copy of, those of a note of it.
  const fieldNames = useMemo(() => {
    const nt = noteTypes.get(model);
    if (nt?.fields.length) return nt.fields;
    return Object.keys((original?.model === model ? original : notes.find((n) => n.model === model))?.fields ?? { Front: '', Back: '' });
  }, [model, noteTypes, notes, original]);

  const stored = useMemo(() => Object.fromEntries(fieldNames.map((f) => [f, editTextToField(fields[f] ?? '')])), [fieldNames, fields]);
  const draftNote: Note = { id: original?.id ?? '', deck, model, fields: stored, tags: parseTags(tags) };
  const cardNames = useMemo(() => {
    const nt = noteTypes.get(model);
    return cardsFor(draftNote, noteTypes, new Date()).map((card) =>
      isOmnilanguage(draftNote) ? OMNI_CARD_NAMES[card.kind] ?? card.kind : nt?.templates.find((t) => `t${t.ord}` === card.kind)?.name ?? 'Card');
  }, [stored, model, noteTypes]); // eslint-disable-line react-hooks/exhaustive-deps
  const duplicate = fieldNames[0] ? duplicateOf(notes, { id: original?.id, model, fields: stored }, fieldNames[0]) : undefined;
  const changed = editing
    ? !!original && (deck !== original.deck || JSON.stringify(stored) !== JSON.stringify(Object.fromEntries(fieldNames.map((f) => [f, asEdited(original.fields[f] ?? '')])))
      || parseTags(tags).join(' ') !== original.tags.join(' '))
    : Object.values(fields).some((v) => v.trim()) || tags.trim() !== '';

  // A ref, not `busy`: a second tap on the header's Save can land before the re-render that disables
  // it reaches the native button, and would add the note twice.
  const saving = useRef(false);
  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const saved = await saveNote(props.repo, { id: original?.id, deck, model, fields: stored, tags: parseTags(tags) });
      afterSave(props.recorder ?? null, saved, { added: !editing, recording, settings: voiceSettings });
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
      `Its ${cardNames.length === 1 ? 'card is' : 'cards are'} deleted too, with ${cardNames.length === 1 ? 'its' : 'their'} review history in Franki. Anki deletes them at the next sync, or when you send your collection back.`,
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
            <Stack.Toolbar.Button accessibilityLabel="Save the note" disabled={busy || !loaded || missing} onPress={save}>{busy ? 'Saving…' : 'Save'}</Stack.Toolbar.Button>
          </Stack.Toolbar>
        </>
      }
    >
      {!loaded ? <Loading error={loadError} onRetry={() => setAttempt((n) => n + 1)} /> : missing ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l }}>
          <Help>Couldn't find this note. It may have been deleted, here or in Anki.</Help>
        </ScrollView>
      ) : (
        <View ref={header.ref} onLayout={header.onLayout} style={{ flex: 1 }}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l + bottomPadding, gap: space.m }} keyboardShouldPersistTaps="handled" {...scrollProps}>
          {error ? (
            <View accessibilityRole="alert" style={{ backgroundColor: c.dangerFill, borderRadius: radius.m, ...smooth, padding: space.m }}>
              <Text style={{ ...type.subhead, color: c.danger }}>{error}</Text>
            </View>
          ) : null}
          <Card>
            <Select label="Deck" options={decks} value={deck} onChange={(d) => { setDeck(d); setError(undefined); }} />
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
                  onFocus={() => setFocused(name)}
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
                  </View>
                ) : null}
                {hasFormatting(fields[name] ?? '') ? <Preview text={fields[name] ?? ''} /> : null}
              </View>
            ))}
            <Field label="Tags" value={tags} onChangeText={setTags} autoCapitalize="none" autoCorrect={false} placeholder="Separated by spaces" />
            <RecordAudio
              recorder={props.recorder ?? null}
              note={draftNote}
              settings={voiceSettings}
              onRecorded={(r) => { setRecording(r); setFields((f) => ({ ...f, Audio: [f.Audio?.trim(), `[sound:${r.name}]`].filter(Boolean).join(' ') })); }}
            />
          </Card>
          {duplicate ? (
            <Text style={{ ...type.subhead, color: c.warning }}>
              Another {model} note in {duplicate.deck} already has this {fieldNames[0]}.
            </Text>
          ) : null}
          <Help>
            {cardNames.length
              ? `Makes ${cardNames.length === 1 ? '1 card' : `${cardNames.length} cards`}: ${cardNames.join(', ')}.`
              : 'Makes no cards yet. Fill in the fields the card fronts show.'}
            {' '}Select text in a field to make it bold, italic or underlined, or take its formatting away. A field with
            formatting shows how it will look underneath.
          </Help>
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
                if (ankiError) setError(failureText(ankiError, { next: "Changed in Franki, but it won't reach Anki." }));
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
