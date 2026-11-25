import { studyDayStart } from '../core/day';
import type { Language } from '../reader/api';
import { LANGUAGE_ORDER } from '../reader/languages';
import { liveMisses, markList, type Marks } from './marks';
import { TOOLS, type ToolId } from './tools';

/**
 * Daily extras: what Today suggests besides flashcards each study day, a short drill from
 * the Practice tab or a text to read, picked from what's been missed lately. A language set to
 * Always (a focus language) gets two a day; the others take turns, the one practiced longest ago
 * first. Pure, so it's tested; src/ui/useDailyExtras.ts reads the phone's side (extrasStorage.ts).
 *
 * Nothing here touches a card: an extra never grades, schedules or writes anything, and what's kept
 * (the answers given, the texts read) lives on this phone only.
 */

/**
 * The Practice tools an extra may suggest: the ones that record their answers (marks.ts), so an extra
 * can see it was done, and that no deck covers. Time, dates, money and numbers are skill cards
 * (skills.ts), which come up in their deck, so they aren't suggested here as well.
 */
export const EXTRA_TOOLS = ['counting', 'script', 'hearing'] as const satisfies readonly ToolId[];
export type ExtraTool = (typeof EXTRA_TOOLS)[number];
export type ExtraKind = ExtraTool | 'read';

/** How many answers a drill needs before its extra counts as done. */
export const EXTRA_ANSWERS = 5;

/** How many extras a language set to Always gets in a day; a language taking its turn gets one. */
export const FOCUS_EXTRAS = 2;

export type LanguageMode = 'always' | 'turns' | 'off';
export const LANGUAGE_MODES: LanguageMode[] = ['always', 'turns', 'off'];
export const TURNS_PER_DAY = [1, 2, 3] as const;
export type TurnsPerDay = (typeof TURNS_PER_DAY)[number];

export interface ExtraPrefs {
  on: boolean;
  /** How many languages take a turn each day, besides the focus ones. */
  turnsPerDay: TurnsPerDay;
  /** A language not listed takes turns. */
  modes: Partial<Record<Language, LanguageMode>>;
  /** Whether a drill from the Practice tab may be suggested, and whether a text to read may. */
  drills: boolean;
  read: boolean;
}

export const DEFAULT_EXTRA_PREFS: ExtraPrefs = { on: true, turnsPerDay: 1, modes: {}, drills: true, read: true };

export const modeOf = (prefs: ExtraPrefs, language: Language): LanguageMode => prefs.modes[language] ?? 'turns';

export interface Extra {
  language: Language;
  kind: ExtraKind;
  /** Why it's offered: the language is a focus one, or it's the language's turn. */
  why: 'focus' | 'turn';
}

/** A day's extras, fixed when the day's first plan is made so doing one doesn't change the rest. */
export interface ExtraPlan {
  /** The study day it's for (epoch ms of its start). */
  start: number;
  /** What it was made from, so changing a setting makes a new one. */
  sig: string;
  extras: Extra[];
}

/** What's been done: answers and texts, as times, so "today" is decided by the study day. */
export interface ExtraState {
  /** Each drill's latest answers, by `${tool}|${language}`, newest last. */
  answers: Record<string, number[]>;
  /** When a text in each language was last finished. */
  reads: Partial<Record<Language, number>>;
  plan?: ExtraPlan;
}

export const EMPTY_EXTRA_STATE: ExtraState = { answers: {}, reads: {} };

const KEPT_ANSWERS = 2 * EXTRA_ANSWERS;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Anything unreadable or out of range falls back to the default for that setting. */
export function parseExtraPrefs(raw: string | null): ExtraPrefs {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (isRecord(parsed)) saved = parsed;
  } catch {
    // Not JSON: use the defaults.
  }
  const modes: Partial<Record<Language, LanguageMode>> = {};
  if (isRecord(saved.modes)) {
    for (const l of LANGUAGE_ORDER) {
      const m = LANGUAGE_MODES.find((x) => x === (saved.modes as Record<string, unknown>)[l]);
      if (m) modes[l] = m;
    }
  }
  return {
    on: typeof saved.on === 'boolean' ? saved.on : DEFAULT_EXTRA_PREFS.on,
    turnsPerDay: TURNS_PER_DAY.find((n) => n === saved.turnsPerDay) ?? DEFAULT_EXTRA_PREFS.turnsPerDay,
    modes,
    drills: typeof saved.drills === 'boolean' ? saved.drills : DEFAULT_EXTRA_PREFS.drills,
    read: typeof saved.read === 'boolean' ? saved.read : DEFAULT_EXTRA_PREFS.read,
  };
}

