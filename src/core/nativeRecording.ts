// A native speaker's recording of a note's word (docs/read-and-listen/architecture.md, Native
// recordings): kept in the note's Audio in place of an Azure one, with the credit its license asks for in
// the note's AudioCredit field. Pure, so it's tested; src/anki/recordService.ts saves it, and Read &
// Listen's server finds it on Wikimedia Commons (`/api/native`). A note type without an AudioCredit field
// gets none: a recording kept without its credit is what the field exists to prevent.
import { strToU8 } from 'fflate';
import { sha1Hex } from '../anki/sha1';
import { isOmnilanguage } from './cards';
import { headword } from './forms';
import { readerLanguageOf } from './leechHint';
import type { Language } from '../reader/api';
import type { Note } from './types';

export const CREDIT_FIELD = 'AudioCredit';

const SOUND = /\[sound:[^\]]*\]/g;

/** Whether the note can keep a native recording: an Omnilanguage note whose note type has the credit field. */
export const canKeepNative = (note: Pick<Note, 'model' | 'fields'>): boolean => isOmnilanguage(note as Note) && CREDIT_FIELD in note.fields;

/** Whether the note's Audio is a native recording (its credit is filled). */
export const hasNative = (note: Pick<Note, 'fields'>): boolean => !!note.fields[CREDIT_FIELD]?.trim();

/** The media file a recording is kept in, named from its Commons file so the same one is never kept twice. */
export const nativeName = (title: string): string => `franki-native-${sha1Hex(strToU8(title)).slice(0, 16)}.mp3`;

/** The note's fields with `name` as its Audio, in place of any recording there (other text stays), and `credit` kept. */
export function withNative(note: Pick<Note, 'fields'>, name: string, credit: string): Record<string, string> {
  const kept = (note.fields.Audio ?? '').replace(SOUND, '').trim();
  return { ...note.fields, Audio: kept ? `${kept} [sound:${name}]` : `[sound:${name}]`, [CREDIT_FIELD]: credit };
}

/** The note's fields with its native recording taken out (and its credit with it), for an Azure one to take its place. */
export function withoutNative(note: Pick<Note, 'fields'>): Record<string, string> {
  return { ...note.fields, Audio: (note.fields.Audio ?? '').replace(SOUND, '').trim(), [CREDIT_FIELD]: '' };
}

/** The recording after the one now kept, of those found for the word, by Commons file title: Another speaker. */
export function nextSpeaker<T extends { title: string; credit: string }>(found: readonly T[], credit: string): T | undefined {
  if (!found.length) return undefined;
  const at = found.findIndex((r) => r.credit === credit);
  return found[(at + 1) % found.length];
}

/** A deck's word that can be looked up for a native recording (Deck options' Native recordings). */
export interface NativeCandidate {
  noteId: string;
  word: string;
  language: Language;
  /** The note's Audio and credit as read, so a change made meanwhile isn't written over (`replaceWithNative`). */
  audio: string;
  credit: string;
}

/**
 * The deck's words that can get a native recording: Omnilanguage notes in a language native recordings are
 * on for (`wanted`), whose note type has the credit field, and with none kept yet. Also how many were left
 * out for want of the field, and the languages left out because the setting has them off, for the screen to say.
 */
export function nativeCandidates(notes: readonly Note[], wanted: (language: Language) => boolean): { candidates: NativeCandidate[]; noField: number; off: Language[] } {
  const candidates: NativeCandidate[] = [];
  const off = new Set<Language>();
  let noField = 0;
  for (const note of notes) {
    if (!isOmnilanguage(note)) continue;
    const language = readerLanguageOf(note);
    if (!language) continue;
    if (!canKeepNative(note)) { noField++; continue; }
    if (!wanted(language)) { off.add(language); continue; }
    if (hasNative(note)) continue;
    const word = headword(note);
    if (word) candidates.push({ noteId: note.id, word, language, audio: note.fields.Audio ?? '', credit: note.fields[CREDIT_FIELD] ?? '' });
  }
  return { candidates, noField, off: [...off] };
}
