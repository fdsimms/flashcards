import { isOmnilanguage, speechLangFor } from './cards';
import { htmlToText, textToHtml } from './html';
import type { Language } from '../reader/api';
import type { Note } from './types';

/**
 * The hint written when a card becomes a leech goes in the note's Mnemonic field, which shows on
 * the back of the card, so it may name the answer. LeechHint is the other field: it shows on the
 * front, to tell two look-alike cards apart, and must not give the answer away.
 */

/** Only Omnilanguage notes have a Mnemonic field; another note type is tagged but not asked. */
export function canAddMnemonic(note: Note): boolean {
  return isOmnilanguage(note);
}

/** Whether the note's Mnemonic field has text: the front of a leech card says so without showing it, since it may name the answer. */
export function hasMnemonic(note: Note): boolean {
  return htmlToText(note.fields.Mnemonic ?? '') !== '';
}

/** What a hint suggestion is asked about; undefined for a note whose language Read & Listen doesn't write in. */
export type MnemonicQuestion = { language: Language; entry: string; meaning: string; transliteration: string; context: string };

const READER_LANGUAGES: readonly string[] = ['th', 'es', 'de', 'fr', 'ru', 'el', 'pl', 'nb', 'ja'];

/** Whether a stored value is one of Read & Listen's language codes. */
export function isReaderLanguage(code: unknown): code is Language {
  return typeof code === 'string' && READER_LANGUAGES.includes(code);
}

/** The note's language when Read & Listen writes in it. */
export function readerLanguageOf(note: Note): Language | undefined {
  const code = speechLangFor(note)?.split('-')[0];
  return code && READER_LANGUAGES.includes(code) ? (code as Language) : undefined;
}

export function mnemonicQuestion(note: Note): MnemonicQuestion | undefined {
  const code = readerLanguageOf(note);
  if (!code) return undefined;
  const entry = htmlToText(note.fields.Entry ?? '');
  const meaning = htmlToText(note.fields.Meaning ?? '');
  if (!entry || !meaning) return undefined;
  return {
    language: code, entry, meaning,
    // A Japanese note keeps its reading in KanaReading.
    transliteration: htmlToText(note.fields.Transliteration || note.fields.KanaReading || ''),
    context: htmlToText(note.fields.Context ?? ''),
  };
}

/**
 * The note's fields with `hint` in Mnemonic: on a new line under one already there, so a
 * mnemonic written earlier isn't lost. A blank hint changes nothing.
 */
export function withMnemonic(fields: Record<string, string>, hint: string): Record<string, string> {
  const text = hint.trim();
  if (!text) return fields;
  const added = textToHtml(text);
  const existing = fields.Mnemonic ?? '';
  return { ...fields, Mnemonic: htmlToText(existing) ? `${existing}<br>${added}` : added };
}
