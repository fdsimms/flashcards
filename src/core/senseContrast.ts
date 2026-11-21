import { isOmnilanguage, speechLangFor } from './cards';
import { htmlToText, textToHtml } from './html';
import type { Note } from './types';

/**
 * "Not this word": the SenseContrast field of an Omnilanguage note. A Sense rules out an English
 * sense of the gloss (ducha: "a bathroom shower, not rain"); this field names the word for the sense
 * it rules out, one pair per line: `rain shower = aguacero`, or two words, `rain shower = aguacero;
 * chubasco`. The left side is English, the right the language's own word, written as an Entry is.
 *
 * It shows on a card's back only, under the Sense, with a way to add the word as a note of its own
 * or to remove the pair for good. Pure: the screen gathers the notes and the queue.
 */

export const SENSE_CONTRAST_FIELD = 'SenseContrast';

/** One word of one pair: the English sense the card's word doesn't cover, and the word that does. */
export interface ContrastWord {
  sense: string;
  word: string;
}

/** A field's pairs, a row per word, in the order written. A line with no "=", or with a side empty, says nothing and is left out. */
export function contrastWords(field: string): ContrastWord[] {
  const out: ContrastWord[] = [];
  // Anki's editor writes a second line as "first<div>second</div>", with no tag closing the first.
  for (const line of htmlToText((field ?? '').replace(/<(?:div|p)\b[^>]*>/gi, '<br>')).split('\n')) {
    const at = line.indexOf('=');
    if (at < 0) continue;
    const sense = line.slice(0, at).trim();
    if (!sense) continue;
    for (const word of line.slice(at + 1).split(';').map((w) => w.trim()).filter(Boolean)) out.push({ sense, word });
  }
  return out;
}

/** The field with these words written back: a line per sense, in the order the senses first appear. */
function written(words: ContrastWord[]): string {
  const bySense = new Map<string, string[]>();
  for (const { sense, word } of words) bySense.set(sense, [...(bySense.get(sense) ?? []), word]);
  return textToHtml([...bySense].map(([sense, list]) => `${sense} = ${list.join('; ')}`).join('\n'));
}

/**
 * The note's fields with one word taken out of its pair, and the pair with it when that was its only
 * word. The same fields when the word isn't there (already removed, or the note has no such field).
 */
export function withoutContrastWord(fields: Record<string, string>, remove: ContrastWord): Record<string, string> {
  if (!(SENSE_CONTRAST_FIELD in fields)) return fields;
  const all = contrastWords(fields[SENSE_CONTRAST_FIELD]);
  const kept = all.filter((w) => !(w.sense === remove.sense && w.word === remove.word));
  if (kept.length === all.length) return fields;
  return { ...fields, [SENSE_CONTRAST_FIELD]: written(kept) };
}

/** A word as two Entries are compared: plain text, composed, lowercase, single spaces. */
const key = (text: string) => htmlToText(text ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** What a row offers: the word is a note already (`noteId` opens it), is waiting in the note queue, or can be added. */
export type ContrastRow = ContrastWord & ({ state: 'inDeck'; noteId: string } | { state: 'queued' } | { state: 'new' });

/**
 * The rows of a note's box. A word is in the deck when another Omnilanguage note in the same
 * language has it as its Entry: a word spelled alike in another language is a different word.
 * `queued` holds the words waiting in the note queue or added since the screen opened, so a word
 * just added isn't offered again before its note exists.
 */
export function contrastRows(note: Note, notes: Iterable<Note>, queued: Iterable<string> = []): ContrastRow[] {
  const words = contrastWords(note.fields[SENSE_CONTRAST_FIELD] ?? '');
  if (!words.length) return [];
  const language = speechLangFor(note);
  const entries = new Map<string, string>();
  for (const n of notes) {
    if (n.id === note.id || !isOmnilanguage(n) || speechLangFor(n) !== language) continue;
    const entry = key(n.fields.Entry);
    if (entry && !entries.has(entry)) entries.set(entry, n.id);
  }
  const waiting = new Set([...queued].map(key));
  return words.map((w) => {
    const noteId = entries.get(key(w.word));
    if (noteId) return { ...w, state: 'inDeck', noteId };
    return { ...w, state: waiting.has(key(w.word)) ? 'queued' : 'new' };
  });
}
