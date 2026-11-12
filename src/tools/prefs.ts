import type { Language } from '../reader/api';
import { LANGUAGE_ORDER } from '../reader/languages';
import { MINUTE_STEPS, type MinuteStep } from './time';

/**
 * What the Practice tools remember between launches: the language last practiced (shared by every
 * tool, since it's the language you're working on) and Telling the time's step for a random time.
 * Pure, so it's tested; storage.ts keeps them.
 */
export interface ToolPrefs {
  language?: Language;
  minuteStep: MinuteStep;
}

export const DEFAULT_TOOL_PREFS: ToolPrefs = { minuteStep: 5 };

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
  };
}
