// "From your reading" on a card's answer side: a line from a text the learner has read that uses the card's
// word (server reading_lines.py), under the note's own example sentence, a different one at each review while
// there are several. A word is learned from meeting it in several contexts, and the note's sentence is the same
// every time. Pure, so it's tested; src/ui/useReadingLines.ts asks the server. Nothing here grades a card.
import { isOmnilanguage } from '../core/cards';
import { htmlToText } from '../core/html';
import type { Card, Note, RenderedSide } from '../core/types';
import type { Language, ReadingLine } from './api';
import { cardLanguage } from './cardGlosses';

type Block = RenderedSide['blocks'][number];

/** The most words one request asks about (the server's MAX_WORDS). */
export const MAX_WORDS = 1000;

/** The word a card's lines are asked for: an Omnilanguage note's Entry, as plain text. */
export function lineWord(note: Note): string {
  return isOmnilanguage(note) ? htmlToText(note.fields.Entry ?? '').trim() : '';
}

export const lineKey = (language: Language, word: string) => `${language}:${word}`;

/** The words of `cards` to ask about, by language, once each. `asked` holds the keys already asked about. */
export function readingLineRequests(
  cards: readonly Card[], notes: Map<string, Note>, decks: Partial<Record<Language, string>>, asked: ReadonlySet<string> = new Set(),
): { language: Language; words: string[] }[] {
  const out = new Map<Language, string[]>();
  const seen = new Set(asked);
  for (const card of cards) {
    const note = notes.get(card.noteId);
    if (!note) continue;
    const language = cardLanguage(card, note, decks);
    const word = lineWord(note);
    if (!language || !word || seen.has(lineKey(language, word))) continue;
    seen.add(lineKey(language, word));
    const words = out.get(language) ?? [];
    out.set(language, words);
    if (words.length < MAX_WORDS) words.push(word);
  }
  return [...out].map(([language, words]) => ({ language, words }));
}

/**
 * The line to show this time: they take turns by how many times the card has been answered, so the
 * same review always shows the same line and the next review the next one. Never the note's own
 * sentence over again (`own`: its examples as plain text).
 */
export function lineFor(lines: readonly ReadingLine[] | undefined, reps: number, own: readonly string[] = []): ReadingLine | undefined {
  const fresh = (lines ?? []).filter((l) => !own.includes(l.line));
  return fresh.length ? fresh[Math.max(0, reps) % fresh.length] : undefined;
}

const isExample = (b: Block) => b.role === 'example' || b.role === 'exampleRomanized' || b.role === 'exampleTranslation';

/** An answer side's blocks with the line in its own labeled box, right after the note's example sentences (at the end with none). */
export function withReadingLine(blocks: readonly Block[], line: ReadingLine | undefined): Block[] {
  if (!line) return [...blocks];
  const box: Block = { label: `From your reading: ${line.title}`, text: line.line };
  let at = -1;
  blocks.forEach((b, i) => { if (isExample(b)) at = i; });
  return at < 0 ? [...blocks, box] : [...blocks.slice(0, at + 1), box, ...blocks.slice(at + 1)];
}
