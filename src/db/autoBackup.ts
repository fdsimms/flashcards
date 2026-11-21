import { studyDayKey } from '../core/day';
import { sizeText } from '../core/fontDownloads';
import { daysBetween } from '../core/vacation';

/**
 * Automatic backups: copies of the database kept in a folder on the phone, made while the app is
 * open, as Anki keeps its own (by default every 30 minutes, some per day, week and month). This
 * module is the pure half: the file names, when the next one is due, which to keep, and how the
 * Backup screen lists them. `src/ui/autoBackup.ts` writes and removes the files.
 *
 * An automatic backup is `backupTo` without the media table: a copy of the images and sounds each
 * time would multiply the space they take, and a restore of a backup with no media table leaves
 * the media folder as it is (`restoreFrom`). It doesn't count as "backed up" for the reminder or
 * the deck list, since a copy on the phone is lost with the phone.
 */

/** Minutes between automatic backups, as Anki's default. */
export const AUTO_BACKUP_MINUTES = 30;

/**
 * How many are kept: the latest few, then the newest of each study day, week and month, oldest
 * bucket last. Fewer than Anki's 12 / 10 / 9, because each one is a whole copy of the database and
 * the kept Anki collection, on a phone's storage.
 */
export const AUTO_BACKUP_KEEP = { latest: 2, daily: 7, weekly: 4, monthly: 3 } as const;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** `franki-auto-2026-11-21-143005.db`, from the local time it was made. The list reads the time back from the name. */
export function autoBackupFileName(at: Date): string {
  return `franki-auto-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}.db`;
}

const NAME = /^franki-auto-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/;

/** When an automatic backup was made, from its file name; null for any other file (a half-written one included). */
export function autoBackupTime(name: string): Date | null {
  const m = NAME.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const at = new Date(y, mo - 1, d, h, mi, s);
  // A name that doesn't round-trip (month 13) isn't one of ours.
  return autoBackupFileName(at) === name ? at : null;
}

/**
 * Whether another automatic backup is due: none yet, or the newest is `AUTO_BACKUP_MINUTES` old.
 * One dated in the future (the clock was set back) is treated as old, or none would be made until
 * the clock caught up with it.
 */
export function autoBackupDue(newest: Date | null, now: Date): boolean {
  if (!newest) return true;
  const age = now.getTime() - newest.getTime();
  return age < 0 || age >= AUTO_BACKUP_MINUTES * 60_000;
}

/** A Monday, to number weeks from: weeks run Monday to Sunday, by study day. */
const WEEK_ZERO = '2024-01-01';

/**
 * The automatic backups to remove, from every file name in the folder. Newest first: the latest
 * `AUTO_BACKUP_KEEP.latest` stay; then each one that is the newest of a study day not yet kept
 * stays while daily places are left, then likewise by week, then by month. Names that aren't
 * automatic backups are never returned.
 */
export function autoBackupsToRemove(names: string[], dayStartsAtHour: number): string[] {
  const dated = names.flatMap((name) => {
    const at = autoBackupTime(name);
    return at ? [{ name, at }] : [];
  }).sort((a, b) => b.at.getTime() - a.at.getTime());
  const left = { daily: AUTO_BACKUP_KEEP.daily, weekly: AUTO_BACKUP_KEEP.weekly, monthly: AUTO_BACKUP_KEEP.monthly };
  const seen = { daily: new Set<string>(), weekly: new Set<string>(), monthly: new Set<string>() };
  const remove: string[] = [];
  dated.forEach(({ name, at }, i) => {
    const day = studyDayKey(at, dayStartsAtHour);
    const keys = { daily: day, weekly: String(Math.floor(daysBetween(WEEK_ZERO, day) / 7)), monthly: day.slice(0, 7) };
    const mark = () => { for (const k of ['daily', 'weekly', 'monthly'] as const) seen[k].add(keys[k]); };
    if (i < AUTO_BACKUP_KEEP.latest) { mark(); return; }
    for (const k of ['daily', 'weekly', 'monthly'] as const) {
      if (left[k] > 0 && !seen[k].has(keys[k])) {
        left[k]--;
        mark();
        return;
      }
    }
    remove.push(name);
  });
  return remove;
}

const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** "Today, 2:12 PM", "Yesterday, 8:55 PM" or "Nov 18, 7:30 PM", by study day. */
export function autoBackupLabel(at: Date, now: Date, dayStartsAtHour: number): string {
  const days = daysBetween(studyDayKey(at, dayStartsAtHour), studyDayKey(now, dayStartsAtHour));
  const day = days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${day}, ${clock(at)}`;
}

export interface AutoBackupFile { name: string; bytes: number }

/** The Backup screen's list, newest first, and the line under it. Files that aren't automatic backups are left out. */
export function autoBackupList(files: AutoBackupFile[], now: Date, dayStartsAtHour: number): { rows: { name: string; label: string; size: string }[]; summary?: string } {
  const dated = files.flatMap((f) => {
    const at = autoBackupTime(f.name);
    return at ? [{ ...f, at }] : [];
  }).sort((a, b) => b.at.getTime() - a.at.getTime());
  if (!dated.length) return { rows: [] };
  const total = dated.reduce((sum, f) => sum + f.bytes, 0);
  return {
    rows: dated.map((f) => ({ name: f.name, label: autoBackupLabel(f.at, now, dayStartsAtHour), size: sizeText(f.bytes) })),
    summary: `${dated.length.toLocaleString()} ${dated.length === 1 ? 'backup' : 'backups'}, ${sizeText(total)}.`,
  };
}
