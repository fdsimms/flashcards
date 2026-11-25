import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, type AlertButton } from 'react-native';
import { syncProgress } from '../anki/sync/progress';
import { fullSyncPrompt, reportText, syncErrorText, type FullSyncQuestion } from '../anki/sync/runSync';
import { syncNow } from '../anki/syncService';
import type { AnkiLink, SyncSettings } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { normalizeEndpoint } from '../anki/sync/client';
import { SyncError } from '../anki/sync/protocol';
import { originOf } from '../core/connection';
import { connection, probe, useBackOnline } from './connection';

/**
 * Sync as the app runs it: one at a time, its settings and progress for the screens, and the
 * question asked when one collection has to replace the other. That question needs someone
 * looking at the screen, so a sync that runs as the app goes to the background cancels instead,
 * and the next one asks.
 *
 * Offline it doesn't try: with no network at all, nothing; on a network that may lead nowhere, the
 * server is asked for anything first (a few seconds), so a sync never holds the collection (and
 * Review's answers behind it) waiting on a dead connection. It syncs again when the connection
 * comes back (src/ui/connection.ts).
 */
export function useSync(repo: (Repo & AnkiLink) | null, onSynced: () => void) {
  const [settings, setSettings] = useState<SyncSettings>();
  const [syncing, setSyncing] = useState(false);
  const running = useRef(false);

  const reload = useCallback(async () => {
    if (repo) setSettings(await repo.syncSettings());
  }, [repo]);
  useEffect(() => { reload(); }, [reload]);

  const choose = (q: FullSyncQuestion) => new Promise<'download' | 'upload' | null>((resolve) => {
    if (AppState.currentState !== 'active') { resolve(null); return; }
    const { title, message } = fullSyncPrompt(q);
    const buttons: AlertButton[] = [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(null) }];
    if (q.uploadOk) buttons.push({ text: "Upload Franki's", onPress: () => resolve('upload') });
    if (q.downloadOk) buttons.push({ text: "Download the server's", style: q.unsent || q.edits ? 'destructive' : 'default', onPress: () => resolve('download') });
    Alert.alert(title, message, buttons);
  });

  // Settled when the sync running now is over, for a caller that has to wait for it (`afterRunning`).
  const over = useRef<Promise<void>>(Promise.resolve());

  /**
   * Syncs if sync is on and none is running. Returns what happened, as a line to show. With
   * `afterRunning`, a sync already running is waited for and then another is run, since the
   * running one may have started before the answers this caller needs sent.
   */
  const sync = useCallback(async (opts?: { afterRunning?: boolean }): Promise<string | undefined> => {
    if (!repo) return undefined;
    if (opts?.afterRunning) while (running.current) await over.current;
    if (running.current) return undefined;
    // Claimed before the settings read, so a second call made during that await doesn't start a second sync.
    running.current = true;
    let release = () => {};
    over.current = new Promise<void>((resolve) => { release = resolve; });
    let enabled = false;
    try {
      enabled = (await repo.syncSettings()).enabled;
    } finally {
      if (!enabled) { running.current = false; release(); }
    }
    if (!enabled) return undefined;
    setSyncing(true);
    let origin: string | undefined;
    try {
      const address = normalizeEndpoint((await repo.syncSettings()).server);
      origin = originOf(address);
      if (connection.get().path === 'none') return "Offline. Franki will sync when you're back online.";
      if (!(await probe(address))) {
        connection.report(origin, false);
        return "Couldn't reach your server. Franki will sync once it answers.";
      }
      connection.report(origin, true);
      return reportText(await syncNow(repo, choose, syncProgress.set));
    } catch (e) {
      if (origin && e instanceof SyncError && e.kind === 'network') connection.report(origin, false);
      return syncErrorText(e);
    } finally {
      running.current = false;
      release();
      syncProgress.set(null);
      setSyncing(false);
      try {
        await reload();
      } finally {
        onSynced();
      }
    }
  }, [repo, reload, onSynced]);

  useBackOnline(() => { void sync(); });

  return { settings, syncing, sync, reload };
}
