import { studyDayKey, studyDayStart } from '../core/day';
import { Refusal } from '../core/failure';
import { daysBetween } from '../core/vacation';

/**
 * Backup and restore. A backup is a copy of the whole SQLite database (`VACUUM INTO`), which the
 * share sheet saves to Files or iCloud Drive. A restore replaces every table's rows with the
 * backup's, table by table, rather than swapping the file under an open connection.
 *
 * This module is the pure half: which tables a restore replaces, and which columns it copies.
 * `sqliteRepo.ts` runs the SQL.
 */

/** Tables a backup must have to be one of ours. */
const REQUIRED = ['notes', 'cards', 'reviews'] as const;

/**
 * Tables a restore replaces, in order. A table the backup doesn't have (deck_params, in a backup
 * made before it existed) is emptied rather than kept: a restore puts back the backup's state,
 * not a mix of it and what was here.
 */
export const RESTORED_TABLES = ['notes', 'cards', 'reviews', 'deck_params', 'note_types', 'deck_settings', 'form_practice', 'grammar_answers', 'confused_pairs', 'crams', 'anki_owed'] as const;

export interface TableRestore {
  table: string;
  /** Columns copied from the backup: the ones both sides have. Empty means the table is only cleared. */
  columns: string[];
}

export class NotABackupError extends Refusal {}

/**
 * What a restore does, from the columns of each table here and in the backup. Copying only the
 * shared columns lets a backup made before a migration restore into today's schema: a column it
 * lacks takes its default, as `MIGRATIONS` requires every added column to have.
 *
 * Throws `NotABackupError` when the file is missing one of our core tables.
 */
export function restorePlan(current: Map<string, string[]>, backup: Map<string, string[]>): TableRestore[] {
  const missing = REQUIRED.filter((t) => !backup.has(t));
  if (missing.length) throw new NotABackupError(`It has no ${missing.join(', ')} table, so it isn't a backup from this app.`);
  return RESTORED_TABLES.filter((t) => current.has(t)).map((table) => {
    const have = new Set(backup.get(table) ?? []);
    return { table, columns: current.get(table)!.filter((c) => have.has(c)) };
  });
}

/** `franki-backup-2026-11-11.db`, from a day key. Restoring reads what's inside, never the name. */
export function backupFileName(dayKey: string): string {
  return `franki-backup-${dayKey}.db`;
}

/** A `file://` URI as the plain path SQLite needs (`VACUUM INTO`, `ATTACH`). */
export function fileUriToPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

/** Days after the last backup at which the deck list starts reminding. */
export const BACKUP_REMINDER_DAYS = 7;

/**
 * The deck list's backup line: when the last backup was made, and whether it's time for another.
 * Nothing while there's nothing to lose. "Backed up" means a backup file was made and the share
 * sheet opened; whether it was then saved anywhere, the app can't see. `firstAddedAt` is when the
 * oldest note was added (ms; 0 when that can't be told, null with no cards): never backed up, it's
 * time once that's `BACKUP_REMINDER_DAYS` back, so a first day's few words don't open with a warning.
 */
export function backupStatus(lastBackupAt: string | null, now: Date, firstAddedAt: number | null, dayStartsAtHour: number): { text: string; overdue: boolean } | undefined {
  if (firstAddedAt === null) return undefined;
  if (!lastBackupAt) {
    const age = firstAddedAt ? daysBetween(studyDayKey(new Date(firstAddedAt), dayStartsAtHour), studyDayKey(now, dayStartsAtHour)) : Infinity;
    return { text: 'Not backed up yet', overdue: age >= BACKUP_REMINDER_DAYS };
  }
  // By study day, not by 24 hours: one made at 11 PM was yesterday's by the next morning.
  const days = daysBetween(studyDayKey(new Date(lastBackupAt), dayStartsAtHour), studyDayKey(now, dayStartsAtHour));
  const text = days <= 0 ? 'Backed up today' : days === 1 ? 'Backed up yesterday' : `Backed up ${days} days ago`;
  return { text, overdue: days >= BACKUP_REMINDER_DAYS };
}

/** The oldest of the notes' added times (`noteAddedAt`) that are known, else 0 (can't be told). */
export function oldestAdded(times: number[]): number {
  return times.reduce((m, t) => (t > 0 && (m === 0 || t < m) ? t : m), 0);
}

