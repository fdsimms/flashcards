import type { Language } from '../reader/api';
import { isOmnilanguage } from './cards';
import { addCalendarDays, nextStudyDayStart, studyDayKey, studyDayStart } from './day';
import { headword } from './forms';
import { htmlToText } from './html';
import { readerLanguageOf } from './leechHint';
import { noteHasTag } from './priority';
import type { Card, Note } from './types';

/**
 * A cram (Practice, Cram): a set of words to know by a date, a lesson with a tutor say, or a trip.
 * The words are the notes carrying the cram's tag (`cram::<id>`), so Anki and Claude see them too
 * and can add to them. Until the date:
 *
 * - **Rounds**, short passes through every word, meaning asked and word answered, are offered a few
 *   hours apart (`nextRoundAt`). They are practice, never a rating: a round's Missed it and Got it
 *   are kept in the cram, on the phone, and nothing reaches FSRS (`cramRound.ts`,
 *   tests/core/cramRound.test.ts).
 * - **The review cap**: a card in a cram whose next review would land after the date is due on the
 *   date instead (`capDays`, passed to the scheduler's `review`, and `cardsToCap` for cards already
 *   scheduled past it). Only ever earlier, so FSRS still sees the real time between reviews.
 *
 * Afterwards, the words used on the day are checked off (At the lesson), and the ones not used are
 * offered to the next cram (`carryOver`). Pure, so it's tested; the phone keeps crams in SQLite
 * (`Repo.listCrams`) and `src/ui/useCrams.ts` reads them.
 */

export const CRAM_TAG_PREFIX = 'cram::';
/** The least time between the end of one round and the start of the next. */
export const ROUND_GAP_HOURS = 4;
/** The most rounds offered in one study day. */
export const ROUNDS_PER_DAY = 2;
const HOUR_MS = 3600000;

export interface CramRound {
  /** When the round ended, ISO. */
  finishedAt: string;
  /** Every note in the round, so a word added afterwards reads as not yet practiced. */
  noteIds: string[];
  /** The notes missed at least once in the round. */
  missed: string[];
}

export interface Cram {
  /** The tag's last part, from the name and date (`cramId`). */
  id: string;
  name: string;
  /** The day it's for, `YYYY-MM-DD` (a calendar day; its study day is the one starting that morning). */
  date: string;
  createdAt: string;
  /** New notes made in the note editor while the cram runs get its tag (`runningCramTags`). */
  addNew: boolean;
  rounds: CramRound[];
  /** Notes brought in from the cram before, unused there: shown as "From last time" until practiced. */
  carriedIn?: string[];
  /** When At the lesson's Finish was pressed: the cram is over, and its tag is taken off its notes. */
  finishedAt?: string;
  /** The notes checked off as used on the day. */
  used?: string[];
  /** The notes not used, once finished: offered to the next cram. */
  unused?: string[];
  /** The cram the unused notes were taken into, once they were. */
  carriedTo?: string;
  /** The audio lesson made from the words (Read & Listen), and the words it was made from. */
  lesson?: { id: number; noteIds: string[] };
}

/** The tag a cram's notes carry. */
export const cramTag = (cram: Pick<Cram, 'id'>) => `${CRAM_TAG_PREFIX}${cram.id}`;

/**
 * The id for a new cram: the name in lowercase letters and digits joined by hyphens, then the date,
 * so two crams named "Thai lesson" on different days get different tags. Characters an Anki search
 * treats specially (`_`, `*`, quotes, spaces, `:`) never get in. One already taken gets a number.
 */
