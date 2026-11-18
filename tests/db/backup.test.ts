import { describe, expect, it } from 'vitest';
import { backupFileName, NotABackupError, restorePlan } from '../../src/db/backup';

const current = new Map([
  ['notes', ['id', 'deck', 'model', 'fields', 'tags']],
  ['cards', ['id', 'note_id', 'kind', 'suspended', 'sched', 'state', 'due', 'retired']],
  ['reviews', ['id', 'card_id', 'rating']],
  ['deck_params', ['deck', 'params']],
]);

describe('restorePlan', () => {
  it('copies the columns both sides have, so an older backup restores into a newer schema', () => {
    const old = new Map(current);
    old.set('cards', ['id', 'note_id', 'kind', 'suspended', 'sched', 'state', 'due']); // before `retired`
    old.delete('deck_params');
    const plan = restorePlan(current, old);
    expect(plan.find((p) => p.table === 'cards')!.columns).not.toContain('retired');
    // A table the backup lacks is emptied, not kept: the restore is the backup's state.
    expect(plan.find((p) => p.table === 'deck_params')).toEqual({ table: 'deck_params', columns: [] });
  });
  it('restores tables in a fixed order and nothing else', () => {
    const withExtra = new Map([...current, ['sqlite_sequence', ['name', 'seq']]]);
    expect(restorePlan(withExtra, withExtra).map((p) => p.table)).toEqual(['notes', 'cards', 'reviews', 'deck_params']);
  });
  it('restores forms practice, which is the user\'s own data', async () => {
    const { RESTORED_TABLES } = await import('../../src/db/backup');
    expect(RESTORED_TABLES).toContain('form_practice');
    expect(RESTORED_TABLES).toContain('grammar_answers');
    expect(RESTORED_TABLES).toContain('confused_pairs');
    expect(RESTORED_TABLES).toContain('crams');
  });
  it('refuses a file that is not one of our backups', () => {
    expect(() => restorePlan(current, new Map([['notes', ['id']]]))).toThrow(NotABackupError);
    expect(() => restorePlan(current, new Map())).toThrow(/isn't a backup from this app/);
  });
});

describe('backupFileName', () => {
  it('names the file after the day', () => {
    expect(backupFileName('2026-11-11')).toBe('franki-backup-2026-11-11.db');
  });
});

describe('fileUriToPath', () => {
  it('drops the scheme and decodes escapes', async () => {
    const { fileUriToPath } = await import('../../src/db/backup');
    expect(fileUriToPath('file:///var/mobile/Caches/My%20Backup.db')).toBe('/var/mobile/Caches/My Backup.db');
  });
});

describe('backupStatus', () => {
  it('stays quiet with nothing to lose, and reminds after a week', async () => {
    const { backupStatus } = await import('../../src/db/backup');
    const now = new Date(2026, 10, 11, 12);
    expect(backupStatus(null, now, false, 4)).toBeUndefined();
    expect(backupStatus(null, now, true, 4)).toEqual({ text: 'Not backed up yet', overdue: true });
    expect(backupStatus(new Date(2026, 10, 11, 8).toISOString(), now, true, 4)).toEqual({ text: 'Backed up today', overdue: false });
    expect(backupStatus(new Date(2026, 10, 10, 8).toISOString(), now, true, 4)).toEqual({ text: 'Last backed up yesterday', overdue: false });
    expect(backupStatus(new Date(2026, 10, 4, 12).toISOString(), now, true, 4)).toEqual({ text: 'Last backed up 7 days ago', overdue: true });
  });

  it('counts study days, not 24 hours', async () => {
    const { backupStatus } = await import('../../src/db/backup');
    // 11 PM, then 9 AM the next morning: yesterday, though under 24 hours ago.
    expect(backupStatus(new Date(2026, 10, 10, 23).toISOString(), new Date(2026, 10, 11, 9), true, 4)?.text).toBe('Last backed up yesterday');
    // 11 PM Monday, then 10 PM Wednesday: two days, though under 48 hours ago.
    expect(backupStatus(new Date(2026, 10, 9, 23).toISOString(), new Date(2026, 10, 11, 22), true, 4)?.text).toBe('Last backed up 2 days ago');
    // 2 AM still belongs to the day before.
    expect(backupStatus(new Date(2026, 10, 10, 22).toISOString(), new Date(2026, 10, 11, 2), true, 4)?.text).toBe('Backed up today');
  });
});

describe('sqliteFileKind', () => {
  it('tells a backup from anything else', async () => {
    const { sqliteFileKind } = await import('../../src/db/backup');
    expect(sqliteFileKind(['export', 'media'])).toBe('other');
    expect(sqliteFileKind(['notes', 'cards', 'reviews', 'deck_params', 'media'])).toBe('backup');
    expect(sqliteFileKind(['col', 'notes', 'cards', 'revlog'])).toBe('other'); // an Anki collection
  });
});

describe('backupCardText', () => {
  it('says when it was made and what it held, and warns from a week', async () => {
    const { backupCardText } = await import('../../src/db/backup');
    const now = new Date(2026, 10, 17, 12);
    const today = backupCardText({ at: new Date(2026, 10, 17, 9, 14).toISOString(), cards: 3482, media: 1240 }, now, 4);
    expect(today.title).toMatch(/^Last backup made today, 9:14/);
    expect(today.detail).toBe('3,482 cards, 1,240 images and sounds');
    expect(today.overdue).toBe(false);
    const old = backupCardText({ at: new Date(2026, 10, 5, 9).toISOString(), cards: 1, media: 0 }, now, 4);
    expect(old).toEqual({ title: 'Last backup made 12 days ago', detail: expect.stringContaining('1 card'), overdue: true });
    // A backup made before counts were kept shows the time alone.
    expect(backupCardText({ at: new Date(2026, 10, 17, 9).toISOString(), cards: null, media: null }, now, 4).detail).toBeUndefined();
    expect(backupCardText(null, now, 4)).toEqual({ title: 'Not backed up yet', overdue: true });
  });
});

describe('backupProgress', () => {
  it('moves forward through the phases and never past the end', async () => {
    const { backupProgress } = await import('../../src/db/backup');
    const f = (phase: 'database' | 'media' | 'anki', done: number, total: number) => backupProgress({ phase, done, total }).fraction;
    expect(f('database', 0, 1)).toBe(0);
    expect(f('media', 0, 100)).toBeGreaterThanOrEqual(f('database', 1, 1));
    expect(f('media', 50, 100)).toBeGreaterThan(f('media', 0, 100));
    expect(f('media', 100, 100)).toBeLessThanOrEqual(f('anki', 0, 1));
    expect(f('media', 500, 100)).toBe(f('media', 100, 100));
    expect(backupProgress({ phase: 'media', done: 1240, total: 1240 }).text).toBe('Copying images and sounds (1,240 of 1,240)');
  });
});

describe('backupReminderPlan', () => {
  it('first reminds on the evening the backup is a week old, then weekly', async () => {
    const { backupReminderPlan } = await import('../../src/db/backup');
    const plan = backupReminderPlan({ lastBackupAt: new Date(2026, 10, 11, 9).toISOString(), hasCards: true, now: new Date(2026, 10, 12, 12), dayStartsAtHour: 4 });
    expect(plan.map((p) => p.at)).toEqual([new Date(2026, 10, 18, 20), new Date(2026, 10, 25, 20), new Date(2026, 11, 2, 20), new Date(2026, 11, 9, 20)]);
    expect(plan[0].body).toBe('Your last backup was 7 days ago. Open Backup to make a new one.');
    expect(plan[1].body).toContain('14 days');
  });
  it('is tonight or tomorrow evening once already overdue, and counts study days', async () => {
    const { backupReminderPlan } = await import('../../src/db/backup');
    const last = new Date(2026, 10, 1, 9).toISOString();
    expect(backupReminderPlan({ lastBackupAt: last, hasCards: true, now: new Date(2026, 10, 17, 12), dayStartsAtHour: 4 })[0].at).toEqual(new Date(2026, 10, 17, 20));
    expect(backupReminderPlan({ lastBackupAt: last, hasCards: true, now: new Date(2026, 10, 17, 21), dayStartsAtHour: 4 })[0].at).toEqual(new Date(2026, 10, 18, 20));
    // Made at 2 AM on the 11th: still the 10th's study day, so a week is the 17th.
    expect(backupReminderPlan({ lastBackupAt: new Date(2026, 10, 11, 2).toISOString(), hasCards: true, now: new Date(2026, 10, 12, 12), dayStartsAtHour: 4 })[0].at).toEqual(new Date(2026, 10, 17, 20));
  });
  it('never backed up asks tonight, and nothing is sent with nothing to lose', async () => {
    const { backupReminderPlan } = await import('../../src/db/backup');
    const plan = backupReminderPlan({ lastBackupAt: null, hasCards: true, now: new Date(2026, 10, 17, 12), dayStartsAtHour: 4 });
    expect(plan[0]).toMatchObject({ at: new Date(2026, 10, 17, 20), body: "Your decks aren't backed up yet. Open Backup to make one." });
    expect(backupReminderPlan({ lastBackupAt: null, hasCards: false, now: new Date(2026, 10, 17, 12), dayStartsAtHour: 4 })).toEqual([]);
  });
});
