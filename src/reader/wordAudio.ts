// Playing a tapped word: the recording on its deck note when there is one, else the phone's voice.
// Pure, so the choice is tested; the player and the voices are in ui/useWordAudio.ts.
import { isOmnilanguage, speechLangFor } from '../core/cards';
import { htmlToText, soundFiles } from '../core/html';
import type { Note } from '../core/types';
import { languageKey } from '../core/voices';
import type { Language } from './api';

/** A word as the deck spells its entry: no markup, NFC, spaces collapsed. */
export function entryKey(text: string): string {
  return htmlToText(text).normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * The recording file of each Omnilanguage note in `language`, by its Entry. A homograph keeps the
 * first note that has a recording, since the reader can't tell which meaning was tapped and any
 * recording of the spelling says the word right.
 */
export function recordingIndex(notes: Note[], language: Language): Map<string, string> {
  const index = new Map<string, string>();
  for (const note of notes) {
    if (!isOmnilanguage(note)) continue;
    const lang = speechLangFor(note);
    if (!lang || languageKey(lang) !== language) continue;
    const file = soundFiles(note.fields.Audio)[0];
    const key = entryKey(note.fields.Entry ?? '');
    if (file && key && !index.has(key)) index.set(key, file);
  }
  return index;
}

/**
 * What to play for a word: the deck's recording (`file`), and the text to speak when it isn't here.
 * A word capitalized to start a sentence ("Casa") takes the recording of its entry ("casa").
 */
export function wordPlayback(index: Map<string, string>, word: string): { file?: string; text: string } {
  const text = entryKey(word);
  return { file: index.get(text) ?? index.get(text.toLocaleLowerCase()), text };
}
