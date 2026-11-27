import type { Language } from '../reader/api';
import { LANGUAGE_ORDER } from '../reader/languages';
import { DATE_MODES, type DateMode } from './dateQuiz';
import { MONEY_MAXES, type MoneyMax } from './money';
import { COUNT_MAXES, COUNT_MODES, type CountMax, type CountMode } from './counting';
import { ANSWER_MODES, type AnswerMode } from './listen';
import { NUMBER_KINDS, type NumberKind } from './number';
import { MIXUP_MODES, type MixupMode } from './mixups';
import { SCRIPT_MODES, type ScriptMode } from './script';
import { MINUTE_STEPS, type MinuteStep } from './time';
import { WRITING_KINDS, WRITING_MODES, WRITING_STYLES, type WritingKind, type WritingMode, type WritingStyle } from './writing';

/** Telling the time's modes: Say it and Listen as the other tools, and Explore, setting the clock to any time to see how it's said (nothing marked). */
export const TIME_MODES = ['say', 'listen', 'explore'] as const;
export type TimeMode = (typeof TIME_MODES)[number];

/**
 * What the Practice tools remember between launches: the language last practiced (shared by every
 * tool, since it's the language you're working on) and each tool's own choices. Pure, so it's
 * tested; storage.ts keeps them.
 */
export interface ToolPrefs {
  language?: Language;
  /** Telling the time: the step a random time's minutes come in, and whether it's said or heard. */
  minuteStep: MinuteStep;
  timeMode: TimeMode;
  /** Saying dates: whether the weekday and the year are said. */
  dateWeekday: boolean;
  dateYear: boolean;
  /** Saying dates: how it's answered (said aloud, picked, typed, or the date tapped). */
  dateMode: DateMode;
  /** Counting money: notes and coins to count, or a price to read; and how big an amount gets. */
  moneyMode: MoneyMode;
  moneyMax: MoneyMax;
  /** Counting money: said (counted or read off a price) or heard and typed. */
  moneyAnswer: AnswerMode;
  /** Numbers: what kind of number is asked, and whether it's said aloud or heard and typed. */
  numberKind: NumberKind;
  numberMode: AnswerMode;
  /** Counting things: said aloud or picked, and how high the number goes. */
  countMode: CountMode;
  countMax: CountMax;
  /** Reading the script: read a word aloud, or (Thai) name a syllable's tone, a consonant's class or a vowel's length. */
  scriptMode: ScriptMode;
  /** Similar words: told apart by meaning or by ear. */
  mixupMode: MixupMode;
  /** Writing by hand: over the answer shown faintly or in an empty box, and letters, words or (Japanese) kanji. */
  writingMode: WritingMode;
  writingKind: WritingKind;
  /** Writing by hand: printed letters or joined handwriting, in a language that has both (Russian). */
  writingStyle: WritingStyle;
  /** Writing by hand: whether Japanese's kana and kanji show their stroke order, downloaded a character at a time (strokeOrder.ts). */
  writingStrokes: boolean;
  /** Hearing sounds: the group of sounds each language is practiced in (its Tones, its Vowel length); a language not listed practices all of them. */
  hearingGroups: Partial<Record<Language, string>>;
}

export type MoneyMode = 'count' | 'price';

export const DEFAULT_TOOL_PREFS: ToolPrefs = { minuteStep: 5, timeMode: 'say', dateWeekday: true, dateYear: false, dateMode: 'say', moneyMode: 'count', moneyMax: 1000, moneyAnswer: 'say', numberKind: 'number', numberMode: 'say', countMode: 'say', countMax: 10, scriptMode: 'tone', mixupMode: 'meaning', writingMode: 'trace', writingKind: 'letters', writingStyle: 'printed', writingStrokes: true, hearingGroups: {} };

/** Anything unreadable or out of range falls back to the default for that setting. */
export function parseToolPrefs(raw: string | null): ToolPrefs {
  let saved: Partial<Record<keyof ToolPrefs, unknown>> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') saved = parsed as typeof saved;
  } catch {
    // Not JSON: use the defaults.
  }
  const language = LANGUAGE_ORDER.find((l) => l === saved.language);
  return {
    ...(language ? { language } : {}),
    minuteStep: MINUTE_STEPS.find((s) => s === saved.minuteStep) ?? DEFAULT_TOOL_PREFS.minuteStep,
    timeMode: TIME_MODES.find((m) => m === saved.timeMode) ?? DEFAULT_TOOL_PREFS.timeMode,
    dateWeekday: typeof saved.dateWeekday === 'boolean' ? saved.dateWeekday : DEFAULT_TOOL_PREFS.dateWeekday,
    dateYear: typeof saved.dateYear === 'boolean' ? saved.dateYear : DEFAULT_TOOL_PREFS.dateYear,
    dateMode: DATE_MODES.find((m) => m === saved.dateMode) ?? DEFAULT_TOOL_PREFS.dateMode,
    moneyMode: saved.moneyMode === 'count' || saved.moneyMode === 'price' ? saved.moneyMode : DEFAULT_TOOL_PREFS.moneyMode,
    moneyMax: MONEY_MAXES.find((m) => m === saved.moneyMax) ?? DEFAULT_TOOL_PREFS.moneyMax,
    moneyAnswer: ANSWER_MODES.find((m) => m === saved.moneyAnswer) ?? DEFAULT_TOOL_PREFS.moneyAnswer,
    numberKind: NUMBER_KINDS.find((k) => k === saved.numberKind) ?? DEFAULT_TOOL_PREFS.numberKind,
    numberMode: ANSWER_MODES.find((m) => m === saved.numberMode) ?? DEFAULT_TOOL_PREFS.numberMode,
    countMode: COUNT_MODES.find((m) => m === saved.countMode) ?? DEFAULT_TOOL_PREFS.countMode,
    countMax: COUNT_MAXES.find((m) => m === saved.countMax) ?? DEFAULT_TOOL_PREFS.countMax,
    scriptMode: SCRIPT_MODES.find((m) => m === saved.scriptMode) ?? DEFAULT_TOOL_PREFS.scriptMode,
    mixupMode: MIXUP_MODES.find((m) => m === saved.mixupMode) ?? DEFAULT_TOOL_PREFS.mixupMode,
    writingMode: WRITING_MODES.find((m) => m === saved.writingMode) ?? DEFAULT_TOOL_PREFS.writingMode,
    writingKind: WRITING_KINDS.find((k) => k === saved.writingKind) ?? DEFAULT_TOOL_PREFS.writingKind,
    writingStyle: WRITING_STYLES.find((s) => s === saved.writingStyle) ?? DEFAULT_TOOL_PREFS.writingStyle,
    writingStrokes: typeof saved.writingStrokes === 'boolean' ? saved.writingStrokes : DEFAULT_TOOL_PREFS.writingStrokes,
    hearingGroups: parseHearingGroups(saved.hearingGroups),
  };
}

/** Each language's group id as saved; whether the language still has that group is the tool's to check (hearing.ts, `validFocus`). */
function parseHearingGroups(raw: unknown): Partial<Record<Language, string>> {
  if (!raw || typeof raw !== 'object') return {};
  const groups: Partial<Record<Language, string>> = {};
  for (const l of LANGUAGE_ORDER) {
    const g = (raw as Record<string, unknown>)[l];
    if (typeof g === 'string' && g) groups[l] = g;
  }
  return groups;
}
