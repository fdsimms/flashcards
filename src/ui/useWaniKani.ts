import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { studyDayStart } from '../core/day';
import { hasMedia, readMedia, writeMedia } from '../media/mediaFiles';
import { createWaniKaniApi, WaniKaniError, type WaniKaniApi, type WaniKaniProblem, type WaniKaniUser } from '../wanikani/api';
import { logOutcomes, type LogEntry } from '../wanikani/log';
import { offlineData, wantedAudio, type OfflineData, type Snapshot } from '../wanikani/offline';
import { makeSnapshot } from '../wanikani/offlineService';
import { DEFAULT_PREFS, flushOutbox, lessonsToday, type WaniKaniPrefs } from '../wanikani/prefs';
import { audioFileName, audioFor, suggestedDeck } from '../wanikani/production';
import { makeProductionNotes } from '../wanikani/productionService';
import type { Outcome } from '../wanikani/session';
import type { Subject } from '../wanikani/subjects';
import { DEFAULT_SRS, type SrsSystem } from '../wanikani/srs';
import { clearOffline, clearToken, keepAudio, loadPrefs, loadSnapshot, loadState, loadToken, savePrefs, saveSnapshot, saveState, saveToken } from '../wanikani/storage';
import type { AppRepo } from './AppContext';

/** The deck list asks again at most this often; opening WaniKani or pulling to sync asks right away. */
const COUNTS_EVERY_MS = 60_000;
/** The offline copy is made again at most this often, unless a session just closed or the app just opened. */
const COPY_EVERY_MS = 10 * 60_000;
/** Production notes are looked for at most this often. */
const PRODUCTION_EVERY_MS = 10 * 60_000;

export interface WaniKaniState {
  /** Null until the Keychain has been read; false while there's no token. */
  on: boolean | null;
  api: WaniKaniApi | null;
  user: WaniKaniUser | null;
  /** Reviews up now, and lessons left to offer today (none while the Apprentice limit holds them back); null until read. */
  counts: { reviews: number; lessons: number } | null;
  /** Items at Apprentice as last read; null until read. */
  apprentice: number | null;
  /** Why the last read or send failed; null when it worked. */
  problem: WaniKaniProblem | null;
  prefs: WaniKaniPrefs;
  setPrefs: (change: Partial<WaniKaniPrefs>) => void;
  /** Checks the token with WaniKani and saves it. Throws a WaniKaniError when it doesn't work. */
  signIn: (token: string) => Promise<void>;
  signOut: () => void;
  /** Reads the counts again (at most once a minute unless `force`), sends any waiting answers, and makes production notes. */
  refresh: (force?: boolean) => Promise<void>;
  /** WaniKani's SRS systems by id, for the intervals over the answer buttons. */
  srs: Map<number, SrsSystem>;
  /** Hands answers to WaniKani, keeping them to try again if it can't be reached. */
  send: (outcomes: Outcome[]) => void;
  /** Answers given here that haven't reached WaniKani yet. */
  unsent: number;
  /** Answers given here over the last year, for Stats (log.ts). */
  log: LogEntry[];
  /** The deck production cards go in: the one chosen, or the Japanese deck. */
  productionDeck?: string;
  /** Production notes: how many words still wait for one, and why none could be made. */
  production: { waiting: number; refused?: string };
  /** WaniKani couldn't be reached and the offline copy is standing in for it. */
  offline: boolean;
  /** The offline copy as it stands now (answers since removed), or null when none has been made. */
  offlineData: () => OfflineData | null;
  /** Lessons done since the study day began, here or on WaniKani. */
  startedToday: number;
  dayStartsAtHour: number;
}

/**
 * WaniKani's side of the app-wide state, called in one line by AppContext: the token and options,
 * the deck list's counts, answers waiting to be sent, and production notes. Off, and silent on
 * the network, until a token is entered in WaniKani's settings.
 */