const KINDS: string[] = [...EXTRA_TOOLS, 'read'];

function parseExtra(v: unknown): Extra | undefined {
  if (!isRecord(v)) return undefined;
  const language = LANGUAGE_ORDER.find((l) => l === v.language);
  const kind = KINDS.find((k) => k === v.kind) as ExtraKind | undefined;
  const why = v.why === 'focus' || v.why === 'turn' ? v.why : undefined;
  return language && kind && why ? { language, kind, why } : undefined;
}

export function parseExtraState(raw: string | null): ExtraState {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (isRecord(parsed)) saved = parsed;
  } catch {
    // Not JSON: nothing is done yet.
  }
  const answers: Record<string, number[]> = {};
  if (isRecord(saved.answers)) {
    for (const [key, times] of Object.entries(saved.answers)) {
      if (Array.isArray(times)) answers[key] = times.filter((t): t is number => typeof t === 'number').slice(-KEPT_ANSWERS);
    }
  }
  const reads: Partial<Record<Language, number>> = {};
  if (isRecord(saved.reads)) {
    for (const l of LANGUAGE_ORDER) {
      const t = (saved.reads as Record<string, unknown>)[l];
      if (typeof t === 'number') reads[l] = t;
    }
  }
  const p = saved.plan;
  const plan = isRecord(p) && typeof p.start === 'number' && typeof p.sig === 'string' && Array.isArray(p.extras)
    ? { start: p.start, sig: p.sig, extras: p.extras.map(parseExtra).filter((e): e is Extra => !!e) }
    : undefined;
  return { answers, reads, ...(plan ? { plan } : {}) };
}

/** `state` with one drill answer at `now`. */
export function recordAnswer(state: ExtraState, tool: ToolId, language: Language, now: number): ExtraState {
  const key = `${tool}|${language}`;
  return { ...state, answers: { ...state.answers, [key]: [...(state.answers[key] ?? []), now].slice(-KEPT_ANSWERS) } };
}

/** `state` with a text in `language` finished at `now`. */
export function recordRead(state: ExtraState, language: Language, now: number): ExtraState {
  return { ...state, reads: { ...state.reads, [language]: now } };
}

/** When `language` was last practiced, a drill or a text, or 0 if never: the longest ago takes the next turn. */
export function lastPracticed(state: ExtraState, language: Language): number {
  let last = state.reads[language] ?? 0;
  for (const [key, times] of Object.entries(state.answers)) {
    if (key.endsWith(`|${language}`) && times.length) last = Math.max(last, times[times.length - 1]);
  }
  return last;
}

/** Whether `extra` has been done in the study day starting at `start`. */
export function isDone(state: ExtraState, extra: Extra, start: number): boolean {
  if (extra.kind === 'read') return (state.reads[extra.language] ?? 0) >= start;
  return (state.answers[`${extra.kind}|${extra.language}`] ?? []).filter((t) => t >= start).length >= EXTRA_ANSWERS;
}

/** How many answers of an unfinished drill are in so far today, for "2 of 5". */
export function answersToday(state: ExtraState, extra: Extra, start: number): number {
  if (extra.kind === 'read') return isDone(state, extra, start) ? 1 : 0;
  return Math.min(EXTRA_ANSWERS, (state.answers[`${extra.kind}|${extra.language}`] ?? []).filter((t) => t >= start).length);
}

const toolLanguages = (tool: ExtraTool): Language[] => TOOLS.find((t) => t.id === tool)?.languages ?? [];

/** A small stable number from text, to break ties the same way all day without a random draw. */
function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

