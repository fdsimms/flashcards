import { describe, expect, it } from 'vitest';
import { AUTO_BACKUP_KEEP, autoBackupDue, autoBackupFileName, autoBackupLabel, autoBackupList, autoBackupsToRemove, autoBackupTime } from '../../src/db/autoBackup';

const H = 4;

describe('autoBackupFileName and autoBackupTime', () => {
  it('round-trips the local time to the second', () => {
    const at = new Date(2026, 10, 21, 14, 30, 5);
    expect(autoBackupFileName(at)).toBe('franki-auto-2026-11-21-143005.db');
    expect(autoBackupTime(autoBackupFileName(at))).toEqual(at);
  });
  it('reads nothing from other files, a half-written one or an impossible date', () => {
    expect(autoBackupTime('franki-backup-2026-11-21.db')).toBeNull();
    expect(autoBackupTime('franki-auto-2026-11-21-143005.db.partial')).toBeNull();
    expect(autoBackupTime('franki-auto-2026-13-21-143005.db')).toBeNull();
  });
});

describe('autoBackupDue', () => {
  const now = new Date(2026, 10, 21, 14, 0);
  it('is due with none yet, and once the newest is 30 minutes old', () => {
    expect(autoBackupDue(null, now)).toBe(true);
    expect(autoBackupDue(new Date(2026, 10, 21, 13, 31), now)).toBe(false);
    expect(autoBackupDue(new Date(2026, 10, 21, 13, 30), now)).toBe(true);
  });
  it('is due when the newest is dated ahead of the clock', () => {
    expect(autoBackupDue(new Date(2026, 10, 22, 9, 0), now)).toBe(true);
  });
});

describe('autoBackupsToRemove', () => {
  const name = (y: number, m: number, d: number, h = 12, mi = 0) => autoBackupFileName(new Date(y, m - 1, d, h, mi));

  it('keeps the latest two even on the same day, and the newest of each earlier day', () => {
    const names = [name(2026, 11, 21, 14), name(2026, 11, 21, 13), name(2026, 11, 21, 12), name(2026, 11, 20, 9), name(2026, 11, 20, 20)];
    expect(autoBackupsToRemove(names, H)).toEqual([name(2026, 11, 21, 12), name(2026, 11, 20, 9)]);
  });

  it('counts days by study day: 2 AM belongs to the day before', () => {
    const names = [name(2026, 11, 21, 14), name(2026, 11, 21, 13), name(2026, 11, 21, 2), name(2026, 11, 20, 22)];
    // 2 AM on the 21st is the 20th's study day, and newer than 10 PM, so it's the 20th's daily.
    expect(autoBackupsToRemove(names, H)).toEqual([name(2026, 11, 20, 22)]);
  });

  it('after the daily places, keeps one a week, then one a month, and removes the rest', () => {
    // One backup a day for 120 days, ending on Saturday 21 November 2026.
    const names = Array.from({ length: 120 }, (_, i) => autoBackupFileName(new Date(2026, 10, 21 - i, 12)));
    const kept = names.filter((n) => !autoBackupsToRemove(names, H).includes(n));
    expect(kept.length).toBe(AUTO_BACKUP_KEEP.latest + AUTO_BACKUP_KEEP.daily + AUTO_BACKUP_KEEP.weekly + AUTO_BACKUP_KEEP.monthly);
    // The latest two (the 21st and 20th), then 7 daily: the 19th back to the 13th.
    expect(kept.slice(0, 9)).toEqual(names.slice(0, 9));
    // Then the newest of each Monday-to-Sunday week not yet kept (the 13th's week, 9 to 15, already is), and the
    // newest of each month not yet kept: October's first is the 31st, whose week the 1st already holds.
    expect(kept.slice(9)).toEqual([
      name(2026, 11, 8), name(2026, 11, 1), name(2026, 10, 31), name(2026, 10, 25), name(2026, 10, 18), name(2026, 9, 30), name(2026, 8, 31),
    ]);
  });

  it('never removes a file that is not an automatic backup', () => {
    expect(autoBackupsToRemove(['notes.txt', 'franki-backup-2026-11-01.db'], H)).toEqual([]);
  });
});

describe('autoBackupLabel and autoBackupList', () => {
  const now = new Date(2026, 10, 21, 15, 0);
  it('says Today and Yesterday by study day', () => {
    expect(autoBackupLabel(new Date(2026, 10, 21, 9, 40), now, H)).toMatch(/^Today, /);
    expect(autoBackupLabel(new Date(2026, 10, 21, 2, 0), now, H)).toMatch(/^Yesterday, /);
    expect(autoBackupLabel(new Date(2026, 10, 18, 19, 30), now, H)).not.toMatch(/^(Today|Yesterday)/);
  });
  it('lists newest first with sizes and a total, leaving other files out', () => {
    const list = autoBackupList([
      { name: autoBackupFileName(new Date(2026, 10, 20, 20, 55)), bytes: 4_000_000 },
      { name: autoBackupFileName(new Date(2026, 10, 21, 14, 12)), bytes: 4_100_000 },
      { name: 'stray.db', bytes: 9_000_000 },
    ], now, H);
    expect(list.rows.map((r) => r.size)).toEqual(['4.1 MB', '4.0 MB']);
    expect(list.summary).toBe('2 backups, 8.1 MB.');
    expect(autoBackupList([], now, H)).toEqual({ rows: [] });
  });
});
