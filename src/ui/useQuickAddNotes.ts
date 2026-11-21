import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { saveNote } from '../anki/noteService';
import { runningCramTags } from '../core/cram';
import { untiered } from '../core/deckTree';
import { failureText } from '../core/failure';
import { readerLanguageOf } from '../core/leechHint';
import { duplicateKey, duplicateOf, editTextToField, notesStillThere, startNoteFor } from '../core/noteEditing';
import { omnilanguageFieldNames } from '../import/models';
import type { QuickWord } from '../core/quickAdd';
import type { DeckSettings, Note, NoteType } from '../core/types';
import { reviewWrites } from '../core/writeQueue';
import { useApp } from './AppContext';
import { afterSave, useVoiceSettings } from './RecordAudio';
import { cramsNow, loadCrams } from './useCrams';
import { useRecorder } from './useRecorder';

/** What Quick add reads from the collection to decide what a typed word does. */
export interface QuickCollection {
  /** Every deck a note can go in, as the note editor offers them: a filtered deck holds no notes. */
  decks: string[];
  /**
   * The note type a word saved without Claude goes in as, as the note editor would start it
   * (`startNoteFor`), its first two fields, and the fields it starts with (a new deck's Language).
   */
  plainType(deck: string): { model: string; word: string; meaning: string; start: Record<string, string> };
  /**
   * The deck that already has `entry` as the first field of a `model` note (in the same language, for a
   * word), else undefined: the check `saveNote` refuses a duplicate by (`duplicateOf`), asked of the notes
   * whose first field matches, so the row says so before Add is tapped.
   */
  inDeck(deck: string, model: string, word: QuickWord): string | undefined;
}

export interface QuickSaved {
  saved: number;
  /** Words the deck refused, with why (a duplicate added meanwhile, a note with no cards). */
  refused: { entry: string; reason: string }[];
}

/**
 * Quick add's side of the collection, for a deck Claude doesn't fill in: the decks, the duplicate check,
 * and saving each word as a note of the deck's usual type, the word in its first field and the meaning in
 * its second. Tapping Add is the approval: only what the owner typed is saved. New notes take a running
 * cram's tag (`runningCramTags`, as the note editor and Approve all do) and are recorded afterward, in the
 * background, as Approve all records them (`afterSave`).
 */
export function useQuickAddNotes(): { collection: QuickCollection | null; problem: string | null; retry: () => void; save: (deck: string, words: QuickWord[]) => Promise<QuickSaved> } {
  const { repo, decks: rows, refresh } = useApp();
  const recorder = useRecorder();
  const voiceSettings = useVoiceSettings(repo);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [types, setTypes] = useState<Map<string, NoteType>>(new Map());
  const [filtered, setFiltered] = useState<Set<string>>(new Set());
  const [own, setOwn] = useState<Map<string, DeckSettings>>(new Map());
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setProblem(null);
    (async () => {
      await reviewWrites.idle();
      const [all, noteTypes, params, cards, settings] = await Promise.all([repo.listNotes(), repo.listNoteTypes(), repo.listDeckParams(), repo.listCards(), repo.listDeckSettings()]);
      if (!live) return;
      setOwn(settings);
      setNotes(notesStillThere(all, cards));
      setTypes(noteTypes);
      setFiltered(new Set([...params].filter(([, p]) => p.filtered).map(([d]) => d)));
    })().catch((e: unknown) => { if (live) setProblem(failureText(e, { what: "Couldn't read your decks.", next: 'Try again.' })); });
    return () => { live = false; };
  }, [repo, attempt]);

  const collection = useMemo<QuickCollection | null>(() => {
    if (!notes) return null;
    const fieldsOf = (model: string) => types.get(model)?.fields
      ?? Object.keys(notes.find((n) => n.model === model)?.fields ?? (model === 'Omnilanguage' ? Object.fromEntries(omnilanguageFieldNames.map((f) => [f, ''])) : { Front: '', Back: '' }));
    // Each note type's notes by their first field's `duplicateKey`, built on first ask: the rows check
    // every word on each keystroke, and `duplicateOf` reads every note it's given.
    const keys = new Map<string, Map<string, Note[]>>();
    const keysOf = (model: string) => {
      let index = keys.get(model);
      if (!index) {
        const first = fieldsOf(model)[0];
        index = new Map();
        for (const n of notes) {
          if (n.model !== model || !first) continue;
          const key = duplicateKey(n.fields[first]);
          if (key) index.set(key, [...(index.get(key) ?? []), n]);
        }
        keys.set(model, index);
      }
      return index;
    };
    const plain = new Map<string, { model: string; word: string; meaning: string; start: Record<string, string> }>();
    return {
      decks: [...new Set([...notes.map((n) => untiered(n.deck)), ...rows.map((r) => r.deck).filter((d) => !filtered.has(d))])].sort((a, b) => a.localeCompare(b)),
      plainType: (deck) => {
        let found = plain.get(deck);
        if (!found) {
          const { model, fields: start } = startNoteFor(notes, [...types.keys()], deck, own.get(deck));
          const [word = 'Front', meaning = 'Back'] = fieldsOf(model);
          found = { model, word, meaning, start };
          plain.set(deck, found);
        }
        return found;
      },
      inDeck: (deck, model, word) => {
        const [first, second] = fieldsOf(model);
        const fields = { [first]: editTextToField(word.entry), ...(second ? { [second]: editTextToField(word.meaning) } : {}) };
        const key = duplicateKey(fields[first]);
        const there = key ? duplicateOf(keysOf(model).get(key) ?? [], { deck, model, fields }, first) : undefined;
        return there ? untiered(there.deck) : undefined;
      },
    };
  }, [notes, types, filtered, rows, own]);

  const save = useCallback(async (deck: string, words: QuickWord[]): Promise<QuickSaved> => {
    if (!collection) return { saved: 0, refused: [] };
    const { model, word, meaning, start } = collection.plainType(deck);
    const { dayStartsAtHour } = await repo.collectionSettings();
    const crams = await loadCrams(repo).catch(() => cramsNow());
    const all = notes ?? [];
    const result: QuickSaved = { saved: 0, refused: [] };
    const added: Note[] = [];
    for (const w of words) {
      const fields = { ...start, [word]: editTextToField(w.entry), [meaning]: editTextToField(w.meaning) };
      const tags = runningCramTags(crams, all, readerLanguageOf({ id: '', deck, model, fields, tags: [] }), new Date(), dayStartsAtHour);
      try {
        added.push(await saveNote(repo, { deck, model, fields, tags, allowDuplicate: w.anyway }));
        result.saved++;
      } catch (e) {
        result.refused.push({ entry: w.entry, reason: failureText(e, { next: 'Try again.' }) });
      }
    }
    if (added.length) {
      setNotes((list) => [...(list ?? []), ...added]);
      refresh();
    }
    // Recording is slow and not part of adding: one at a time, with one alert if any fail.
    void (async () => {
      let failed = 0;
      for (const saved of added) await afterSave(recorder, saved, { added: true, settings: voiceSettings, onFailure: () => { failed++; } });
      if (failed) {
        Alert.alert(
          failed === 1 ? 'Saved 1 note without a recording' : `Saved ${failed} notes without a recording`,
          "Record them later with Record audio in the note editor, or from the deck's options.",
        );
      }
    })();
    return result;
  }, [collection, notes, repo, refresh, recorder, voiceSettings]);

  return { collection, problem, retry: () => setAttempt((n) => n + 1), save };
}
