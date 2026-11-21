import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { DeckRow } from '../core/deckTree';
import { autoBackupDue, autoBackupFileName, autoBackupsToRemove, autoBackupTime, type AutoBackupFile } from '../db/autoBackup';
import { fileUriToPath } from '../db/backup';
import type { BackupStore } from '../db/sqliteRepo';
import type { AppRepo } from './AppContext';

/**
 * Automatic backups' phone side (src/db/autoBackup.ts has the rules): the on/off setting, kept in
 * the Keychain like the backup reminder's and on unless turned off, the folder they're kept in,
 * and the hook that makes one when the app opens or comes back and the newest is old enough.
 * Nothing leaves the phone.
 */

const KEY = 'autoBackup.on';

let current: boolean | undefined;
const listeners = new Set<(on: boolean) => void>();

async function load(): Promise<boolean> {
  current ??= (await SecureStore.getItemAsync(KEY).catch(() => null)) !== 'false';
  return current;
}

/** Saves the setting, throwing when the Keychain won't take it. */
export async function saveAutoBackup(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(KEY, String(on));
  current = on;
  for (const l of listeners) l(on);
}

/** Whether automatic backups are on, following every save; undefined until it's been read. */
export function useAutoBackupOn(): boolean | undefined {
  const [on, setOn] = useState<boolean | undefined>(current);
  useEffect(() => {
    let live = true;
    load().then((v) => { if (live) setOn(v); });
    listeners.add(setOn);
    return () => { live = false; listeners.delete(setOn); };
  }, []);
  return on;
}

function folder(): Directory {
  const dir = new Directory(Paths.document, 'backups');
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

/** Every file in the folder with its size; `autoBackupList` picks out the backups. */
export function autoBackupFiles(): AutoBackupFile[] {
  return folder().list().filter((e): e is File => e instanceof File).map((f) => ({ name: f.name, bytes: f.size ?? 0 }));
}

/** The plain path of one automatic backup, for `restoreFrom`. */
export function autoBackupPath(name: string): string {
  return fileUriToPath(new File(folder(), name).uri);
}

const changed = new Set<() => void>();
/** Calls `on` after each automatic backup is made or removed, so the Backup screen's list follows. */
export function onAutoBackupsChanged(on: () => void): () => void {
  changed.add(on);
  return () => { changed.delete(on); };
}

// One at a time: a launch and a return to the app close together mustn't both make one.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Makes an automatic backup: now, or with `ifDue` only when the newest is old enough (checked in
 * turn, so two asks close together make one). Written under a name the list doesn't read and
 * renamed when complete, so a backup cut off halfway is never offered. With `prune`, the ones
 * `autoBackupsToRemove` names are removed after; a restore leaves it out, so the backup being
 * restored can't be removed by the copy made before it.
 */
export function makeAutoBackup(repo: Pick<BackupStore, 'autoBackupTo'>, opts: { ifDue?: boolean; prune?: { dayStartsAtHour: number } }): Promise<void> {
  const run = queue.then(async () => {
    if (opts.ifDue && !autoBackupDue(newest(), new Date())) return;
    await write(repo);
    if (opts.prune) prune(opts.prune.dayStartsAtHour);
    for (const l of changed) l();
  });
  queue = run.catch(() => undefined);
  return run;
}

async function write(repo: Pick<BackupStore, 'autoBackupTo'>): Promise<void> {
  const name = autoBackupFileName(new Date());
  // A fresh File each time: one that has been moved points at where it went.
  const partial = () => new File(folder(), `${name}.partial`);
  if (partial().exists) partial().delete();
  try {
    await repo.autoBackupTo(fileUriToPath(partial().uri));
    const done = new File(folder(), name);
    if (done.exists) done.delete();
    await partial().move(done);
  } finally {
    if (partial().exists) partial().delete();
  }
}

function prune(dayStartsAtHour: number): void {
  const names = autoBackupFiles().map((f) => f.name);
  for (const name of autoBackupsToRemove(names, dayStartsAtHour)) new File(folder(), name).delete();
  // A half-written one left by a crash.
  for (const name of names) if (name.endsWith('.partial')) new File(folder(), name).delete();
}

function newest(): Date | null {
  let best: Date | null = null;
  for (const f of autoBackupFiles()) {
    const at = autoBackupTime(f.name);
    if (at && (!best || at > best)) best = at;
  }
  return best;
}

/**
 * Makes an automatic backup at launch and each time the app comes back, when they're on, there's
 * something to back up, and the newest is `AUTO_BACKUP_MINUTES` old. Not on leaving the app: iOS
 * gives a backgrounded app only a few seconds, and a copy cut off there would be thrown away.
 */
export function useAutoBackup(repo: AppRepo | undefined, decks: DeckRow[], dayStartsAtHour: number): void {
  const on = useAutoBackupOn();
  const hasCards = decks.length > 0;
  useEffect(() => {
    if (!repo || !on || !hasCards) return;
    // A backup that fails is tried again the next time the app comes back.
    const check = () => { makeAutoBackup(repo, { ifDue: true, prune: { dayStartsAtHour } }).catch(() => undefined); };
    check();
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') check(); });
    return () => sub.remove();
  }, [repo, on, hasCards, dayStartsAtHour]);
}
