import type { Language } from '../reader/api';
import { LANGUAGE_ORDER } from '../reader/languages';
import { DATE_MODES, type DateMode } from './dateQuiz';
import { MONEY_MAXES, type MoneyMax } from './money';
import { COUNT_MAXES, COUNT_MODES, type CountMax, type CountMode } from './counting';
import { ANSWER_MODES, type AnswerMode } from './listen';
import { NUMBER_KINDS, type NumberKind } from './number';
import { SCRIPT_MODES, type ScriptMode } from './script';
import { MINUTE_STEPS, type MinuteStep } from './time';

/**
 * What the Practice tools remember between launches: the language last practiced (shared by every
 * tool, since it's the language you're working on) and each tool's own choices. Pure, so it's
 * tested; storage.ts keeps them.
 */
export interface ToolPrefs {
  language?: Language;
  /** Telling the time: the step a random time's minutes come in, and whether it's said or heard. */
  minuteStep: MinuteStep;
  timeMode: AnswerMode;
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
  /** Reading the script: read a word aloud, or (Thai) name a syllable's tone. */
  scriptMode: ScriptMode;
}

export type MoneyMode = 'count' | 'price';

export const DEFAULT_TOOL_PREFS: ToolPrefs = { minuteStep: 5, timeMode: 'say', dateWeekday: true, dateYear: false, dateMode: 'say', moneyMode: 'count', moneyMax: 1000, moneyAnswer: 'say', numberKind: 'number', numberMode: 'say', countMode: 'say', countMax: 10, scriptMode: 'tone' };

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
    timeMode: ANSWER_MODES.find((m) => m === saved.timeMode) ?? DEFAULT_TOOL_PREFS.timeMode,
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
  };
}
