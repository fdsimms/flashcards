// Your words (docs/read-and-listen/architecture.md, "Your words"): which of a deck's words go into
// a listening lesson, with what they mean and an example, for the server to speak. Pure, so it's
// tested. It reads cards and the review log and writes nothing: hearing a word isn't answering it,
// and nothing here may import what schedules or writes a card (tests/core/listenWords.test.ts).
import { isInDeck } from './deckTree';
import { examplesOf } from './examples';
import { headword } from './forms';
import { htmlToText } from './html';
import { isOmnilanguage } from './cards';
import { isDue } from './queue';
import { isSkillNote } from './skillTag';
import type { Card, Note, ReviewLogEntry } from './types';

/** The lesson sizes offered, and the one chosen first. */
export const LISTEN_COUNTS = [10, 30, 60] as const;
export type ListenCount = (typeof LISTEN_COUNTS)[number];
export const DEFAULT_LISTEN_COUNT: ListenCount = 30;
/** The fewest a lesson is made of (the server's `lesson.WORDS_MIN`). */
export const LISTEN_MIN = 3;
/** How far back a word counts as started lately: its first answer within this many days. */
export const RECENT_DAYS = 14;

/** Longer than this, a meaning or an example is left out rather than read out at length. */
const MEANING_MAX = 120;
const EXAMPLE_MAX = 200;

export interface ListenWord {
  noteId: string;
  text: string;
  english: string;
  example?: string;
  exampleEnglish?: string;
  /** Why it was picked: a card due today, or started lately. */
  why: 'due' | 'recent';
}

const plain = (html: string | undefined): string => htmlToText(html ?? '').replace(/\s+/g, ' ').trim();

/** The cards first answered in the last `RECENT_DAYS`, from the review log since then. */
export function startedSince(reviews: readonly ReviewLogEntry[], since: Date): Set<string> {
  const after = since.getTime();
  return new Set(reviews.filter((r) => r.state === 0 && Date.parse(r.reviewedAt) >= after).map((r) => r.cardId));
}

/**
 * The words for a listening lesson from `deck` and its subdecks: notes with a card due today first,
 * soonest due first, then notes with a card started lately (`started`), newest first, up to `count`.
 * Only Omnilanguage notes with a word and a meaning, no skill cards, and no suspended cards.
 */
export function pickListenWords({ notes, cards, started, deck, now, dayStartsAtHour, count }: {
  notes: readonly Note[];
  cards: readonly Card[];
  /** Card ids first answered lately (`startedSince`). */
  started: ReadonlySet<string>;
  deck: string;
  now: Date;
  dayStartsAtHour: number;
  count: number;
}): ListenWord[] {
  const byNote = new Map<string, Card[]>();
  for (const card of cards) {
    if (card.suspended || card.retired) continue;
    const list = byNote.get(card.noteId);
    if (list) list.push(card); else byNote.set(card.noteId, [card]);
  }
  const due: { note: Note; at: number }[] = [];
  const recent: { note: Note; at: number }[] = [];
  for (const note of notes) {
    if (!isOmnilanguage(note) || isSkillNote(note) || !isInDeck(note.deck, deck)) continue;
    const own = byNote.get(note.id) ?? [];
    const dueCards = own.filter((c) => isDue(c, now, dayStartsAtHour));
    if (dueCards.length) {
      due.push({ note, at: Math.min(...dueCards.map((c) => Date.parse(c.sched.due))) });
      continue;
    }
    const begun = own.filter((c) => started.has(c.id) && c.sched.lastReview);
    if (begun.length) recent.push({ note, at: Math.max(...begun.map((c) => Date.parse(c.sched.lastReview!))) });
  }
  due.sort((a, b) => a.at - b.at);
  recent.sort((a, b) => b.at - a.at);
  const picked: ListenWord[] = [];
  for (const [list, why] of [[due, 'due'], [recent, 'recent']] as const) {
    for (const { note } of list) {
      if (picked.length >= count) return picked;
      const word = wordOf(note, why);
      if (word) picked.push(word);
    }
  }
  return picked;
}

function wordOf(note: Note, why: ListenWord['why']): ListenWord | null {
  const text = headword(note);
  const english = plain(note.fields.Meaning);
  if (!text || !english || english.length > MEANING_MAX) return null;
  const example = examplesOf(note).find((e) => e.context.trim() && e.context.length <= EXAMPLE_MAX);
  return {
    noteId: note.id,
    text,
    english,
    ...(example ? { example: plain(example.context), ...(example.translation.trim() ? { exampleEnglish: plain(example.translation) } : {}) } : {}),
    why,
  };
}

/** What the card says will go in: "18 due today and 12 started lately". */
export function listenSummary(words: readonly ListenWord[]): string {
  const due = words.filter((w) => w.why === 'due').length;
  const recent = words.length - due;
  const parts = [due ? `${due} due today` : '', recent ? `${recent} started in the last two weeks` : ''].filter(Boolean);
  return parts.join(' and ');
}

/** About how long the lesson runs, in minutes: each word with its pause, meaning and example. */
export function listenMinutes(words: readonly ListenWord[]): number {
  const seconds = words.reduce((sum, w) => sum + 9 + (w.example ? 8 : 0), 10);
  return Math.max(1, Math.round(seconds / 60));
}
