import { isOmnilanguage, speechLangFor } from './cards';
import { studyDayStart } from './day';
import { inheritedSetting } from './deckTree';
import { formsOf, headword, withoutArticle, type PracticeRecord } from './forms';
import { htmlToText } from './html';
import type { Card, DeckSettings, Note, ReviewLogEntry } from './types';

/**
 * Lookalike words: notes whose words look alike (esperar, espero, esperanza), so seeing one can
 * give away the answer to another. Two things use this:
 * - keeping them apart: once a word is seen (a card answered, or its forms practiced), the New
 *   and Review cards of its lookalikes wait a day or more, as Anki buries a note's siblings;
 * - showing a card sooner: when a lookalike got through anyway, the answer side offers to schedule
 *   the card as if it had been reviewed when the lookalike was seen (`soonerOffer`).
 * Only Omnilanguage notes, and only within one language.
 */

/** The shortest shared beginning that makes two words lookalikes. */
const MIN_SHARED = 4;
/** And the share of the shorter word it has to cover: esper(ar)/esper(o) 5 of 6, espera(r)/espera(nza) 6 of 8. */
const MIN_SHARE = 0.75;

const unmarked = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');

/** A word as it's compared: lower case, no accents, no article, nothing after a bracket or dash. */
export function lookalikeForm(word: string): string {
  const head = word.split(/\s[(—–-]|\(|,/)[0].trim();
  return unmarked(withoutArticle(head).toLocaleLowerCase()).replace(/\s+/g, ' ').trim();
}

function language(note: Note): string {
  return speechLangFor(note) ?? note.deck.split('::').slice(0, 2).join('::');
}

function sharedStart(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Whether two compared words look alike: one starts most of the way into the other. */
export function wordsLookAlike(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const shared = sharedStart(a, b);
  return shared >= MIN_SHARED && shared >= MIN_SHARE * Math.min(a.length, b.length);
}

/**
 * Each note's lookalikes, by note id. Two notes are lookalikes when their words look alike, or
 * when one's word is among the other's listed forms (Forms, KeyForms).
 */
export function lookalikeIndex(notes: Note[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    (out.get(a) ?? out.set(a, new Set()).get(a)!).add(b);
    (out.get(b) ?? out.set(b, new Set()).get(b)!).add(a);
  };
  const byLang = new Map<string, { id: string; word: string; forms: Set<string> }[]>();
  for (const n of notes) {
    if (!isOmnilanguage(n)) continue;
    const word = lookalikeForm(headword(n));
    if (!word) continue;
    const forms = new Set<string>();
    for (const f of formsOf(n).forms) if (!f.key.startsWith('field:Gender')) for (const a of f.answers) forms.add(lookalikeForm(a));
    for (const k of htmlToText(n.fields.KeyForms ?? '').split(/[,;\n]/)) if (k.trim()) forms.add(lookalikeForm(k));
    const lang = language(n);
    (byLang.get(lang) ?? byLang.set(lang, []).get(lang)!).push({ id: n.id, word, forms });
  }
  for (const words of byLang.values()) {
    // Words sharing a beginning of MIN_SHARED letters are the only ones that can look alike.
    const buckets = new Map<string, typeof words>();
    const byWord = new Map<string, string[]>();
    for (const w of words) {
      const b = w.word.slice(0, MIN_SHARED);
      (buckets.get(b) ?? buckets.set(b, []).get(b)!).push(w);
      (byWord.get(w.word) ?? byWord.set(w.word, []).get(w.word)!).push(w.id);
    }
    for (const bucket of buckets.values()) {
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          if (wordsLookAlike(bucket[i].word, bucket[j].word)) link(bucket[i].id, bucket[j].id);
        }
      }
    }
    for (const w of words) for (const f of w.forms) for (const id of byWord.get(f) ?? []) link(w.id, id);
  }
  return out;
}

/** A word seen: one of its cards answered, or its forms practiced. */
export interface SeenEvent {
  noteId: string;
  at: Date;
  how: 'review' | 'practice';
}

/** Every word seen in `reviews` (answers) and `practice`, for holding lookalikes back and offering to show a card sooner. */
export function seenEvents(reviews: ReviewLogEntry[], noteOfCard: Map<string, string>, practice: PracticeRecord[]): SeenEvent[] {
  const out: SeenEvent[] = [];
  for (const r of reviews) {
    const noteId = noteOfCard.get(r.cardId);
    if (noteId) out.push({ noteId, at: new Date(r.reviewedAt), how: 'review' });
  }
  for (const p of practice) out.push({ noteId: p.noteId, at: new Date(p.practicedAt), how: 'practice' });
  return out;
}

/** How far back seen words are read: the longest a lookalike can be held, or offer to show a card sooner. */
export const SEEN_LOOKBACK_DAYS = 3;

/** Where reading seen words starts (`listReviews`, `listPractice`): the start of the earliest study day they can matter on. */
export function seenSince(now: Date, dayStartsAtHour: number): Date {
  return windowStart(now, dayStartsAtHour, SEEN_LOOKBACK_DAYS);
}

/** The lookalike settings for a deck: its own, else its nearest ancestor's, else the defaults. */
export interface LookalikeSettings {
  keepApart: boolean;
  /** Study days a lookalike waits: 1 is until tomorrow. */
  days: number;
  offerSooner: boolean;
}

export const LOOKALIKE_DAY_CHOICES = [1, 2, 3] as const;

export function lookalikeSettings(deck: string, all: Map<string, DeckSettings>): LookalikeSettings {
  return {
    keepApart: inheritedSetting(deck, all, 'keepLookalikesApart') ?? true,
    days: inheritedSetting(deck, all, 'lookalikeDays') ?? 1,
    offerSooner: inheritedSetting(deck, all, 'offerSooner') ?? true,
  };
}

/** The start of the study day `days - 1` days before the one `now` is in. */
function windowStart(now: Date, dayStartsAtHour: number, days: number): Date {
  const start = studyDayStart(now, dayStartsAtHour);
  start.setDate(start.getDate() - (days - 1));
  return start;
}

/** The latest time a lookalike of `noteId` was seen at or after `since`. */
function latestLookalike(noteId: string, index: Map<string, Set<string>>, events: SeenEvent[], since: Date): SeenEvent | undefined {
  const related = index.get(noteId);
  if (!related) return undefined;
  let best: SeenEvent | undefined;
  for (const e of events) {
    if (e.at < since || !related.has(e.noteId)) continue;
    if (!best || e.at > best.at) best = e;
  }
  return best;
}

/**
 * Cards held back because a lookalike was seen within their deck's window. Only New and Review
 * cards wait, as Anki buries only those: a card in learning keeps its steps. Nothing is written:
 * a held card is simply left out of the queue, and comes back once the window has passed.
 */
export function heldCards(input: {
  cards: Card[];
  deckOf: Map<string, string>;
  index: Map<string, Set<string>>;
  events: SeenEvent[];
  settings: Map<string, DeckSettings>;
  now: Date;
  dayStartsAtHour: number;
}): Set<string> {
  const held = new Set<string>();
  if (!input.events.length) return held;
  const perDeck = new Map<string, LookalikeSettings>();
  for (const c of input.cards) {
    if (c.sched.state !== 0 && c.sched.state !== 2) continue;
    if (!input.index.has(c.noteId)) continue;
    const deck = input.deckOf.get(c.noteId) ?? '';
    const s = perDeck.get(deck) ?? perDeck.set(deck, lookalikeSettings(deck, input.settings)).get(deck)!;
    if (!s.keepApart) continue;
    const seen = latestLookalike(c.noteId, input.index, input.events, windowStart(input.now, input.dayStartsAtHour, s.days));
    // A card answered since its lookalike was seen has already had its turn.
    if (seen && !(c.sched.lastReview && new Date(c.sched.lastReview) >= seen.at)) held.add(c.id);
  }
  return held;
}

/** How far back a lookalike makes the answer side offer to show a card sooner: today and two days before. */
export const SOONER_DAYS = SEEN_LOOKBACK_DAYS;

/**
 * The lookalike that may have given away a Review card's answer: one seen since the card was last
 * reviewed, within `SOONER_DAYS`. Scheduling the answer from that moment instead of the last
 * review gives the smaller interval FSRS gives a card reviewed then (`countFrom` in scheduler.ts).
 */
export function soonerOffer(input: {
  card: Card;
  index: Map<string, Set<string>>;
  events: SeenEvent[];
  now: Date;
  dayStartsAtHour: number;
}): SeenEvent | undefined {
  const { card } = input;
  if (card.sched.state !== 2 || !card.sched.lastReview) return undefined;
  const last = new Date(card.sched.lastReview);
  const since = windowStart(input.now, input.dayStartsAtHour, SOONER_DAYS);
  const seen = latestLookalike(card.noteId, input.index, input.events, since > last ? since : last);
  return seen && seen.at > last && seen.at <= input.now ? seen : undefined;
}

/** "earlier today", "yesterday", "2 days ago", by study days. */
export function whenSeen(at: Date, now: Date, dayStartsAtHour: number): string {
  const days = Math.round((studyDayStart(now, dayStartsAtHour).getTime() - studyDayStart(at, dayStartsAtHour).getTime()) / 86400000);
  return days <= 0 ? 'earlier today' : days === 1 ? 'yesterday' : `${days} days ago`;
}
