import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, type AlertButton } from 'react-native';
import { fullSyncPrompt, reportText, syncErrorText, type FullSyncQuestion } from '../anki/sync/runSync';
import { syncNow } from '../anki/syncService';
import type { AnkiLink, SyncSettings } from '../db/ankiLink';
import type { Repo } from '../db/repo';

/**
 * Sync as the app runs it: one at a time, its settings and progress for the screens, and the
 * question asked when one collection has to replace the other. That question needs someone
 * looking at the screen, so a sync that runs as the app goes to the background cancels instead,
 * and the next one asks.
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
    if (q.downloadOk) buttons.push({ text: "Download the server's", style: q.unsent ? 'destructive' : 'default', onPress: () => resolve('download') });
    Alert.alert(title, message, buttons);
  });

  /** Syncs if sync is on and none is running. Returns what happened, as a line to show. */
  const sync = useCallback(async (): Promise<string | undefined> => {
    if (!repo || running.current) return undefined;
    if (!(await repo.syncSettings()).enabled) return undefined;
    running.current = true;
    setSyncing(true);
    try {
      return reportText(await syncNow(repo, choose));
    } catch (e) {
      return syncErrorText(e);
    } finally {
      running.current = false;
      setSyncing(false);
      await reload();
      onSynced();
    }
  }, [repo, reload, onSynced]);

  return { settings, syncing, sync, reload };
}
