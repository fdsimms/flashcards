import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { studyDayStart } from '../core/day';
import { hasMedia, readMedia, writeMedia } from '../media/mediaFiles';
import { createWaniKaniApi, WaniKaniError, type WaniKaniApi, type WaniKaniProblem, type WaniKaniUser } from '../wanikani/api';
import { logOutcomes, type LogEntry } from '../wanikani/log';
import { DEFAULT_PREFS, flushOutbox, lessonsToday, type WaniKaniPrefs } from '../wanikani/prefs';
import { suggestedDeck } from '../wanikani/production';
import { makeProductionNotes } from '../wanikani/productionService';
import type { Outcome } from '../wanikani/session';
import { DEFAULT_SRS, type SrsSystem } from '../wanikani/srs';
import { clearToken, loadPrefs, loadState, loadToken, savePrefs, saveState, saveToken } from '../wanikani/storage';
import type { AppRepo } from './AppContext';

/** The deck list asks again at most this often; opening WaniKani or pulling to sync asks right away. */
const COUNTS_EVERY_MS = 60_000;
/** Production notes are looked for at most this often. */
const PRODUCTION_EVERY_MS = 10 * 60_000;

export interface WaniKaniState {
  /** Null until the Keychain has been read; false while there's no token. */
  on: boolean | null;
  api: WaniKaniApi | null;
  user: WaniKaniUser | null;
  /** Reviews up now, and lessons left to offer today; null until read. */
  counts: { reviews: number; lessons: number } | null;
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
  const [counts, setCounts] = useState<{ available: number; reviews: number } | null>(null);
  const [startedToday, setStartedToday] = useState(0);
  const [problem, setProblem] = useState<WaniKaniProblem | null>(null);
  const [srs, setSrs] = useState<Map<number, SrsSystem>>(DEFAULT_SRS);
  const [unsent, setUnsent] = useState(0);
  const [production, setProduction] = useState<{ waiting: number; refused?: string }>({ waiting: 0 });
  const [decks, setDecks] = useState<string[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  // What's kept in the state file, read once; written back on every change.
  const stored = useRef<{ outbox: Outcome[]; made: Set<number>; log: LogEntry[] } | null>(null);
  const lastCounts = useRef(0);
  const lastProduction = useRef(0);
  const flushing = useRef<Promise<void> | null>(null);
  const producing = useRef(false);

  useEffect(() => {
    Promise.all([loadToken(), loadPrefs(), loadState()]).then(([t, p, s]) => {
      stored.current = { outbox: s.outbox, made: new Set(s.made), log: s.log };
      setUnsent(s.outbox.length);
      setLog(s.log);
      setPrefsState(p);
      setToken(t ?? null);
    }, () => setToken(null));
  }, []);

  const api = useMemo(() => (token ? createWaniKaniApi(token) : null), [token]);
  const persist = () => {
    const s = stored.current;
    if (s) saveState({ outbox: s.outbox, made: [...s.made], log: s.log });
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
      setCounts({ available: c.lessons, reviews: c.reviews });
      setStartedToday(started);
      setProblem(null);
      if (!srsRead.current) {
        srsRead.current = true;
        api.srsSystems().then((list) => { if (list.length) setSrs(new Map(list.map((s) => [s.id, s]))); }, () => { srsRead.current = false; });
      }
      const names = repo ? (await repo.ankiDecks()).map((d) => d.name) : [];
      setDecks(names);
      produceRef.current(u.maxLevel, names);
    } catch (e) {
      setProblem(e instanceof WaniKaniError ? e.problem : 'unavailable');
    }
  }, [api, flush, repo, dayStartsAtHour]);

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
  }, []);

  return useMemo(() => ({
    on: token === undefined ? null : !!token,
    api, user,
    counts: counts ? { reviews: counts.reviews, lessons: lessonsToday(counts.available, prefs.newPerDay, startedToday) } : null,
    problem, prefs, setPrefs, signIn, signOut, refresh, srs, send, unsent, log, productionDeck, production, startedToday, dayStartsAtHour,
  }), [token, api, user, counts, problem, prefs, setPrefs, signIn, signOut, refresh, srs, send, unsent, log, productionDeck, production, startedToday, dayStartsAtHour]);
}
