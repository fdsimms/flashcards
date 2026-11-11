import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, ScrollView, Text, View, type TextInputInstance } from 'react-native';
import { cardsFor, deleteNote, NoteRefused, saveNote, type NoteStore } from '../anki/noteService';
import { isOmnilanguage } from '../core/cards';
import { clearFormatting, formattedRuns, hasFormatting, toggleMark, type Mark, type Selection } from '../core/formatting';
import { duplicateOf, editTextToField, fieldToEditText, parseTags } from '../core/noteEditing';
import type { Note, NoteType } from '../core/types';
import { Button, Card, Chip, Field, Help, HeaderAction, Screen } from './kit';
import { space, type, useTheme } from './theme';

const OMNI_CARD_NAMES: Record<string, string> = { forward: 'Front', reverse: 'Reverse', audio: 'Audio' };
const MARK_LABELS: Record<Mark, string> = { b: 'Bold', i: 'Italic', u: 'Underline' };

/**
 * Adding or editing a note, full screen over whatever opened it (Review, Browse), so that screen
 * keeps its place. Saving goes through the note service, which also writes the change into the
 * Anki collection; Delete removes the note there too.
 */
export function NoteEditor(props: {
  repo: NoteStore;
  /** Edit this note, or add one (starting in `deck`). */
  target: { noteId: string } | { deck: string | null };
  onClose: (result?: { saved: Note } | { deleted: string }) => void;
}) {
  const c = useTheme();
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteTypes, setNoteTypes] = useState<Map<string, NoteType>>(new Map());
  const [original, setOriginal] = useState<Note>();
  const [deck, setDeck] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const editing = 'noteId' in props.target;
  // The field being typed in, its selection, and each field's input, for the formatting buttons.
  const [focused, setFocused] = useState<string | null>(null);
  const selections = useRef(new Map<string, Selection>());
  const inputs = useRef(new Map<string, TextInputInstance | null>());

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
    (async () => {
      const [all, types] = await Promise.all([props.repo.listNotes(), props.repo.listNoteTypes()]);
      setNotes(all);
      setNoteTypes(types);
      if ('noteId' in props.target) {
        const n = all.find((x) => x.id === (props.target as { noteId: string }).noteId);
        if (!n) return;
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
        setModel(startModel);
      }
    })();
  }, [props.repo]); // eslint-disable-line react-hooks/exhaustive-deps

  const decks = useMemo(() => [...new Set(notes.map((n) => n.deck))].sort((a, b) => a.localeCompare(b)), [notes]);
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
    ? !!original && (deck !== original.deck || JSON.stringify(stored) !== JSON.stringify(Object.fromEntries(fieldNames.map((f) => [f, original.fields[f] ?? ''])))
      || parseTags(tags).join(' ') !== original.tags.join(' '))
    : Object.values(fields).some((v) => v.trim()) || tags.trim() !== '';

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const saved = await saveNote(props.repo, { id: original?.id, deck, model, fields: stored, tags: parseTags(tags) });
      props.onClose({ saved });
    } catch (e) {
      setError(e instanceof NoteRefused ? e.message : `Couldn't save the note. ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (!changed) { props.onClose(); return; }
    Alert.alert('Discard changes?', "If you leave now, they'll be lost.", [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => props.onClose() },
    ]);
  };

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
              props.onClose({ deleted: original.id });
            } catch (e) {
              setError(`Couldn't delete the note. ${e instanceof Error ? e.message : String(e)}`);
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={cancel}>
      <Screen
        onBack={cancel}
        backLabel="Cancel"
        title={editing ? 'Edit note' : 'Add note'}
        right={<HeaderAction label={busy ? 'Saving…' : 'Save'} onPress={save} accessibilityLabel="Save the note" />}
      >
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <Card>
            <Text style={{ ...type.headline, color: c.text }}>Deck</Text>
            <Chips options={decks} value={deck} onChange={(d) => { setDeck(d); setError(undefined); }} />
            <Text style={{ ...type.headline, color: c.text }}>Note type</Text>
            {editing ? (
              // A note keeps its note type, as in Anki without its Change Note Type tool.
              <Text style={{ ...type.body, color: c.textSecondary }}>{model}</Text>
            ) : (
              <Chips options={models} value={model} onChange={(m) => { setModel(m); setError(undefined); }} />
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
          </Card>
          {error ? <Text style={{ ...type.subhead, color: c.danger }}>{error}</Text> : null}
          {duplicate ? (
            <Text style={{ ...type.subhead, color: c.warning }}>
              A {model} note in {duplicate.deck} already has this {fieldNames[0]}.
            </Text>
          ) : null}
          <Help>
            {cardNames.length
              ? `Makes ${cardNames.length === 1 ? '1 card' : `${cardNames.length} cards`}: ${cardNames.join(', ')}.`
              : 'Makes no cards yet. Fill in the fields the card fronts show.'}
            {' '}Select text in a field to make it bold, italic or underlined, or take its formatting away. A field with
            formatting shows how it will look underneath.
          </Help>
          {editing ? <Button label="Delete note" variant="secondary" onPress={remove} disabled={busy} /> : null}
        </ScrollView>
      </Screen>
    </Modal>
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

function Chips({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
      {options.map((o) => <Chip key={o} label={o} selected={o === value} onPress={() => onChange(o)} />)}
    </View>
  );
}
