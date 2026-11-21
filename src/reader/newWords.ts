// New words for a language deck whose new cards are running low: which decks are, what Today's card
// and the finished session's row say, which suggested words start ticked, and which the phone's own
// copy of the deck already has (the server's snapshot of it can be a day old). The words come from
// Read & Listen's server (word_suggestions.py) and go to the note queue, where each is filled in and
// then saved, or not, in the note editor. Nothing here adds a note or touches a card. Pure, so it's tested.
import { isInDeck } from '../core/deckTree';
import type { Card, Note } from '../core/types';
import type { Language, WordSuggestion, WordSuggestions } from './api';
import { MAX_QUEUED } from '../core/quickAdd';

/** A language deck with fewer days of new cards than this is running low. */
export const RUNWAY_DAYS = 3;

/** A language deck running low on new cards. */
export interface LowDeck {
  deck: string;
  language: Language;
  /** New cards never studied and not suspended, in the deck and its subdecks. */
  left: number;
  /** The deck's own daily new card limit. */
  perDay: number;
}

/**
 * The language decks (`options`, Quick add's choice: `quickAddDecks`) with fewer than RUNWAY_DAYS of
 * new cards left at their own daily limit, the lowest first. Left out: a deck taking no new cards (a
 * limit of 0), one whose row doesn't say its limit yet, a deck with words already waiting for it in
 * the note queue or held offline (`waiting`: the queue's own card on Today says so), one dismissed
 * today, and every deck while vacation mode is on, since no new cards are coming in anyway.
 */
export function lowDecks(a: {
  options: { deck: string; language: Language }[];
  rows: { deck: string; unstudied: number; newPerDay?: number }[];
  waiting: ReadonlySet<string>;
  dismissed: (deck: string) => boolean;
  onVacation: boolean;
}): LowDeck[] {
  if (a.onVacation) return [];
  const out: LowDeck[] = [];
  for (const { deck, language } of a.options) {
    const row = a.rows.find((r) => r.deck === deck);
    const perDay = row?.newPerDay;
    if (!row || !perDay || perDay <= 0 || a.waiting.has(deck) || a.dismissed(deck)) continue;
    if (row.unstudied < RUNWAY_DAYS * perDay) out.push({ deck, language, left: row.unstudied, perDay });
  }
  return out.sort((x, y) => x.left / x.perDay - y.left / y.perDay);
}

/** The decks with words waiting for them: in the note queue (any state) or held on the phone. */
export function decksWaiting(queued: readonly { deck: string }[], held: readonly { deck: string; entries: readonly unknown[] }[]): Set<string> {
  return new Set([...queued.map((n) => n.deck), ...held.filter((g) => g.entries.length).map((g) => g.deck)]);
}

/** "2 days of new cards left", "Less than a day of new cards left", "No new cards left". */
export function runwayText(left: number, perDay: number): string {
  if (left <= 0) return 'No new cards left';
  const days = Math.floor(left / perDay);
  if (days < 1) return 'Less than a day of new cards left';
  return days === 1 ? '1 day of new cards left' : `${days} days of new cards left`;
}

/**
 * Cards per note in the deck and its subdecks (an Omnilanguage note has a Front, often a Reverse and
 * an Audio card), so ticking words for so many days' cards ticks the right number of notes. 1 for a
 * deck with no notes yet.
 */
export function cardsPerNote(deck: string, notes: readonly Note[], cards: readonly Card[]): number {
  const ids = new Set(notes.filter((n) => isInDeck(n.deck, deck)).map((n) => n.id));
  if (!ids.size) return 1;
  const count = cards.filter((c) => ids.has(c.noteId) && !c.retired).length;
  return Math.max(1, count / ids.size);
}

/** How many words start ticked: enough notes for RUNWAY_DAYS of the deck's new cards, at most Quick add's limit. */
export function wordsToTick(perDay: number, perNote: number): number {
  return Math.min(MAX_QUEUED, Math.max(1, Math.ceil((RUNWAY_DAYS * perDay) / Math.max(1, perNote))));
}

