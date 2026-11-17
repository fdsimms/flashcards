import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createApi, readerAddress, type Api, type Settings as ReaderSettings } from '../reader/api';
import { clearPassphrase, loadPassphrase, loadPrefs, loadSettingsCopy, prefs, savePrefs, saveSettingsCopy } from '../reader/storage';
import { guardedFetch, useBackOnline } from './connection';

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
    // Behind the connection guard (src/core/connection.ts), checked against the server's own address.
    ? createApi(readerAddress(server), passphrase, guardedFetch(`${readerAddress(server)}/api/check`), () => {
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

  // The copy kept on the phone stands in until the server answers (offline, all day on the subway),
  // and the server is asked again when the connection comes back.
  const address = server ? readerAddress(server) : null;
  const [settings, setSettingsState] = useState<ReaderSettings | null>(null);
  const setSettings = useCallback((next: ReaderSettings) => {
    setSettingsState(next);
    if (address) saveSettingsCopy(address, next);
  }, [address]);
  const currentApi = useRef(api);
  currentApi.current = api;
  const fetchSettings = useCallback(() => {
    if (!api) return;
    api.settings().then((fetched) => {
      if (currentApi.current !== api) return; // Signed out, or another server, while it was on its way.
      // Unchanged settings keep their object, so nothing that depends on them runs again.
      setSettingsState((prev) => (prev && JSON.stringify(prev) === JSON.stringify(fetched) ? prev : fetched));
      if (address) saveSettingsCopy(address, fetched);
    }, () => undefined);
  }, [api, address]);
  useEffect(() => {
    setSettingsState(null);
    if (!api || !address) return undefined;
    let current = true;
    loadSettingsCopy(address).then((copy) => { if (current && copy) setSettingsState((prev) => prev ?? copy); });
    fetchSettings();
    return () => { current = false; };
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps
  useBackOnline(fetchSettings);

  return useMemo(() => ({
    api, server, notice, signedIn, signOut, settings, setSettings, dayStartsAtHour,
    shareCounts, setShareCounts,
  }), [api, server, notice, signedIn, signOut, settings, dayStartsAtHour, shareCounts, setShareCounts]);
}
