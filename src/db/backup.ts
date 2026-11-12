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
export const RESTORED_TABLES = ['notes', 'cards', 'reviews', 'deck_params', 'note_types', 'deck_settings', 'form_practice', 'grammar_answers'] as const;

export interface TableRestore {
  table: string;
  /** Columns copied from the backup: the ones both sides have. Empty means the table is only cleared. */
  columns: string[];
}

export class NotABackupError extends Error {}

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
 * sheet opened; whether it was then saved anywhere, the app can't see.
 */
export function backupStatus(lastBackupAt: string | null, now: Date, hasCards: boolean): { text: string; overdue: boolean } | undefined {
  if (!hasCards) return undefined;
  if (!lastBackupAt) return { text: 'Not backed up yet', overdue: true };
  const days = Math.floor((now.getTime() - new Date(lastBackupAt).getTime()) / 86400000);
  const text = days <= 0 ? 'Backed up today' : days === 1 ? 'Last backed up yesterday' : `Last backed up ${days} days ago`;
  return { text, overdue: days >= BACKUP_REMINDER_DAYS };
}

/** What a picked SQLite file is, by its tables: a backup from this app (our core tables), or something else. */
export function sqliteFileKind(tables: string[]): 'backup' | 'other' {
  const has = new Set(tables);
  return REQUIRED.every((t) => has.has(t)) ? 'backup' : 'other';
}
