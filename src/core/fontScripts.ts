// Which scripts a deck's cards are written in, so the fonts that can't draw them can be left out of its
// card fonts. Read from the notes' text rather than a language setting: a deck has none, and the text is
// what has to be drawn. Pure, so it's tested.
import type { Script } from './fonts';
import type { Note } from './types';

const RANGES: [Script, RegExp][] = [
  ['cyrillic', /[Ѐ-ӿԀ-ԯ]/],
  ['greek', /[Ͱ-Ͽἀ-῿]/],
  ['thai', /[฀-๿]/],
  // Kana and the Han characters. A Chinese deck is drawn by the same fonts, so it counts as Japanese here.
  ['japanese', /[぀-ヿ㐀-䶿一-鿿]/],
];

/** The scripts in a piece of text, besides Latin. */
export function scriptsIn(text: string): Script[] {
  return RANGES.filter(([, re]) => re.test(text)).map(([s]) => s);
}

/** How many notes to read, so a deck of tens of thousands opens its options at once. */
export const SCRIPT_SAMPLE = 400;
/** A script counts for a deck when at least this share of the notes read have it, so one Greek letter in a physics note doesn't. */
export const SCRIPT_SHARE = 0.1;

/**
 * The scripts a deck's cards need: those in at least `SCRIPT_SHARE` of the notes of the deck and its
 * subdecks (up to `SCRIPT_SAMPLE`, spread across them). A deck with no notes needs none.
 */
export function deckScripts(deck: string, notes: Iterable<Note>): Script[] {
  const inDeck: Note[] = [];
  for (const n of notes) if (n.deck === deck || n.deck.startsWith(`${deck}::`)) inDeck.push(n);
  if (inDeck.length === 0) return [];
  const step = Math.max(1, Math.floor(inDeck.length / SCRIPT_SAMPLE));
  const counts = new Map<Script, number>();
  let read = 0;
  for (let i = 0; i < inDeck.length; i += step) {
    read++;
    for (const s of scriptsIn(Object.values(inDeck[i].fields).join(' '))) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return RANGES.map(([s]) => s).filter((s) => (counts.get(s) ?? 0) >= Math.max(1, read * SCRIPT_SHARE));
}