export interface PlanInput {
  prefs: ExtraPrefs;
  state: ExtraState;
  /** The languages with a deck to study (Read & Listen's decks that hold cards). */
  languages: Language[];
  /** Whether Read & Listen is signed in, so a text can be offered. */
  readerOn: boolean;
  marks: Marks;
  now: Date;
  dayStartsAtHour: number;
}

/** Whether a language has anything to offer: a drill in it (with drills on), or a text. */
function hasExtras(language: Language, prefs: ExtraPrefs, readerOn: boolean): boolean {
  return (prefs.drills && EXTRA_TOOLS.some((t) => toolLanguages(t).includes(language))) || (prefs.read && readerOn);
}

/**
 * The languages taking turns, the one practiced longest ago first (never first of all), ties in the
 * app's order. A language with nothing to offer (no drill in it and no text) is left out: its time
 * would never move on, so it would take every turn and the strip would stay empty.
 */
export function turnOrder({ prefs, state, languages, readerOn }: Pick<PlanInput, 'prefs' | 'state' | 'languages' | 'readerOn'>): Language[] {
  return LANGUAGE_ORDER
    .filter((l) => languages.includes(l) && modeOf(prefs, l) === 'turns' && hasExtras(l, prefs, readerOn))
    .sort((a, b) => lastPracticed(state, a) - lastPracticed(state, b) || LANGUAGE_ORDER.indexOf(a) - LANGUAGE_ORDER.indexOf(b));
}

/** `count` extras for one language: the drill missed most lately, then (with a second) a text, else the next drill. */
function extrasFor(language: Language, count: number, why: Extra['why'], input: PlanInput, start: number): Extra[] {
  const { prefs, marks, now, readerOn } = input;
  const drills = prefs.drills
    ? EXTRA_TOOLS.filter((t) => toolLanguages(t).includes(language))
      .map((tool) => ({ tool, misses: liveMisses(marks[markList(tool, language)], now.getTime()) }))
      .sort((a, b) => b.misses - a.misses || hash(`${start}|${language}|${a.tool}`) - hash(`${start}|${language}|${b.tool}`))
    : [];
  const canRead = prefs.read && readerOn;
  const out: ExtraKind[] = [];
  if (count === 1) {
    // A drill that's been missed first; with nothing missed, a text on every other day's draw.
    if (drills[0] && (drills[0].misses > 0 || !canRead || hash(`${start}|${language}`) % 2 === 0)) out.push(drills[0].tool);
    else if (canRead) out.push('read');
  } else {
    if (drills[0]) out.push(drills[0].tool);
    if (canRead) out.push('read');
    for (const d of drills.slice(1)) if (out.length < count) out.push(d.tool);
  }
  return out.slice(0, count).map((kind) => ({ language, kind, why }));
}

function signature({ prefs, languages, readerOn }: PlanInput): string {
  return JSON.stringify([EXTRA_TOOLS, prefs.on, prefs.turnsPerDay, prefs.drills, prefs.read, readerOn, LANGUAGE_ORDER.filter((l) => languages.includes(l)).map((l) => `${l}:${modeOf(prefs, l)}`)]);
}

/**
 * Today's extras. The plan kept in `state` stands for the whole study day, unless a setting it was
 * made from has changed; otherwise a new one is made, and the caller keeps it (`plan !== state.plan`).
 */
export function planExtras(input: PlanInput): ExtraPlan {
  const { prefs, state, languages, now, dayStartsAtHour } = input;
  const start = studyDayStart(now, dayStartsAtHour).getTime();
  const sig = signature(input);
  if (state.plan && state.plan.start === start && state.plan.sig === sig) return state.plan;
  if (!prefs.on) return { start, sig, extras: [] };
  const focus = LANGUAGE_ORDER.filter((l) => languages.includes(l) && modeOf(prefs, l) === 'always');
  const turns = turnOrder(input).slice(0, prefs.turnsPerDay);
  return {
    start,
    sig,
    extras: [
      ...focus.flatMap((l) => extrasFor(l, FOCUS_EXTRAS, 'focus', input, start)),
      ...turns.flatMap((l) => extrasFor(l, 1, 'turn', input, start)),
    ],
  };
}
