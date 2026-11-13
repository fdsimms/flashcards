// Word meanings on a card's example sentence: the sentence split and glossed by Read & Listen's
// server as a text's lines are, so each word can be tapped for the reader's popover. Asked for once
// when a study session starts, for every example sentence in it (one call per language), and kept
// for as long as the app runs. Only reads: nothing here grades or writes a card. Pure, so it's tested;
// ui/useCardGlosses.ts asks the server and ui/CardSentence.tsx draws the words.
import { cardHomeDeck } from '../core/deckTree';
import type { Segment } from '../core/highlight';
import { htmlToText } from '../core/html';
import type { Card, Note } from '../core/types';
import type { Language, Word } from './api';
import { languageOfDeck } from './practice';

/** At most this many sentences are asked about in one call (the server's MAX_GLOSS_SENTENCES). */
export const MAX_SENTENCES = 1000;

export type GlossSentence = { text: string; english: string };
export type GlossRequest = { language: Language; sentences: GlossSentence[] };

/** How a sentence's words are kept: its language and its text as the card shows it. */
export function glossKey(language: Language, text: string): string {
  return `${language}\u0000${text}`;
}

/**
 * The language a card's example sentence is in: the Read & Listen language whose deck holds the
 * card's own deck (its home deck, so a card pulled into a filtered deck still counts), or null.
 */
export function cardLanguage(card: Card, note: Note, decks: Partial<Record<Language, string>>): Language | null {
  return languageOfDeck(cardHomeDeck(card, note.deck), decks);
}

/**
 * The example sentences of `cards` to ask about, by language, as the card shows them (the Context
 * field as plain text) with their English (ContextTranslation), once each and in the order the
 * cards come up. `asked` holds the keys already asked about, which are left out.
 */
export function glossRequests(
  cards: Card[], notes: Map<string, Note>, decks: Partial<Record<Language, string>>, asked: ReadonlySet<string> = new Set(),
): GlossRequest[] {
  const out = new Map<Language, GlossRequest>();
  const seen = new Set(asked);
  for (const card of cards) {
    const note = notes.get(card.noteId);
    if (!note) continue;
    const text = htmlToText(note.fields.Context ?? '');
    if (!text) continue;
    const language = cardLanguage(card, note, decks);
    if (!language || seen.has(glossKey(language, text))) continue;
    seen.add(glossKey(language, text));
    const request = out.get(language) ?? { language, sentences: [] };
    out.set(language, request);
    if (request.sentences.length < MAX_SENTENCES) request.sentences.push({ text, english: htmlToText(note.fields.ContextTranslation ?? '') });
  }
  return [...out.values()];
}

/**
 * The server's answer for `request`, by `glossKey`. A sentence whose words don't join back to it
 * exactly is left out, so the card shows it as it was rather than words that don't match it.
 */
export function glossesOf(request: GlossRequest, answer: Word[][]): Map<string, Word[]> {
  const out = new Map<string, Word[]>();
  request.sentences.forEach((s, i) => {
    const words = answer[i];
    if (words?.length && words.map((w) => w.text).join('') === s.text) out.set(glossKey(request.language, s.text), words);
  });
  return out;
}

/** A word to tap, a space or a piece of punctuation, with the parts of it the card highlights. */
export type SentencePiece = { word: Word; parts: Segment[]; tappable: boolean; marked: boolean };

/**
 * `words` with the card's highlight (`segments`, the card's word in bold or found in the
 * sentence) cut into them, so a word holding the highlight draws it as the card does today. With
 * segments that don't spell the same text, nothing is highlighted.
 */
export function sentencePieces(words: Word[], segments: Segment[] | undefined): SentencePiece[] {
  const text = words.map((w) => w.text).join('');
  const marks: [number, number][] = [];
  if (segments && segments.map((s) => s.text).join('') === text) {
    let at = 0;
    for (const s of segments) {
      if (s.marked) marks.push([at, at + s.text.length]);
      at += s.text.length;
    }
  }
  let at = 0;
  return words.map((word) => {
    const start = at;
    const end = at + word.text.length;
    at = end;
    const cuts = new Set([start, end]);
    for (const [s, e] of marks) for (const x of [s, e]) if (x > start && x < end) cuts.add(x);
    const edges = [...cuts].sort((a, b) => a - b);
    const parts: Segment[] = [];
    for (let i = 0; i < edges.length - 1; i++) {
      const [s, e] = [edges[i], edges[i + 1]];
      const marked = marks.some(([ms, me]) => s >= ms && e <= me);
      parts.push({ text: word.text.slice(s - start, e - start), marked });
    }
    return { word, parts, tappable: word.status !== null, marked: parts.some((p) => p.marked) };
  });
}

/**
 * Whether a tick is drawn after each piece: where one word ends and the next begins with nothing
 * between them (Thai and Japanese, written without spaces), so the split shows. The screen leaves
 * out the one at the end of a line.
 */
export function wordBreaks(pieces: SentencePiece[]): boolean[] {
  return pieces.map((p, i) => p.tappable && !!pieces[i + 1]?.tappable);
}

/** The dots of a word's dotted underline: `size` wide, about `pitch` apart, the first at 0 and the last ending at `width`. */
export function dotOffsets(width: number, size = 2, pitch = 5): number[] {
  if (width < size) return [];
  const n = Math.max(1, Math.round((width - size) / pitch) + 1);
  if (n === 1) return [(width - size) / 2];
  const step = (width - size) / (n - 1);
  return Array.from({ length: n }, (_, i) => i * step);
}