/** What the last backup held, kept beside when it was made. Null counts: a backup made before they were kept. */
export interface BackupInfo { at: string; cards: number | null; media: number | null }

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * The Backup screen's "Last backup" card. "Made" because that's all the app can see: the file was
 * written and the share sheet opened, and whether it was then saved anywhere isn't reported back.
 */
export function backupCardText(info: BackupInfo | null, now: Date, dayStartsAtHour: number): { title: string; detail?: string; overdue: boolean } {
  if (!info) return { title: 'Not backed up yet', overdue: true };
  const at = new Date(info.at);
  const days = daysBetween(studyDayKey(at, dayStartsAtHour), studyDayKey(now, dayStartsAtHour));
  const title = days <= 0 ? `Backed up today, ${clock(at)}`
    : days === 1 ? `Backed up yesterday, ${clock(at)}`
    : `Backed up ${days} days ago`;
  const held = [info.cards === null ? '' : plural(info.cards, 'card', 'cards'), info.media ? plural(info.media, 'image or sound', 'images and sounds') : ''].filter(Boolean).join(', ');
  const detail = days >= 2 ? [at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), held].filter(Boolean).join(', ') : held;
  return { title, detail: detail || undefined, overdue: days >= BACKUP_REMINDER_DAYS };
}

export type BackupPhase = 'database' | 'media' | 'anki';
export interface BackupProgress { phase: BackupPhase; done: number; total: number }

/** Where each phase sits on the bar: the media is most of the time, so it gets most of the bar. */
const PHASE_SPAN: Record<BackupPhase, [number, number]> = { database: [0, 0.15], media: [0.15, 0.85], anki: [0.85, 1] };

/** How far along a backup is (0 to 1) and what to call the step. */
export function backupProgress(p: BackupProgress): { fraction: number; text: string } {
  const [from, to] = PHASE_SPAN[p.phase];
  const fraction = from + (to - from) * (p.total > 0 ? Math.min(1, p.done / p.total) : 1);
  const text = p.phase === 'database' ? 'Saving your decks'
    : p.phase === 'media' ? `Copying images and sounds (${p.done.toLocaleString()} of ${p.total.toLocaleString()})`
    : 'Adding your Anki collection';
  return { fraction, text };
}

/** The evening hour the backup reminder arrives, and how many are written ahead (a week apart). */
export const BACKUP_REMINDER_HOUR = 20;
export const BACKUP_REMINDER_COUNT = 4;

/**
 * The backup reminders to schedule from `now`: the first evening the last backup is
 * `BACKUP_REMINDER_DAYS` old (or tonight, or tomorrow evening, when it already is), then a week
 * apart. Nothing while there's nothing to lose. Every recount and every backup rewrites them, so
 * a backup made in between clears the ones that no longer apply.
 */
export function backupReminderPlan(input: { lastBackupAt: string | null; firstAddedAt: number | null; now: Date; dayStartsAtHour: number }): { at: Date; title: string; body: string }[] {
  const { lastBackupAt, firstAddedAt, now, dayStartsAtHour } = input;
  if (firstAddedAt === null) return [];
  const evening = (base: Date, plusDays: number) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + plusDays, BACKUP_REMINDER_HOUR, 0);
  // Never backed up: a week after the oldest note was added, as the deck list's line (`backupStatus`), not on day one.
  const since = lastBackupAt ? new Date(lastBackupAt) : firstAddedAt ? new Date(firstAddedAt) : undefined;
  let first = since ? evening(studyDayStart(since, dayStartsAtHour), BACKUP_REMINDER_DAYS) : evening(now, 0);
  if (first.getTime() <= now.getTime()) first = evening(now, evening(now, 0).getTime() > now.getTime() ? 0 : 1);
  const out: { at: Date; title: string; body: string }[] = [];
  for (let i = 0; i < BACKUP_REMINDER_COUNT; i++) {
    const at = evening(first, i * 7);
    const body = lastBackupAt
      ? `Your last backup was ${plural(daysBetween(studyDayKey(new Date(lastBackupAt), dayStartsAtHour), studyDayKey(at, dayStartsAtHour)), 'day', 'days')} ago. Open Backup to make a new one.`
      : "Your decks aren't backed up yet. Open Backup to make one.";
    out.push({ at, title: 'Time to back up Franki', body });
  }
  return out;
}

/** What a picked SQLite file is, by its tables: a backup from this app (our core tables), or something else. */
export function sqliteFileKind(tables: string[]): 'backup' | 'other' {
  const has = new Set(tables);
  return REQUIRED.every((t) => has.has(t)) ? 'backup' : 'other';
}
