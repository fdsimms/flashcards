import type { Language } from '../reader/api';
import { isOmnilanguage } from './cards';
import { addCalendarDays, dayKeyOf, nextStudyDayStart, studyDayKey, studyDayStart } from './day';
import { headword } from './forms';
import { htmlToText } from './html';
import { LANGUAGE_ORDER, flaggedName } from '../reader/languages';
import { isRegisterLevel, type RegisterLevel } from '../reader/registerLevel';
import { isReaderLanguage, readerLanguageOf } from './leechHint';
import { noteHasTag } from './priority';
import { isSkillNote } from './skillTag';
import type { Card, Note } from './types';

/**
 * A cram (Practice, Cram): the plan for a day coming up, a lesson with a tutor say, or a trip: the
 * words to know by then, the questions to ask the tutor, and what to talk about. The words are the
 * notes carrying the cram's tag (`cram::<id>`), so Anki and Claude see them too and can add to them.
 * Until the date:
 *
 * - **Practice**, a pass through the words not yet solid (`practiceProgress`), meaning asked and
 *   word answered, can be started any time, as often as wanted. It's practice, never a rating: a
 *   pass's Missed it and Got it are kept in the cram, on the phone, and nothing reaches FSRS
 *   (`cramRound.ts`, tests/core/cramRound.test.ts).
 * - **The review cap**: a card in a cram whose next review would land after the date is due on the
 *   date instead (`capDays`, passed to the scheduler's `review`, and `cardsToCap` for cards already
 *   scheduled past it). Only ever earlier, so FSRS still sees the real time between reviews.
 *
 * Afterwards, the words used on the day are checked off (At the lesson), and the ones not used are
 * offered to the next cram (`carryOver`). Pure, so it's tested; the phone keeps crams in SQLite
 * (`Repo.listCrams`) and `src/ui/useCrams.ts` reads them.
 */

export const CRAM_TAG_PREFIX = 'cram::';
const HOUR_MS = 3600000;

export interface CramRound {
  /** When the round ended, ISO. */
  finishedAt: string;
  /** Every note in the round, so a word added afterwards reads as not yet practiced. */
  noteIds: string[];
  /** The notes missed at least once in the round. */
  missed: string[];
}

/** A line in the cram's language with its English. */
export interface CramLine {
  text: string;
  english: string;
}

/**
 * A talking point (cramThemes.ts), kept to talk from at the lesson: its title, the questions the
 * learner asks the tutor, the questions the tutor is likely to ask with an answer ready, and a story
 * to tell. One kept before there were two kinds of questions has only `questions`.
 */
export interface CramTalk {
  title: string;
  /** Questions the learner asks the tutor. */
  questions: CramLine[];
  /** Questions the tutor is likely to ask, each with an answer the learner could give. */
  expects?: { question: CramLine; answer: CramLine }[];
  story?: CramLine;
  /** Words its lines used that the learner hadn't studied when it was written, with a meaning where the server kept one. */
  unknown?: { word: string; english: string }[];
  /** The questions of `questions` asked in the lesson (lesson mode), by their text. */
  asked?: string[];
}

/** A question to ask the tutor, typed on the cram's page and checked off in lesson mode once asked. */
export interface CramQuestion {
  id: string;
  text: string;
  asked?: boolean;
}

/**
 * A line in the cram's language with its English, kept on the cram alone: it is never a note, never
 * tagged and never scheduled, and a card is made from it only when the learner asks (cramPhrases.ts).
 * `reading` is the romanization where the language has one.
 */
export interface CramPhrase {
  text: string;
  english: string;
  reading?: string;
}

