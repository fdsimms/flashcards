import type { Language } from '../reader/api';
import { LANGUAGE_ORDER } from '../reader/languages';
import { MONEY_MAXES, type MoneyMax } from './money';
import { MINUTE_STEPS, type MinuteStep } from './time';

/**
 * What the Practice tools remember between launches: the language last practiced (shared by every
 * tool, since it's the language you're working on) and each tool's own choices. Pure, so it's
 * tested; storage.ts keeps them.
 */
export interface ToolPrefs {
  language?: Language;
  /** Telling the time: the step a random time's minutes come in. */
  minuteStep: MinuteStep;
  /** Saying dates: whether the weekday and the year are said. */
  dateWeekday: boolean;
  dateYear: boolean;
  /** Counting money: notes and coins to count, or a price to read; and how big an amount gets. */
  moneyMode: MoneyMode;
  moneyMax: MoneyMax;
}

export type MoneyMode = 'count' | 'price';

export const DEFAULT_TOOL_PREFS: ToolPrefs = { minuteStep: 5, dateWeekday: true, dateYear: false, moneyMode: 'count', moneyMax: 1000 };

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
    dateWeekday: typeof saved.dateWeekday === 'boolean' ? saved.dateWeekday : DEFAULT_TOOL_PREFS.dateWeekday,
    dateYear: typeof saved.dateYear === 'boolean' ? saved.dateYear : DEFAULT_TOOL_PREFS.dateYear,
    moneyMode: saved.moneyMode === 'count' || saved.moneyMode === 'price' ? saved.moneyMode : DEFAULT_TOOL_PREFS.moneyMode,
    moneyMax: MONEY_MAXES.find((m) => m === saved.moneyMax) ?? DEFAULT_TOOL_PREFS.moneyMax,
  };
}
