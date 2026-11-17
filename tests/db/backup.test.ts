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
