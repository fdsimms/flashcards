import { useCallback, useEffect, useMemo, useState } from 'react';
import { createApi, readerAddress, type Api, type Settings as ReaderSettings } from '../reader/api';
import { clearPassphrase, loadPassphrase, loadPrefs, prefs, savePrefs } from '../reader/storage';

export interface ReaderState {
  /** Read & Listen's server, once its passphrase is saved; null while it's off. */
  api: Api | null;
  /** The sync server's address, which Read & Listen's server runs beside; undefined while sync is off. */
  server?: string;
  /**
   * Why Read & Listen needs its passphrase again (it was changed on the server); null otherwise.
   * The deck list keeps its Read & Listen row while this is set, and the settings screen shows it.
   */
  notice: string | null;
  signedIn: (passphrase: string) => void;
  signOut: () => void;
  /**
   * Read & Listen's settings as its server has them (which deck is each language's), for Review's
   * "Read a text with these words" and adding marked words to the deck; null until loaded.
   */
  settings: ReaderSettings | null;
  setSettings: (settings: ReaderSettings) => void;
  /** The hour the study day starts, for saying "today" or "2 days ago" (the Grammar screen). */
  dayStartsAtHour: number;
  /** Whether the deck list's counts are sent to the server for dundundun (useCountsReport). */
  shareCounts: boolean;
  setShareCounts: (on: boolean) => void;
}

/**
 * Read & Listen's side of the app-wide state: on once its passphrase is saved, at the address
 * beside the sync server (`server`, undefined while sync is off). Its own settings are read with
 * the passphrase, so it opens with them.
 *
 * A passphrase the server rejects is forgotten and `notice` says why, but nothing navigates: the
 * settings read at launch can be the first call to see it, and studying shouldn't be interrupted
 * by Read & Listen. Its screens send themselves to its settings once `api` is null.
 */
export function useReader(server: string | undefined, dayStartsAtHour: number): ReaderState {
  const [passphrase, setPassphrase] = useState<string | null>();
  const [notice, setNotice] = useState<string | null>(null);
  const [shareCounts, setShareCountsState] = useState(false);
  useEffect(() => {
    Promise.all([loadPassphrase(), loadPrefs()]).then(([saved]) => {
      setPassphrase(saved);
      setShareCountsState(prefs().shareCounts);
    }, () => setPassphrase(null));
  }, []);
  const setShareCounts = useCallback((on: boolean) => {
    savePrefs({ shareCounts: on });
    setShareCountsState(on);
  }, []);
  const api = useMemo(() => (server && passphrase
    ? createApi(readerAddress(server), passphrase, fetch, () => {
      // The passphrase was changed on the server: forget it and ask again, rather than fail every call.
      clearPassphrase().catch(() => undefined);
      setPassphrase(null);
      setNotice('The passphrase changed on the server. Enter the new one.');
    })
    : null), [server, passphrase]);
  const signedIn = useCallback((saved: string) => { setNotice(null); setPassphrase(saved); }, []);
  const signOut = useCallback(() => {
    clearPassphrase().catch(() => undefined);
    setNotice(null);
    setPassphrase(null);
  }, []);

  const [settings, setSettings] = useState<ReaderSettings | null>(null);
  useEffect(() => {
    setSettings(null);
    api?.settings().then(setSettings, () => undefined);
  }, [api]);

  return useMemo(() => ({
    api, server, notice, signedIn, signOut, settings, setSettings, dayStartsAtHour,
    shareCounts, setShareCounts,
  }), [api, server, notice, signedIn, signOut, settings, dayStartsAtHour, shareCounts, setShareCounts]);
}