/** A card asked of Claude for the cram (Add, Make a card): the word in the language and its meaning. */
export interface CramRequest {
  text: string;
  english: string;
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
  /** The language picked for it. Unset, it is the one most of its words are in (`cramLanguage`). */
  language?: Language;
  /** The themes used for it (Talking points), in the order they were added. */
  themes?: CramTalk[];
  /** How casual or formal its talking points, lesson and rehearsals are written. Unset, it follows Settings (`registerLevel.ts`). */
  register?: RegisterLevel;
  /** The audio lesson made from the words (Read & Listen), the words it was made from, and the talking points' lines it teaches (`cramLessonPhrases`). */
  lesson?: { id: number; noteIds: string[]; lines?: string[] };
  /** What really happened, in the learner's words (Talking points): the stories and answers are written from it. */
  facts?: string;
  /** Questions about the language to bring to the tutor (how to say something, a grammar point), typed on the cram's page. */
  questions?: CramQuestion[];
  /** Phrases to practice for it (Phrases): typed in Add or suggested, heard in Listen, rehearsed, and tried in a round. */
  phrases?: CramPhrase[];
  /** The phrases checked off as used on the day, by `phraseKey`. */
  usedPhrases?: string[];
  /** Words and phrases typed in during the lesson (lesson mode), to make cards from afterwards. */
  captured?: string[];
  /** Cards asked of Claude for it, shown as being written until a note with the word is in the cram (`pendingRequests`). */
  requested?: CramRequest[];
  /** Started with "Not sure yet? Get ideas": its name is a stand-in until a theme names it (`withThemes`), and its talking points aren't angles on that name (`themeTopic`). */
  untitled?: boolean;
  /** The study day (`studyDayKey`) its Today card was dismissed on: the card stays away for that day only. */
  dismissedOn?: string;
}

/** The languages a cram can be set to, each with its flag, as the editor's Language list shows them. */
export const CRAM_LANGUAGE_CHOICES: { code: Language; label: string }[] = LANGUAGE_ORDER.map((code) => ({ code, label: flaggedName(code) }));

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
  if (!name.trim()) return 'Give the cram a name, e.g. "Thai lesson".';
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

/** Its Today card was dismissed during this study day. It comes back the next one. */
export const isDismissedToday = (cram: Pick<Cram, 'dismissedOn'>, now: Date, dayStartsAtHour: number) => cram.dismissedOn === studyDayKey(now, dayStartsAtHour);

/** Study days from today to the cram's day: 0 on the day itself. */
export function daysUntil(cram: Pick<Cram, 'date'>, now: Date, dayStartsAtHour: number): number {
  const from = studyDayStart(now, dayStartsAtHour);
  const to = cramDayStart(cram, dayStartsAtHour);
  // Whole days between two day starts, rounded so a DST change's 23 or 25 hours count as one.
  return Math.round((to.getTime() - from.getTime()) / (24 * HOUR_MS));
}

/** The notes in a cram: those carrying its tag. */
export const cramNotes = (cram: Pick<Cram, 'id'>, notes: Iterable<Note>): Note[] => [...notes].filter((n) => noteHasTag(n, cramTag(cram)));

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

/** The cram's language: the one picked for it, else the one most of its words are in. */
export const cramLanguageOf = (cram: Cram, notes: Iterable<Note>): Language | undefined => cram.language ?? cramLanguage(cramNotes(cram, notes));

/**
 * The tags a new note gets (the note editor, the note queue's Approve all): every running cram that
 * adds new cards and is in the note's language (`readerLanguageOf`), so a batch of Norwegian notes
 * never lands in a Thai cram. A note in no language Read & Listen knows joins only crams in none.
 */
