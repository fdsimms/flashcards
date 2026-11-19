// The daily reading tasks: which languages another app (dundundun) adds a Read & Listen task for
// each day. The server chooses (server/reader read_plan.py, docs/read-and-listen/architecture.md,
// Status); this is what the settings screen says about the choice.
import type { DailyTaskMode, Language, Settings } from './api';
import { LANGUAGE_ORDER, LANGUAGES } from './languages';

export const DAILY_MODES: { value: DailyTaskMode; label: string }[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'rotate', label: 'Rotate' },
  { value: 'off', label: 'Off' },
];

export const ROTATE_COUNT_RANGE = { min: 1, max: 10 };

/** A language's mode: the one chosen, else Rotate, as the server reads a language nobody chose. */
export function dailyModeOf(settings: Pick<Settings, 'daily_tasks'>, language: Language): DailyTaskMode {
  return settings.daily_tasks?.[language] ?? 'rotate';
}

export function dailyModeLabel(mode: DailyTaskMode): string {
  return DAILY_MODES.find((m) => m.value === mode)?.label ?? mode;
}

/** `count` kept within what the stepper offers. */
export function clampRotateCount(count: number): number {
  return Math.min(ROTATE_COUNT_RANGE.max, Math.max(ROTATE_COUNT_RANGE.min, Math.round(count)));
}

/**
 * The line under the settings row: the Every day languages by name, then how many rotating
 * languages get a task a day. Null from a server older than the setting, so the row says nothing
 * it doesn't know.
 */
export function dailyTasksSummary(settings: Pick<Settings, 'daily_tasks' | 'daily_rotate_count'> | null | undefined): string | null {
  if (!settings?.daily_tasks) return null;
  const daily = LANGUAGE_ORDER.filter((l) => dailyModeOf(settings, l) === 'daily').map((l) => LANGUAGES[l].name);
  const rotating = LANGUAGE_ORDER.filter((l) => dailyModeOf(settings, l) === 'rotate').length;
  const parts: string[] = [];
  if (daily.length) parts.push(`${daily.join(', ')} every day`);
  if (rotating) {
    const turns = Math.min(settings.daily_rotate_count ?? 1, rotating);
    parts.push(`${turns} rotating a day`);
  }
  return parts.length ? parts.join(', ') : 'No daily tasks';
}
