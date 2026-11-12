import { useCallback, useEffect, useMemo, useState } from 'react';
import { studyDayKey } from '../core/day';
import { createApi, readerAddress, type Api, type Settings as ReaderSettings } from '../reader/api';
import { minedOne, miningLeft, type MiningCount } from '../reader/mining';
import { clearPassphrase, loadMined, loadPassphrase, loadPrefs, saveMined } from '../reader/storage';

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
  /** How many more marked words can be added to the deck today (src/reader/mining.ts). */
  miningLeft: number;
  /** Counts one more marked word added to the deck today. */
  recordMined: () => void;
  /** The hour the study day starts, for saying "today" or "2 days ago" (the Grammar screen). */
  dayStartsAtHour: number;
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
  useEffect(() => {
    Promise.all([loadPassphrase(), loadPrefs()]).then(([saved]) => setPassphrase(saved), () => setPassphrase(null));
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

  const [mined, setMined] = useState<MiningCount | null>(null);
  useEffect(() => { loadMined().then(setMined); }, []);
  const today = studyDayKey(new Date(), dayStartsAtHour);
  const recordMined = useCallback(() => {
    setMined((before) => {
      const next = minedOne(before, studyDayKey(new Date(), dayStartsAtHour));
      saveMined(next);
      return next;
    });
  }, [dayStartsAtHour]);

  return useMemo(() => ({
    api, server, notice, signedIn, signOut, settings, setSettings, miningLeft: miningLeft(mined, today), recordMined, dayStartsAtHour,
  }), [api, server, notice, signedIn, signOut, settings, mined, today, recordMined, dayStartsAtHour]);
}