export function runningCramTags(crams: Cram[], notes: Iterable<Note>, language: Language | undefined, now: Date, dayStartsAtHour: number): string[] {
  const all = [...notes];
  return crams.filter((c) => c.addNew && isRunning(c, now, dayStartsAtHour) && cramLanguageOf(c, all) === language).map(cramTag);
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

/**
 * The notes Add words offers for a cram: only those in the language its words are in, plus any
 * already in it (so a stray one can still be taken out). With no language picked and no words yet
 * there is nothing to go by, so every note is offered until the first is added. A skill card is
 * never offered: it practices a pattern, not a word, so a cram's meaning-to-word practice, its
 * texts and its lesson can't use it (Review hides Cram on one for the same reason).
 */
export function addableNotes(notes: Note[], inCram: Note[], picked?: Language): Note[] {
  const language = picked ?? cramLanguage(inCram);
  const have = new Set(inCram.map((n) => n.id));
  const words = notes.filter((n) => have.has(n.id) || !isSkillNote(n));
  if (!language) return words;
  return words.filter((n) => have.has(n.id) || readerLanguageOf(n) === language);
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

/** One note as an audio lesson takes it: its word and meaning, or undefined when it isn't in `language`, lacks either, or has one too long to send. */
export function lessonPhraseOf(note: Note, language: Language): { noteId: string; text: string; english: string } | undefined {
  if (readerLanguageOf(note) !== language) return undefined;
  const text = headword(note);
  const english = meaningOf(note);
  if (!text || !english || text.length > LESSON_MAX_CHARS || english.length > LESSON_MAX_CHARS) return undefined;
  return { noteId: note.id, text, english };
}

/** What Listen's audio lesson teaches: each word in `language` with its meaning, at most `LESSON_MAX_WORDS`, leaving out any too long to send. */
export function lessonPhrases(notes: Note[], language: Language): { noteId: string; text: string; english: string }[] {
  const phrases: { noteId: string; text: string; english: string }[] = [];
  for (const n of notes) {
    const phrase = lessonPhraseOf(n, language);
    if (phrase) phrases.push(phrase);
    if (phrases.length === LESSON_MAX_WORDS) break;
  }
  return phrases;
}

/** Whether the lesson made for the cram teaches every word and talking-point line it would teach now, and no other. */
export function lessonIsCurrent(cram: Cram, noteIds: string[], lines: string[] = []): boolean {
  if (!cram.lesson) return false;
  const made = new Set(cram.lesson.noteIds);
  const said = new Set(cram.lesson.lines ?? []);
  return made.size === noteIds.length && noteIds.every((id) => made.has(id)) && said.size === lines.length && lines.every((l) => said.has(l));
}

/**
 * The cram's words in the order its practice needs them: the ones missed in the last round, then the
 * others not solid yet (`practiceProgress`), then the solid ones, each group in the order given. An
 * audio lesson takes the first `LESSON_MAX_WORDS`, so a long cram's lesson teaches what's shakiest.
 */
export function practiceOrder(cram: Cram, notes: Note[]): Note[] {
  const missed = lastMissed(cram);
  const { solid } = practiceProgress(cram, notes.map((n) => n.id));
  const solidSet = new Set(solid);
  const rank = (n: Note) => (missed.has(n.id) ? 0 : solidSet.has(n.id) ? 2 : 1);
  return notes.map((n, i) => ({ n, i })).sort((a, b) => rank(a.n) - rank(b.n) || a.i - b.i).map(({ n }) => n);
}

/** How many of a lesson's phrases the talking points may take: the rest are the cram's words. */
export const LESSON_TALK_LINES = 5;

/**
 * The learner's own lines from the talking points that an audio lesson teaches, at most
 * `LESSON_TALK_LINES`: each talking point's first question to ask, then each one's first answer
 * ready, then the rest in that order, leaving out any too long to send and repeats.
 */
export function talkLessonLines(cram: Pick<Cram, 'themes'>): CramLine[] {
  const talks = cram.themes ?? [];
  const firsts = [...talks.map((t) => t.questions[0]), ...talks.map((t) => t.expects?.[0]?.answer)];
  const rest = talks.flatMap((t) => [...t.questions.slice(1), ...(t.expects ?? []).slice(1).map((e) => e.answer)]);
  const out: CramLine[] = [];
  for (const line of [...firsts, ...rest]) {
    if (!line?.text || !line.english || line.text.length > LESSON_MAX_CHARS || line.english.length > LESSON_MAX_CHARS) continue;
    if (out.some((l) => textKey(l.text) === textKey(line.text))) continue;
    out.push({ text: line.text, english: line.english });
    if (out.length === LESSON_TALK_LINES) break;
  }
  return out;
}

/** The cram's phrases as audio lesson lines, leaving out any too long to send, the first `LESSON_TALK_LINES`. */
export function phraseLessonLines(cram: Pick<Cram, 'phrases'>): CramLine[] {
  return (cram.phrases ?? [])
    .filter((p) => p.text && p.english && p.text.length <= LESSON_MAX_CHARS && p.english.length <= LESSON_MAX_CHARS)
    .slice(0, LESSON_TALK_LINES)
    .map((p) => ({ text: p.text, english: p.english }));
}

/** The phrases as labeled lines for a rehearsal's tutor to work in (`preparedLines`). */
export const phrasePreparedLines = (cram: Pick<Cram, 'phrases'>): string[] => (cram.phrases ?? []).map((p) => `Phrase to practice: ${p.text} (${p.english})`);

/**
 * What Listen's audio lesson teaches: the talking points' lines (`talkLessonLines`), the cram's phrases (`phraseLessonLines`), then the words
 * the cram's practice needs most (`practiceOrder`), at most `LESSON_MAX_WORDS` in all.
 */
export function cramLessonPhrases(cram: Cram, notes: Note[], language: Language): { phrases: CramLine[]; noteIds: string[]; lines: string[] } {
  const lines = [...talkLessonLines(cram), ...phraseLessonLines(cram)].filter((l, i, all) => all.findIndex((x) => textKey(x.text) === textKey(l.text)) === i);
  const words = lessonPhrases(practiceOrder(cram, notes), language).slice(0, LESSON_MAX_WORDS - lines.length);
  return {
    phrases: [...lines, ...words.map(({ text, english }) => ({ text, english }))],
    noteIds: words.map((w) => w.noteId),
    lines: lines.map((l) => l.text),
  };
}

/** What a lesson or a rehearsal is set in: the one talking point's title, else what the cram is for, else its first talking point's title, else its name. */
export function talkScene(cram: Pick<Cram, 'name' | 'untitled' | 'themes'>): string {
  const talks = cram.themes ?? [];
  if (talks.length === 1) return talks[0].title;
  return themeTopic(cram) || talks[0]?.title || cram.name;
}

/** What a talking point (or a theme on offer) holds, as its folded card says it: "2 to ask · 2 they may ask · your story". */
export function talkSummary(talk: { questions: unknown[]; expects?: unknown[] | null; story?: unknown }): string {
  const expects = talk.expects?.length ?? 0;
  return [`${talk.questions.length} to ask`, ...(expects ? [`${expects} they may ask`] : []), ...(talk.story ? ['your story'] : [])].join(' · ');
}

/** The talking points as labeled lines for a rehearsal's tutor to steer by (`rehearsalParams`'s `prepared`). */
export function preparedLines(cram: Pick<Cram, 'themes' | 'phrases'>): string[] {
  return [...(cram.themes ?? []).flatMap((t) => [
    `Topic: ${t.title}`,
    ...t.questions.map((q) => `You ask: ${q.text}`),
    ...(t.expects ?? []).map((e) => `They may ask you: ${e.question.text} (your answer: ${e.answer.text})`),
    ...(t.story ? [`Your story: ${t.story.text}`] : []),
  ]), ...phrasePreparedLines(cram)];
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
    const c = JSON.parse(json) as Partial<Cram> & { theme?: CramTalk };
    if (typeof c.id !== 'string' || typeof c.name !== 'string' || typeof c.date !== 'string' || typeof c.createdAt !== 'string') return undefined;
    // A cram saved before it could keep several themes has one `theme`.
    const { theme, ...rest } = c;
    const themes = Array.isArray(c.themes) ? c.themes : theme ? [theme] : undefined;
    return { ...rest, themes, language: isReaderLanguage(c.language) ? c.language : undefined, register: isRegisterLevel(c.register) ? c.register : undefined, addNew: c.addNew !== false, rounds: Array.isArray(c.rounds) ? c.rounds : [], phrases: Array.isArray(c.phrases) ? c.phrases : undefined, usedPhrases: Array.isArray(c.usedPhrases) ? c.usedPhrases : undefined } as Cram;
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

/** How many passes in a row a word has to be got the first time to count as solid: one lucky pass isn't enough. */
export const SOLID_PASSES = 2;

/** Whether the word was got the first time in each of the last `SOLID_PASSES` passes it was in. */
function isSolid(cram: Cram, noteId: string): boolean {
  const passes = cram.rounds.filter((r) => r.noteIds.includes(noteId)).slice(-SOLID_PASSES);
  return passes.length === SOLID_PASSES && passes.every((r) => !r.missed.includes(noteId));
}

/** Which words are solid (`isSolid`) and which are still to go, in the cram's order. */
export function practiceProgress(cram: Cram, noteIds: string[]): { solid: string[]; toGo: string[] } {
  const solid: string[] = [];
  const toGo: string[] = [];
  for (const id of noteIds) (isSolid(cram, id) ? solid : toGo).push(id);
  return { solid, toGo };
}

/** The words a practice pass goes through: those still to go, or every word once all are solid. */
export function practiceWords(cram: Cram, noteIds: string[]): string[] {
  const { toGo } = practiceProgress(cram, noteIds);
  return toGo.length ? toGo : noteIds;
}

const wordsText = (n: number) => (n === 1 ? '1 word' : `${n} words`);

const phrasesText = (n: number) => (n === 1 ? '1 phrase' : `${n} phrases`);

/**
 * What the Practice button says: "Practice 14 words", "Practice 5 words" (the ones not solid yet),
 * "Practice all 14 again". `phrases` is how many of the cram's phrases a round also goes through
 * (each time, since a phrase has no solid state): "Practice 14 words and 3 phrases".
 */
export function practiceLabel(cram: Cram, noteIds: string[], phrases = 0): string {
  const tail = phrases ? ` and ${phrasesText(phrases)}` : '';
  if (!noteIds.length) return `Practice ${phrasesText(phrases)}`;
  const { solid, toGo } = practiceProgress(cram, noteIds);
  if (!solid.length) return `Practice ${wordsText(noteIds.length)}${tail}`;
  if (toGo.length) return `Practice ${wordsText(toGo.length)}${tail}`;
  return noteIds.length === 1 ? `Practice it again${tail}` : `Practice all ${noteIds.length} again${tail}`;
}

/** One line on how practice is going: "9 of 14 words solid.", or "Not practiced yet." */
export function practiceSummary(cram: Cram, noteIds: string[]): string {
  if (!noteIds.length) return 'No words yet.';
  if (!cram.rounds.length) return 'Not practiced yet.';
  const { solid } = practiceProgress(cram, noteIds);
  return `${solid.length} of ${wordsText(noteIds.length)} solid.`;
}

/** The practice line of a cram that has phrases and no words: "3 phrases.". */
export const phrasesSummary = (n: number): string => `${phrasesText(n)}.`;

/** A word's text as compared: one form of Unicode, spaces collapsed, ignoring case. */
export const textKey = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/** The cards asked of Claude for the cram that aren't in it yet: no note of the cram has the word. */
export function pendingRequests(cram: Cram, inCram: Note[]): CramRequest[] {
  const have = new Set(inCram.map((n) => textKey(headword(n))));
  return (cram.requested ?? []).filter((r) => !have.has(textKey(r.text)));
}

/** What the cram's talking points are angles on: its name, or nothing for an untitled cram, whose stand-in name says nothing about the lesson. */
export const themeTopic = (cram: Pick<Cram, 'name' | 'untitled'>): string => (cram.untitled ? '' : cram.name);

/**
 * The cram with talking points kept after the ones it has (a theme with the same title replaces
 * its earlier copy), named after the first of them when it had only a stand-in name.
 */
export function withThemes(cram: Cram, talks: CramTalk[]): Cram {
  if (!talks.length) return cram;
  const titles = new Set(talks.map((t) => t.title));
  const themes = [...(cram.themes ?? []).filter((t) => !titles.has(t.title)), ...talks];
  if (!cram.untitled) return { ...cram, themes };
  const { untitled: _, ...rest } = cram;
  return { ...rest, name: talks[0].title, themes };
}

/** The name a cram started with "Not sure yet? Get ideas" has until a theme names it: "Thai lesson", or "Lesson" in no language. */
export const standInName = (languageName: string | undefined): string => (languageName ? `${languageName} lesson` : 'Lesson');

/** The cram without a talking point (by its title). */
export const withoutTalk = (cram: Cram, title: string): Cram => ({ ...cram, themes: (cram.themes ?? []).filter((t) => t.title !== title) });

/** The cram with a talking point's story replaced (an edit of the learner's own): the words it marked as unknown no longer apply. */
export function withTalkStory(cram: Cram, title: string, story: CramLine): Cram {
  return {
    ...cram,
    themes: (cram.themes ?? []).map((t) => {
      if (t.title !== title) return t;
      const { unknown: _, ...rest } = t;
      return { ...rest, story };
    }),
  };
}

/** The cram with one of a talking point's questions checked off as asked in the lesson, or back. */
export function withTalkAsked(cram: Cram, title: string, text: string, asked: boolean): Cram {
  return {
    ...cram,
    themes: (cram.themes ?? []).map((t) => {
      if (t.title !== title) return t;
      const rest = (t.asked ?? []).filter((x) => x !== text);
      return { ...t, asked: asked ? [...rest, text] : rest };
    }),
  };
}

/** The cram with a card asked for (a second ask for the same word is kept once). */
export function withRequest(cram: Cram, request: CramRequest): Cram {
  const rest = (cram.requested ?? []).filter((r) => textKey(r.text) !== textKey(request.text));
  return { ...cram, requested: [...rest, request] };
}

/** The cram without a card asked for (given up on, or deleted in the queue). */
export const withoutRequest = (cram: Cram, text: string): Cram => ({ ...cram, requested: (cram.requested ?? []).filter((r) => textKey(r.text) !== textKey(text)) });

/** The cram with a question for the tutor added at the end, or undefined when it's empty or already there. */
export function withQuestion(cram: Cram, text: string, id: string): Cram | undefined {
  const clean = text.replace(/\s+/g, ' ').trim();
  const have = cram.questions ?? [];
  if (!clean || have.some((q) => textKey(q.text) === textKey(clean))) return undefined;
  return { ...cram, questions: [...have, { id, text: clean }] };
}

/** The cram with a question checked off as asked, or back. */
export const withQuestionAsked = (cram: Cram, id: string, asked: boolean): Cram => ({
  ...cram,
  questions: (cram.questions ?? []).map((q) => (q.id === id ? { ...q, asked } : q)),
});

export const withoutQuestion = (cram: Cram, id: string): Cram => ({ ...cram, questions: (cram.questions ?? []).filter((q) => q.id !== id) });

/** The cram with something typed during the lesson kept (a repeat is kept once), or undefined when it's empty or already there. */
export function withCapture(cram: Cram, text: string): Cram | undefined {
  const clean = text.replace(/\s+/g, ' ').trim();
  const have = cram.captured ?? [];
  if (!clean || have.some((c) => textKey(c) === textKey(clean))) return undefined;
  return { ...cram, captured: [...have, clean] };
}

export const withoutCapture = (cram: Cram, text: string): Cram => ({ ...cram, captured: (cram.captured ?? []).filter((c) => textKey(c) !== textKey(text)) });

/**
 * The notes that match what's typed in Add, best first: the word itself, then a word starting with
 * it, then a meaning with it as a whole word ("again" finds "Could you say that again?"), then
 * either containing it. Ignores case; at most `limit`.
 */
export function searchNotes(notes: Note[], query: string, limit: number): Note[] {
  const q = textKey(query);
  if (!q) return [];
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wholeWord = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u');
  const scored: { note: Note; score: number; added: number }[] = [];
  for (const note of notes) {
    const word = textKey(headword(note));
    const meaning = textKey(meaningOf(note));
    const score = word === q ? 0 : word.startsWith(q) ? 1 : wholeWord.test(meaning) ? 2 : word.includes(q) || meaning.includes(q) ? 3 : -1;
    if (score >= 0) scored.push({ note, score, added: noteAddedAt(note) });
  }
  return scored.sort((a, b) => a.score - b.score || b.added - a.added).slice(0, limit).map((s) => s.note);
}

/** The days a new cram offers as chips: Today, Tomorrow, then the next three by weekday ("Mon"), as `YYYY-MM-DD` study days. */
export function dayChoices(now: Date, dayStartsAtHour: number): { label: string; date: string }[] {
  const today = studyDayStart(now, dayStartsAtHour);
  return [0, 1, 2, 3, 4].map((n) => {
    const day = addCalendarDays(today, n);
    return { label: n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : WEEKDAYS[day.getDay()].slice(0, 3), date: dayKeyOf(day) };
  });
}

/** The language a new cram starts in: the one picked for the cram made last, else the one most of its words are in. */
export function lastCramLanguage(crams: Cram[], notes: Iterable<Note>): Language | undefined {
  const all = [...notes];
  for (const c of [...crams].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const l = cramLanguageOf(c, all);
    if (l) return l;
  }
  return undefined;
}

/** The most words "missed lately" brings into a cram at once: the cram's sheet and its page both stop here. */
export const MISSED_MAX = 10;

/** The words missed lately (Trouble's "Missed lately", most missed first) in `language`, as note ids, leaving out `except`. */
export function missedLately(rows: { note: Note; misses: number }[], language: Language, except: Iterable<string> = []): string[] {
  const skip = new Set(except);
  const misses = new Map<string, number>();
  for (const { note, misses: n } of rows) {
    if (skip.has(note.id) || readerLanguageOf(note) !== language) continue;
    misses.set(note.id, (misses.get(note.id) ?? 0) + n);
  }
  return [...misses.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/**
 * The cram once cards were asked of Claude for words jotted down in the lesson (Make cards for all):
 * each word asked for is shown as being written (`withRequest`) and its jotting is taken off the
 * list. Given the cram as it is now, after the request came back, so a word jotted or a question
 * checked meanwhile is kept, and a jotting already taken off stays off.
 */
export function afterCardsAsked(cram: Cram, asked: { capture: string; word: CramRequest }[]): Cram {
  let next = cram;
  for (const { capture, word } of asked) next = withoutCapture(withRequest(next, word), capture);
  return next;
}