export function useWaniKani(repo: AppRepo | null, dayStartsAtHour: number): WaniKaniState {
  const [token, setToken] = useState<string | null>();
  const [prefs, setPrefsState] = useState<WaniKaniPrefs>(DEFAULT_PREFS);
  const [user, setUser] = useState<WaniKaniUser | null>(null);
  const [counts, setCounts] = useState<{ available: number; reviews: number; apprentice: number } | null>(null);
  const [startedToday, setStartedToday] = useState(0);
  const [problem, setProblem] = useState<WaniKaniProblem | null>(null);
  const [srs, setSrs] = useState<Map<number, SrsSystem>>(DEFAULT_SRS);
  const [unsent, setUnsent] = useState(0);
  const [production, setProduction] = useState<{ waiting: number; refused?: string }>({ waiting: 0 });
  const [decks, setDecks] = useState<string[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [offline, setOffline] = useState(false);
  // What's kept in the state file, read once; written back on every change.
  const stored = useRef<{ outbox: Outcome[]; sent: Outcome[]; made: Set<number>; log: LogEntry[] } | null>(null);
  // The offline copy: read at launch, replaced each time WaniKani is reached.
  const snapshot = useRef<Snapshot | null>(null);
  const lastCopy = useRef(0);
  const copying = useRef(false);
  const lastCounts = useRef(0);
  const lastProduction = useRef(0);
  const flushing = useRef<Promise<void> | null>(null);
  const producing = useRef(false);

  useEffect(() => {
    Promise.all([loadToken(), loadPrefs(), loadState(), loadSnapshot()]).then(([t, p, s, copy]) => {
      stored.current = { outbox: s.outbox, sent: s.sent, made: new Set(s.made), log: s.log };
      snapshot.current = copy;
      setUnsent(s.outbox.length);
      setLog(s.log);
      setPrefsState(p);
      setToken(t ?? null);
    }, () => setToken(null));
  }, []);

  const api = useMemo(() => (token ? createWaniKaniApi(token) : null), [token]);
  const persist = () => {
    const s = stored.current;
    if (s) saveState({ outbox: s.outbox, sent: s.sent, made: [...s.made], log: s.log });
  };

  const setPrefs = useCallback((change: Partial<WaniKaniPrefs>) => {
    setPrefsState((before) => {
      const next = { ...before, ...change };
      savePrefs(next);
      return next;
    });
  }, []);

  /** Sends whatever is waiting, one run at a time. */
  const flush = useCallback(async () => {
    if (!api || !stored.current) return;
    if (flushing.current) return flushing.current;
    flushing.current = (async () => {
      const s = stored.current!;
      while (s.outbox.length) {
        const batch = [...s.outbox];
        const result = await flushOutbox(batch, (o) => api.send(o));
        // Anything added while this ran stays, after what's left of the batch.
        s.outbox = [...result.left, ...s.outbox.slice(batch.length)];
        // The offline copy still lists these items; they're left out of it (offline.ts).
        s.sent = [...s.sent, ...result.sent, ...result.dropped];
        persist();
        setUnsent(s.outbox.length);
        if (result.problem) {
          setProblem(result.problem);
          break;
        }
      }
    })().finally(() => { flushing.current = null; });
    return flushing.current;
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback((outcomes: Outcome[]) => {
    if (!outcomes.length || !stored.current) return;
    stored.current.outbox.push(...outcomes);
    // Logged once final (handed over to send), so an answer taken back with Undo never counts.
    stored.current.log = logOutcomes(stored.current.log, outcomes, new Date());
    setLog(stored.current.log);
    persist();
    setUnsent(stored.current.outbox.length);
    flush();
  }, [flush]); // eslint-disable-line react-hooks/exhaustive-deps

  const productionDeck = prefs.productionDeck ?? suggestedDeck(decks);

  const produce = useCallback(async (maxLevel: number, deckNames: string[]) => {
    const deck = prefs.productionDeck ?? suggestedDeck(deckNames);
    if (!api || !repo || !stored.current || producing.current || !prefs.production || !deck) return;
    if (Date.now() - lastProduction.current < PRODUCTION_EVERY_MS) return;
    producing.current = true;
    lastProduction.current = Date.now();
    try {
      const media = repo.mediaSyncState();
      const result = await makeProductionNotes({
        store: repo, api,
        media: { exists: hasMedia, read: readMedia, write: writeMedia, recorded: (n) => media.recorded(n), setPending: (n, s) => media.setPending(n, s) },
      }, { deck, maxLevel, made: stored.current.made });
      for (const id of result.made) stored.current.made.add(id);
      if (result.made.length) persist();
      setProduction({ waiting: result.waiting, refused: result.refused });
      // More words than one batch: the next refresh makes the next lot.
      if (result.waiting && !result.refused) lastProduction.current = 0;
    } catch {
      // WaniKani or the collection couldn't be reached: tried again at the next refresh.
    } finally {
      producing.current = false;
    }
  }, [api, repo, prefs.production, prefs.productionDeck]); // eslint-disable-line react-hooks/exhaustive-deps

  // Read through refs, so `refresh` keeps its identity when the options or SRS systems change
  // (the deck list runs it from a focus effect that depends on it).
  const produceRef = useRef(produce);
  produceRef.current = produce;
  const srsRead = useRef(false);

  /** The offline copy as it stands: answers given or sent since it was made are left out. */
  const copyData = useCallback((): OfflineData | null => {
    const copy = snapshot.current;
    const s = stored.current;
    return copy && s ? offlineData(copy, [...s.sent, ...s.outbox], new Date(), dayStartsAtHour) : null;
  }, [dayStartsAtHour]);

  /** Reads what a session needs and keeps it, so one can be studied with no connection. Recordings follow, in the background. */
  const makeCopy = useCallback(async (u: WaniKaniUser, apprentice: number, started: number, force: boolean) => {
    if (!api || !stored.current || copying.current) return;
    if (!force && snapshot.current && Date.now() - lastCopy.current < COPY_EVERY_MS) return;
    copying.current = true;
    lastCopy.current = Date.now();
    // Answers sent before this read began are already out of what it reads; later ones stay listed.
    const cut = stored.current.sent.length;
    try {
      const next = await makeSnapshot({ api }, { user: u, apprentice, started, previous: snapshot.current, now: new Date() });
      await saveSnapshot(next);
      snapshot.current = next;
      if (stored.current) {
        stored.current.sent = stored.current.sent.slice(cut);
        persist();
      }
      const audioOf = (subject: Subject) => {
        const a = audioFor(subject);
        return a ? { name: audioFileName(subject.id, a), url: a.url } : undefined;
      };
      keepAudio(wantedAudio(next, audioOf), api.download).catch(() => undefined);
    } catch {
      // Not reached, or the file couldn't be written: the last copy stays, and the next refresh tries again.
      lastCopy.current = 0;
    } finally {
      copying.current = false;
    }
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps
  const makeCopyRef = useRef(makeCopy);
  makeCopyRef.current = makeCopy;

  const refresh = useCallback(async (force = false) => {
    if (!api) return;
    if (!force && Date.now() - lastCounts.current < COUNTS_EVERY_MS) return;
    lastCounts.current = Date.now();
    try {
      await flush();
      const u = await api.user();
      const [c, started] = await Promise.all([
        api.counts(u.maxLevel),
        api.lessonsStartedSince(studyDayStart(new Date(), dayStartsAtHour)),
      ]);
      setUser(u);
      setCounts({ available: c.lessons, reviews: c.reviews, apprentice: c.apprentice });
      setStartedToday(started);
      setProblem(null);
      setOffline(false);
      makeCopyRef.current(u, c.apprentice, started, force);
      if (!srsRead.current) {
        srsRead.current = true;
        api.srsSystems().then((list) => { if (list.length) setSrs(new Map(list.map((s) => [s.id, s]))); }, () => { srsRead.current = false; });
      }
      const names = repo ? (await repo.ankiDecks()).map((d) => d.name) : [];
      setDecks(names);
      produceRef.current(u.maxLevel, names);
    } catch (e) {
      const why = e instanceof WaniKaniError ? e.problem : 'unavailable';
      setProblem(why);
      // Out of reach: the offline copy gives the counts, less what was answered since it was made.
      const copy = why === 'unavailable' ? copyData() : null;
      setOffline(!!copy);
      if (copy) {
        setUser((before) => before ?? copy.user);
        setCounts({ available: copy.lessons.length, reviews: copy.reviews.length, apprentice: copy.apprentice });
        setStartedToday(copy.started);
      }
    }
  }, [api, flush, repo, dayStartsAtHour, copyData]);

  // At launch, and whenever the token changes.
  useEffect(() => { if (api) refresh(true); }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  const signIn = useCallback(async (value: string) => {
    const t = value.trim();
    const u = await createWaniKaniApi(t).user();
    await saveToken(t);
    setUser(u);
    setProblem(null);
    setToken(t);
  }, []);

  const signOut = useCallback(() => {
    clearToken().catch(() => undefined);
    setToken(null);
    setUser(null);
    setCounts(null);
    setProblem(null);
    setOffline(false);
    snapshot.current = null;
    clearOffline();
  }, []);

  return useMemo(() => ({
    on: token === undefined ? null : !!token,
    api, user,
    counts: counts ? { reviews: counts.reviews, lessons: lessonsToday(counts.available, prefs.newPerDay, startedToday, counts.apprentice, prefs.maxApprentice) } : null,
    apprentice: counts ? counts.apprentice : null,
    problem, prefs, setPrefs, signIn, signOut, refresh, srs, send, unsent, log, productionDeck, production, startedToday, dayStartsAtHour,
    offline, offlineData: copyData,
  }), [token, api, user, counts, problem, prefs, setPrefs, signIn, signOut, refresh, srs, send, unsent, log, productionDeck, production, startedToday, dayStartsAtHour, offline, copyData]);
}
