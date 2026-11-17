import { Refusal } from './failure';

/**
 * Whether Franki can reach its servers (the Anki sync server, Read & Listen's, WaniKani), and the
 * guard every request to them goes through. Pure, so it's tested; src/ui/connection.ts feeds it
 * the phone's network and runs the checks.
 *
 * Offline is two things. iOS says when there's no network at all (`path` 'none'), and then nothing
 * is tried. But a phone on a subway platform is often joined to a network that leads nowhere, and
 * iOS calls that connected (expo-network's isInternetReachable is the same flag on iOS), so a
 * request that stalls is checked against the server itself: a quick request that any answer
 * passes (`probe`). No answer means unreachable, and the stalled request gives up at once rather
 * than after iOS's own minute. An answer means the server is only slow (a Claude explanation can
 * take half a minute), so the request is left to finish. A fixed timeout would cut those off.
 *
 * A server that doesn't answer is then told apart from no internet by one more check, of a page
 * Apple keeps for exactly this (src/ui/connection.ts): if that answers, only the server is out
 * (`down`), and the header says so instead of "Offline".
 */

export type NetworkPath = 'none' | 'wifi' | 'cellular' | 'other' | 'unknown';

export interface ConnectionState {
  /** What iOS says the phone is joined to. */
  path: NetworkPath;
  /** A server didn't answer and neither did the internet check, since the network last changed. */
  noInternet: boolean;
  /** Servers (origins) that didn't answer while the internet did: down, or their address is wrong. */
  down: readonly string[];
}

export const STARTING: ConnectionState = { path: 'unknown', noInternet: false, down: [] };

/** No connection to anything: no network, or one that leads nowhere. */
export const isOffline = (s: ConnectionState): boolean => s.path === 'none' || s.noInternet;

/** Whether a request to `origin` can't get through now: offline, or that server is down. */
export const cantReach = (s: ConnectionState, origin: string): boolean => isOffline(s) || s.down.includes(origin);

/** `https://host[:port]` of a URL, lowercased: what a server is known by here. */
export function originOf(url: string): string {
  return (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+/i.exec(url.trim())?.[0] ?? url).toLowerCase();
}

/** expo-network's state as a path. Its `type` strings are NetworkStateType's values. */
export function pathOf(state: { type?: string; isConnected?: boolean }): NetworkPath {
  if (state.isConnected === false || state.type === 'NONE') return 'none';
  if (state.type === 'WIFI' || state.type === 'ETHERNET') return 'wifi';
  if (state.type === 'CELLULAR') return 'cellular';
  if (state.type === undefined || state.type === 'UNKNOWN') return 'unknown';
  return 'other';
}

/**
 * The state after the network changes. A change of network is a fresh start: a train reaching a
 * station joins a new one, and the last one's failures say nothing about it.
 */
export function networkChanged(s: ConnectionState, path: NetworkPath): ConnectionState {
  return path === 'none' ? { ...s, path } : { path, noInternet: false, down: [] };
}

/** The state after `origin` answered: it's up, and so is the internet. */
export function answered(s: ConnectionState, origin: string): ConnectionState {
  if (!s.noInternet && !s.down.includes(origin)) return s;
  return { ...s, noInternet: false, down: s.down.filter((o) => o !== origin) };
}

/**
 * The state after `origin` didn't answer. `internet` is whether a check elsewhere did: then only
 * that server is out; otherwise the phone is offline.
 */
export function silent(s: ConnectionState, origin: string, internet: boolean): ConnectionState {
  if (!internet) return s.noInternet ? s : { ...s, noInternet: true };
  if (!s.noInternet && s.down.includes(origin)) return s;
  return { ...s, noInternet: false, down: s.down.includes(origin) ? s.down : [...s.down, origin] };
}

/** Whether a change of state lets something through again: the moment to send what's been held. */
export function cameBack(before: ConnectionState, after: ConnectionState): boolean {
  if (isOffline(after)) return false;
  return isOffline(before) || before.down.some((o) => !after.down.includes(o));
}