export function cramId(name: string, date: string, taken: Iterable<string> = []): string {
  const words = name.toLowerCase().normalize('NFC').match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  const base = [...words, date].join('-');
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Why a name or date can't be saved, in the words to show, or undefined when they can. */
export function cramProblem(name: string, date: string, now: Date, dayStartsAtHour: number): string | undefined {
  if (!name.trim()) return 'Give the cram a name, for example "Thai lesson".';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Choose a date.';
  if (date < studyDayKey(now, dayStartsAtHour)) return 'Choose today or a day after it.';
  return undefined;
}

/** The date as a local Date at noon, clear of any DST change at midnight. */
export function cramDay(cram: Pick<Cram, 'date'>): Date {
  const [y, m, d] = cram.date.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

/** The start of the cram's study day: its date at the hour the study day starts (a 1 PM rollover too). */
export function cramDayStart(cram: Pick<Cram, 'date'>, dayStartsAtHour: number): Date {
  const [y, m, d] = cram.date.split('-').map(Number);
  return new Date(y, m - 1, d, dayStartsAtHour);
}

/** When the cram's day ends: the start of the study day after it. */
export const cramEnd = (cram: Pick<Cram, 'date'>, dayStartsAtHour: number) => nextStudyDayStart(cramDayStart(cram, dayStartsAtHour), dayStartsAtHour);

/** Running: not finished, and its day hasn't ended. Rounds, the cap and adding new cards apply only then. */
export const isRunning = (cram: Cram, now: Date, dayStartsAtHour: number) => !cram.finishedAt && now < cramEnd(cram, dayStartsAtHour);

/** Its day has ended and At the lesson's Finish hasn't been pressed: Today asks how it went. */
export const isAwaitingFinish = (cram: Cram, now: Date, dayStartsAtHour: number) => !cram.finishedAt && now >= cramEnd(cram, dayStartsAtHour);

/** Study days from today to the cram's day: 0 on the day itself. */
export function daysUntil(cram: Pick<Cram, 'date'>, now: Date, dayStartsAtHour: number): number {
  const from = studyDayStart(now, dayStartsAtHour);
  const to = cramDayStart(cram, dayStartsAtHour);
  // Whole days between two day starts, rounded so a DST change's 23 or 25 hours count as one.
  return Math.round((to.getTime() - from.getTime()) / (24 * HOUR_MS));
}

/** The notes in a cram: those carrying its tag. */
export const cramNotes = (cram: Pick<Cram, 'id'>, notes: Iterable<Note>): Note[] => [...notes].filter((n) => noteHasTag(n, cramTag(cram)));

/**
 * When the next round opens: `ROUND_GAP_HOURS` after the last one ended, and never a third in one
 * study day (the next day's start instead). At or before `now` means one is open now. Undefined
 * when no round is left before the cram's day ends, or it's finished.
 */
export function nextRoundAt(cram: Cram, now: Date, dayStartsAtHour: number): Date | undefined {
  if (cram.finishedAt) return undefined;
  const end = cramEnd(cram, dayStartsAtHour);
  if (now >= end) return undefined;
  const last = cram.rounds.at(-1);
  let at = last ? new Date(new Date(last.finishedAt).getTime() + ROUND_GAP_HOURS * HOUR_MS) : now;
  const day = studyDayKey(at > now ? at : now, dayStartsAtHour);
  const doneThatDay = cram.rounds.filter((r) => studyDayKey(new Date(r.finishedAt), dayStartsAtHour) === day).length;
  if (doneThatDay >= ROUNDS_PER_DAY) at = nextStudyDayStart(at > now ? at : now, dayStartsAtHour);
  return at < end ? at : undefined;
}

export type WordState = 'missed' | 'got' | 'carried' | 'new' | 'none';

/**
 * What the cram page says about a word: missed or got in the last round it was in, else brought
 * in from the last cram, else not studied yet (`isNew`: every card of the note still New), else nothing.
 */
export function wordState(cram: Cram, noteId: string, isNew: boolean): WordState {
  const last = [...cram.rounds].reverse().find((r) => r.noteIds.includes(noteId));
  if (last) return last.missed.includes(noteId) ? 'missed' : 'got';
  if (cram.carriedIn?.includes(noteId)) return 'carried';
  return isNew ? 'new' : 'none';
}

/** The notes missed in the last round, which the next round asks first. */
export const lastMissed = (cram: Cram): Set<string> => new Set(cram.rounds.at(-1)?.missed ?? []);

/** The cram with a round added. */
export const withRound = (cram: Cram, round: CramRound): Cram => ({ ...cram, rounds: [...cram.rounds, round] });

/** The cram finished at the lesson: the notes checked off are used, the rest are kept for the next cram. */
export function finished(cram: Cram, noteIds: string[], used: Iterable<string>, now: Date): Cram {
  const usedSet = new Set(used);
  return {
    ...cram,
    finishedAt: now.toISOString(),
    used: noteIds.filter((id) => usedSet.has(id)),
    unused: noteIds.filter((id) => !usedSet.has(id)),
  };
}

/**
 * The words a new cram may bring in from the last one: the unused notes of the cram finished
 * most recently, unless they were already taken into another. Notes deleted since are left out.
 */
export function carryOver(crams: Cram[], noteIds: Set<string>): { from: Cram; noteIds: string[] } | undefined {
  const from = crams
    .filter((c) => c.finishedAt && !c.carriedTo)
    .sort((a, b) => (a.finishedAt! < b.finishedAt! ? 1 : -1))[0];
  const ids = from?.unused?.filter((id) => noteIds.has(id)) ?? [];
  return from && ids.length ? { from, noteIds: ids } : undefined;
}

/** The tags new notes get in the note editor: every running cram that adds new cards. */
export function runningCramTags(crams: Cram[], now: Date, dayStartsAtHour: number): string[] {
  return crams.filter((c) => c.addNew && isRunning(c, now, dayStartsAtHour)).map(cramTag);
}

/**
 * The most days a review of this note may be put off, from today: the days until the earliest
 * running cram it's in. Undefined when it's in none, or the day is today (a review answered on the
 * day itself is scheduled as usual: the cram has done its work by then).
 */
export function capDays(crams: Cram[], note: Note | undefined, now: Date, dayStartsAtHour: number): number | undefined {
  if (!note) return undefined;
  const days = crams
    .filter((c) => isRunning(c, now, dayStartsAtHour) && noteHasTag(note, cramTag(c)))
    .map((c) => daysUntil(c, now, dayStartsAtHour))
    .filter((d) => d >= 1);
  return days.length ? Math.min(...days) : undefined;
}

/**
 * Cards already scheduled after a running cram's day, with the days from today to put them at:
 * reviews only (a learning card is due within the day, a new one isn't scheduled) with a last
 * answer recorded, not suspended, not in an Anki filtered deck. Set with Anki's Set Due Date, which keeps the memory state.
 */
export function cardsToCap(crams: Cram[], notes: Iterable<Note>, cards: Iterable<Card>, now: Date, dayStartsAtHour: number): Map<number, Card[]> {
  const byNote = new Map<string, Note>();
  for (const n of notes) byNote.set(n.id, n);
  const out = new Map<number, Card[]>();
  for (const card of cards) {
    // A review with no last answer recorded would have its memory state made up by Set Due Date
    // (`setDueCard`), so it's left as it is.
    if (card.sched.state !== 2 || !card.sched.lastReview || card.suspended || card.retired || card.filteredDeck) continue;
    const days = capDays(crams, byNote.get(card.noteId), now, dayStartsAtHour);
    if (days === undefined) continue;
    const dueDay = studyDayStart(new Date(card.sched.due), dayStartsAtHour);
    const lastDay = studyDayStart(addCalendarDays(now, days), dayStartsAtHour);
    if (dueDay <= lastDay) continue;
    out.set(days, [...(out.get(days) ?? []), card]);
  }
  return out;
}

/** The Read & Listen language most of the words are in, or undefined when none is. */
export function cramLanguage(notes: Note[]): Language | undefined {
  const counts = new Map<Language, number>();
  for (const n of notes) {
    const l = readerLanguageOf(n);
    if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** A note's meaning as plain text: an Omnilanguage note's Meaning, else its second field. */
export function meaningOf(note: Note): string {
  const raw = isOmnilanguage(note) ? note.fields.Meaning : Object.values(note.fields)[1];
  return htmlToText(raw ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The words a Read & Listen text can practice: those in `language` already studied (a card that
 * isn't New), since the server counts only studied words as ones it may use (`architecture.md`,
 * Practice words after studying).
 */
export function textWords(notes: Note[], cards: Iterable<Card>, language: Language): string[] {
  const studied = new Set<string>();
  for (const c of cards) if (c.sched.state !== 0) studied.add(c.noteId);
  return [...new Set(notes.filter((n) => studied.has(n.id) && readerLanguageOf(n) === language).map(headword).filter(Boolean))];
}

/** The most words an audio lesson teaches (the server's `lesson.MAX_GIVEN`). */
export const LESSON_MAX_WORDS = 15;
/** The longest word or meaning it takes (the server's `lesson.MAX_CHARS`): a longer one is left out, not sent to be refused. */
export const LESSON_MAX_CHARS = 200;

/** What Listen's audio lesson teaches: each word in `language` with its meaning, at most `LESSON_MAX_WORDS`, leaving out any too long to send. */
export function lessonPhrases(notes: Note[], language: Language): { noteId: string; text: string; english: string }[] {
  return notes
    .filter((n) => readerLanguageOf(n) === language)
    .map((n) => ({ noteId: n.id, text: headword(n), english: meaningOf(n) }))
    .filter((p) => p.text && p.english && p.text.length <= LESSON_MAX_CHARS && p.english.length <= LESSON_MAX_CHARS)
    .slice(0, LESSON_MAX_WORDS);
}

/** Whether the lesson made for the cram has every word it would teach now, and no other. */
export function lessonIsCurrent(cram: Cram, noteIds: string[]): boolean {
  if (!cram.lesson) return false;
  const made = new Set(cram.lesson.noteIds);
  return made.size === noteIds.length && noteIds.every((id) => made.has(id));
}

/**
 * When a note was added, as a number to sort by (0 when it can't be told): an Anki note's id is its
 * creation time in milliseconds, and a note made in Franki carries it in base 36 before 4 random
 * characters (`frankiNoteId`).
 */
export function noteAddedAt(note: Pick<Note, 'id'>): number {
  if (/^\d+$/.test(note.id)) return Number(note.id);
  const franki = /^franki:([0-9a-z]+)[0-9a-z]{4}$/.exec(note.id);
  return franki ? parseInt(franki[1], 36) : 0;
}

/** Turns a saved row back into a cram, or undefined when it can't be read. */
export function parseCram(json: string): Cram | undefined {
  try {
    const c = JSON.parse(json) as Partial<Cram>;
    if (typeof c.id !== 'string' || typeof c.name !== 'string' || typeof c.date !== 'string' || typeof c.createdAt !== 'string') return undefined;
    return { ...c, addNew: c.addNew !== false, rounds: Array.isArray(c.rounds) ? c.rounds : [] } as Cram;
  } catch {
    return undefined;
  }
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The day as the screens say it: "Today", "Tomorrow", "Thursday" within the week, else "Nov 28". */
export function dayName(cram: Pick<Cram, 'date'>, now: Date, dayStartsAtHour: number): string {
  const days = daysUntil(cram, now, dayStartsAtHour);
  const d = cramDay(cram);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1 && days < 7) return WEEKDAYS[d.getDay()];
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "Thursday, Nov 20": the date in full, for the cram's page. */
export function fullDate(cram: Pick<Cram, 'date'>): string {
  const d = cramDay(cram);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "6:15 PM" */
function clock(d: Date): string {
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  return `${h}:${m < 10 ? '0' : ''}${m} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

export interface RoundStatus {
  /** A round can start now. */
  ready: boolean;
  /** One line: "Round 2 is ready.", "Next round at 6:15 PM.", "Next round tomorrow.", "No rounds left before Thursday." */
  text: string;
  /** "Start round 2" when ready. */
  action?: string;
}

/** What the cram's card and page say about rounds. */
export function roundStatus(cram: Cram, now: Date, dayStartsAtHour: number): RoundStatus {
  const n = cram.rounds.length + 1;
  const at = nextRoundAt(cram, now, dayStartsAtHour);
  const done = cram.rounds.length === 1 ? '1 round done.' : `${cram.rounds.length} rounds done.`;
  if (!at) return { ready: false, text: cram.rounds.length ? `${done} No rounds left.` : 'No rounds left.' };
  if (at <= now) return { ready: true, text: cram.rounds.length ? `${done} Round ${n} is ready.` : 'Round 1 is ready.', action: `Start round ${n}` };
  const sameDay = studyDayKey(at, dayStartsAtHour) === studyDayKey(now, dayStartsAtHour);
  const nextDay = studyDayKey(at, dayStartsAtHour) === studyDayKey(nextStudyDayStart(now, dayStartsAtHour), dayStartsAtHour);
  const when = sameDay ? `at ${clock(at)}` : nextDay ? 'tomorrow' : `on ${WEEKDAYS[studyDayStart(at, dayStartsAtHour).getDay()]}`;
  return { ready: false, text: `${done} Next round ${when}.` };
}
