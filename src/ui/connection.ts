import * as Network from 'expo-network';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import {
  answered, cameBack, cantReach, guardFetch, isOffline, networkChanged, originOf, pathOf, PROBE_MS, problemWith, recheckDelayMs,
  sharedProbe, silent, STARTING, type ConnectionState,
} from '../core/connection';

/**
 * The phone's side of src/core/connection.ts: one copy of what can be reached, fed by iOS's
 * network changes (expo-network) and by every guarded request, for any screen or service to read
 * without AppContext. `useConnection` starts it, from AppContext, in one line.
 *
 * When a server doesn't answer, one request to a page Apple keeps for checking a connection (iOS
 * itself asks it when joining Wi-Fi) tells offline from that server being down. It's the one
 * request here to something that isn't the user's own server or WaniKani, and it's made only after
 * one of those failed; it carries nothing of the user's.
 */
const INTERNET_CHECK = 'https://www.apple.com/library/test/success.html';

let state: ConnectionState = STARTING;
/** The user's own server (sync, and Read & Listen beside it), set by useConnection. */
let home: string | undefined;
const listeners = new Set<() => void>();
const comebacks = new Set<() => void>();

function set(next: ConnectionState) {
  if (next === state) return;
  const before = state;
  state = next;
  listeners.forEach((l) => l());
  if (cameBack(before, next)) comebacks.forEach((l) => l());
}

/** Whether `url` answers anything at all within PROBE_MS: any status counts, since only reaching it is asked. */
export async function probe(url: string): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PROBE_MS);
  try {
    await fetch(url, { method: 'GET', signal: abort.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const internetCheck = sharedProbe(() => probe(INTERNET_CHECK));

export const connection = {
  get: (): ConnectionState => state,
  /** No connection at all. */
  offline: (): boolean => isOffline(state),
  /** Whether the user's own server can't be reached now (offline, or it's down): hold what's for it. */
  cantReachHome: (): boolean => (home ? cantReach(state, home) : isOffline(state)),
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  /** What a request to `origin` learned: answered, or nothing there (then the internet is checked). */
  report(origin: string, ok: boolean) {
    if (ok) { set(answered(state, origin)); return; }
    if (state.path === 'none') return;
    void internetCheck().then((internet) => set(silent(state, origin, internet)));
  },
};

/** Whether there's no connection at all, for a screen. */
export function useOffline(): boolean {
  return useSyncExternalStore(connection.subscribe, connection.offline);
}

/** What's wrong with reaching the user's own server: nothing, offline, or the server itself. */
export function useConnectionProblem(): 'offline' | 'server' | null {
  return useSyncExternalStore(connection.subscribe, () => problemWith(state, home));
}

/** The latest `run`, called each time something can be reached again. */
export function useBackOnline(run: () => void) {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    const call = () => latest.current();
    comebacks.add(call);
    return () => { comebacks.delete(call); };
  }, []);
}

/** `fetch` behind the guard (src/core/connection.ts), checking `probeUrl` when a request stalls. */
export function guardedFetch(probeUrl: string, base: typeof fetch = fetch): typeof fetch {
  const origin = originOf(probeUrl);
  return guardFetch({
    fetch: (url, init) => base(url, init),
    origin,
    probe: sharedProbe(() => probe(probeUrl)),
    state: connection.get,
    report: (ok) => connection.report(origin, ok),
  }) as typeof fetch;
}

/**
 * Starts following the network, with `server` as the user's own. While it can't be reached on a
 * network iOS calls connected, it's checked now and then (recheckDelayMs), since nothing else says
 * when a dead network starts working or a server comes back; and at once when the app comes back
 * to the front.
 */
export function useConnection(server: string | undefined) {
  const origin = server ? originOf(server) : undefined;
  home = origin;
  const problem = useConnectionProblem();
  useEffect(() => {
    Network.getNetworkStateAsync().then((s) => set(networkChanged(state, pathOf(s))), () => undefined);
    const sub = Network.addNetworkStateListener((s) => set(networkChanged(state, pathOf(s))));
    return () => sub.remove();
  }, []);

  const check = useCallback(async () => {
    if (!server || !origin || state.path === 'none' || !cantReach(state, origin)) return;
    const ok = await probe(server);
    if (ok) set(answered(state, origin));
    else set(silent(state, origin, await internetCheck()));
  }, [server, origin]);

  useEffect(() => {
    if (!problem || !server) return undefined;
    let checks = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(async () => {
        await check();
        checks++;
        if (origin && cantReach(state, origin)) next();
      }, recheckDelayMs(checks));
    };
    next();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void check(); });
    return () => { clearTimeout(timer); sub.remove(); };
  }, [problem, server, origin, check]);
}