/** What the header and the sync line say about `home` (the user's own server): nothing wrong, offline, or it can't be reached. */
export function problemWith(s: ConnectionState, home: string | undefined): 'offline' | 'server' | null {
  if (isOffline(s)) return 'offline';
  return home && s.down.includes(home) ? 'server' : null;
}

/**
 * How long to wait before checking again while a server can't be reached on a network iOS calls
 * connected (no event says when a dead network starts working): soon at first, then once a minute.
 */
export function recheckDelayMs(checks: number): number {
  return Math.min(60_000, 10_000 * 2 ** Math.max(0, checks));
}

/** A request given up because the servers can't be reached: shown as it is (a Refusal). */
export class OfflineError extends Refusal {
  constructor(message = "Couldn't reach the server. Check your connection, then try again.") {
    super(message);
  }
}

/** A request the server took too long to answer, though it could be reached. */
export class SlowServerError extends Refusal {
  constructor() {
    super('The server took too long to answer. Try again.');
  }
}

/** How long a request waits for an answer before the server is checked. */
export const QUIET_MS = 8_000;
/** The longest any request waits, once the server is known to be there. */
export const LONGEST_MS = 180_000;
/** How long a check waits for any answer. */
export const PROBE_MS = 5_000;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface GuardDeps {
  fetch: Fetch;
  /** The server the requests go to (`originOf`). */
  origin: string;
  /** Asks the server for anything at all; resolves whether an answer came back. Never throws. */
  probe: () => Promise<boolean>;
  state: () => ConnectionState;
  /** Told what a request or a check learned about the server. */
  report: (ok: boolean) => void;
  quietMs?: number;
  longestMs?: number;
}

/**
 * `fetch` behind the guard. With no network it throws OfflineError without trying. Otherwise the
 * request goes out, and once it has waited `quietMs` (at once when that server, or the internet,
 * was last found out of reach) the server is checked: no answer gives up with OfflineError, an answer lets the request
 * run to `longestMs`. A request the network itself refuses throws OfflineError too. Either way the
 * outcome is reported, so every screen learns it.
 */
export function guardFetch(deps: GuardDeps): Fetch {
  const quietMs = deps.quietMs ?? QUIET_MS;
  const longestMs = deps.longestMs ?? LONGEST_MS;
  return async (url, init) => {
    const before = deps.state();
    if (before.path === 'none') throw new OfflineError();
    const abort = new AbortController();
    const outer = init?.signal;
    if (outer) {
      if (outer.aborted) abort.abort();
      else outer.addEventListener('abort', () => abort.abort(), { once: true });
    }
    let why: OfflineError | SlowServerError | null = null;
    const giveUp = (e: OfflineError | SlowServerError) => { why = e; abort.abort(); };
    const longest = setTimeout(() => giveUp(new SlowServerError()), longestMs);
    const check = setTimeout(() => {
      void deps.probe().then((ok) => {
        deps.report(ok);
        if (!ok) giveUp(new OfflineError());
      });
    }, cantReach(before, deps.origin) ? 0 : quietMs);
    try {
      const response = await deps.fetch(url, { ...init, signal: abort.signal });
      deps.report(true);
      return response;
    } catch (e) {
      if (why) throw why;
      // Aborted by the caller: not a fact about the connection.
      if (outer?.aborted) throw e;
      deps.report(false);
      throw new OfflineError();
    } finally {
      clearTimeout(longest);
      clearTimeout(check);
    }
  };
}

/** One check at a time: callers that ask while one is out share its answer. */
export function sharedProbe(probe: () => Promise<boolean>): () => Promise<boolean> {
  let running: Promise<boolean> | null = null;
  return () => {
    running ??= probe().catch(() => false).finally(() => { running = null; });
    return running;
  };
}