/** What a word is compared by: case, accents kept, spacing and a leading article's case aside. */
const fold = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();

/**
 * Whether the deck already has the word: an entry the same, or the same after its first word (an
 * article or a marker: "la receta" for receta, "to" for an English verb). Only what the server's day-old
 * snapshot can miss, a note saved since; the server matched every form already.
 */
export function inDeck(word: string, entries: ReadonlySet<string>): boolean {
  return entries.has(fold(word));
}

/** The deck's entries (`headword`s) as `inDeck` compares them, each with and without its first word. */
export function entryKeys(headwords: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const h of headwords) {
    const key = fold(h);
    if (!key) continue;
    out.add(key);
    const rest = key.split(' ').slice(1).join(' ');
    if (rest) out.add(rest);
  }
  return out;
}

export type SuggestionSection = { key: 'texts' | 'common' | 'written'; title: string; words: WordSuggestion[] };

/**
 * The screen's sections, in order, without the words the deck has (`entries`) or that are held for
 * Claude (`held`), and without any dismissed here since the list was read (`dismissed`). A section with
 * none left isn't shown.
 */
export function suggestionSections(s: WordSuggestions, entries: ReadonlySet<string>, held: ReadonlySet<string>, dismissed: ReadonlySet<string>): SuggestionSection[] {
  const keep = (w: WordSuggestion) => !inDeck(w.word, entries) && !held.has(fold(w.word)) && !dismissed.has(w.word);
  return ([
    { key: 'texts', title: 'From texts you read', words: s.texts.filter(keep) },
    { key: 'common', title: 'Common words not in the deck', words: s.common.filter(keep) },
    { key: 'written', title: 'Rare words from Claude', words: s.written.filter(keep) },
  ] as SuggestionSection[]).filter((x) => x.words.length);
}

/** The held words' keys, as `suggestionSections` compares them. */
export function heldKeys(held: readonly { deck: string; entries: readonly { entry: string }[] }[], deck: string): Set<string> {
  return new Set(held.filter((g) => g.deck === deck).flatMap((g) => g.entries.map((e) => fold(e.entry))));
}

/** The first `count` words, in the order shown (from texts first): the ones that start ticked. */
export function firstTicked(sections: readonly SuggestionSection[], count: number): Set<string> {
  return new Set(sections.flatMap((s) => s.words.map((w) => w.word)).slice(0, count));
}

/** What a row says under the word: its meaning when known, then where it came from. */
export function suggestionDetail(w: WordSuggestion): string {
  const where = w.texts > 0
    ? (w.texts === 1 ? 'in 1 text' : `in ${w.texts} texts`)
    : w.rank !== null ? `#${w.rank.toLocaleString('en-US')} most common` : '';
  return [w.meaning, where].filter(Boolean).join(' · ');
}

/**
 * The ticked words as the note queue takes them, in the order shown. No meaning goes with them: one
 * given is kept as the owner's own, and a gloss from a text is only that line's sense, so Claude
 * writes the meaning as it does for a typed word.
 */
export function tickedEntries(sections: readonly SuggestionSection[], ticked: ReadonlySet<string>): { entry: string; meaning: string }[] {
  return sections.flatMap((s) => s.words).filter((w) => ticked.has(w.word)).map((w) => ({ entry: w.word, meaning: '' }));
}

/** The study day's key a deck's Today card was dismissed on, by deck. */
export type Dismissals = Record<string, string>;

export function parseDismissals(raw: string | null): Dismissals {
  try {
    const v = raw ? JSON.parse(raw) : {};
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
}

/** Dismissed on `todayKey`: hidden until the next study day, then shown again while still low. Older days are dropped. */
export function dismissOn(d: Dismissals, deck: string, todayKey: string): Dismissals {
  return { ...Object.fromEntries(Object.entries(d).filter(([, day]) => day === todayKey)), [deck]: todayKey };
}
