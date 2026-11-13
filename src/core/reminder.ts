import { studyDayKey } from './day';
import { deckListTotals, type DeckRow } from './deckTree';

/**
 * The daily study reminder: a local notification at a time of day the user picks, off until
 * they turn it on (Settings, Study reminder). Nothing leaves the phone. Pure, so it's tested;
 * src/ui/studyReminder.ts keeps the setting in the Keychain and hands the plan to iOS.
 *
 * iOS shows a scheduled notification as it was written and gives the app no chance to count
 * again when it fires. So the plan is rewritten every time the deck list is recounted (after a
 * sync, a study session, opening the app), and only a reminder on the study day being counted
 * carries numbers: one on a later day can't know them, and says so plainly instead. A reminder
 * on today's study day with nothing left to study isn't sent.
 */

export type ReminderPrefs = { on: boolean; hour: number; minute: number };

export const DEFAULT_REMINDER: ReminderPrefs = { on: false, hour: 20, minute: 0 };

/**
 * How many days ahead reminders are written. Each recount rewrites them, so this only matters
 * when Franki isn't opened for a while; iOS keeps at most 64 pending per app.
 */
export const REMINDER_DAYS = 7;

/** The minutes the time wheel offers. */
export const REMINDER_MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] as const;

// Anything unreadable or out of range falls back to the default for that setting.
export function parseReminder(raw: string | null): ReminderPrefs {
  let saved: Partial<Record<keyof ReminderPrefs, unknown>> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') saved = parsed as typeof saved;
  } catch {
    // Not JSON: use the defaults.
  }
  const int = (v: unknown, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : undefined);
  return {
    on: typeof saved.on === 'boolean' ? saved.on : DEFAULT_REMINDER.on,
    hour: int(saved.hour, 23) ?? DEFAULT_REMINDER.hour,
    minute: int(saved.minute, 59) ?? DEFAULT_REMINDER.minute,
  };
}

export interface PlannedReminder {
  at: Date;
  title: string;
  body: string;
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** The reminder's words for the study day the deck list was counted on. */
export function reminderText(rows: DeckRow[]): { title: string; body: string } | null {
  const { due, fresh } = deckListTotals(rows);
  if (due + fresh === 0) return null;
  const title = [due ? count(due, 'review', 'reviews') : '', fresh ? count(fresh, 'new card', 'new cards') : ''].filter(Boolean).join(' and ');
  // The top-level decks with something waiting, busiest first.
  const body = rows
    .filter((r) => r.depth === 0 && r.due + r.fresh > 0)
    .sort((a, b) => b.due + b.fresh - (a.due + a.fresh))
    .map((r) => `${r.name} ${(r.due + r.fresh).toLocaleString()}`)
    .join(' · ');
  return { title, body };
}

/**
 * The reminders to schedule from `now`: the next `days` times the clock reads the chosen time.
 * `rows` are the deck list's, counted at `now`; their numbers go only on a reminder that falls
 * in the same study day (a 1 AM reminder still belongs to the day before, when the day starts at
 * 4 AM).
 */
export function reminderPlan(input: { prefs: ReminderPrefs; rows: DeckRow[]; now: Date; dayStartsAtHour: number; days?: number }): PlannedReminder[] {
  const { prefs, rows, now, dayStartsAtHour, days = REMINDER_DAYS } = input;
  if (!prefs.on) return [];
  const today = studyDayKey(now, dayStartsAtHour);
  const counted = reminderText(rows);
  const out: PlannedReminder[] = [];
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), prefs.hour, prefs.minute);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  for (let i = 0; i < days; i++) {
    const when = new Date(at.getFullYear(), at.getMonth(), at.getDate() + i, prefs.hour, prefs.minute);
    if (studyDayKey(when, dayStartsAtHour) === today) {
      if (counted) out.push({ at: when, ...counted });
    } else {
      out.push({ at: when, title: 'Time to study', body: 'Open Franki to see what\'s due today.' });
    }
  }
  return out;
}
