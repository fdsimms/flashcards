import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  answered, cameBack, cantReach, guardFetch, isOffline, networkChanged, OfflineError, originOf, pathOf, problemWith, recheckDelayMs,
  sharedProbe, silent, SlowServerError, STARTING, type ConnectionState,
} from '../../src/core/connection';

const HOME = 'https://anki.example.com';
const WK = 'https://api.wanikani.com';

describe('the connection state', () => {
  it('reads expo-network', () => {
    expect(pathOf({ type: 'NONE', isConnected: false })).toBe('none');
    expect(pathOf({ type: 'WIFI', isConnected: true })).toBe('wifi');
    expect(pathOf({ type: 'CELLULAR', isConnected: true })).toBe('cellular');
    expect(pathOf({ type: 'UNKNOWN' })).toBe('unknown');
    expect(pathOf({ type: 'VPN', isConnected: true })).toBe('other');
    expect(pathOf({ type: 'WIFI', isConnected: false })).toBe('none');
  });

  it('knows a server by its origin', () => {
    expect(originOf('https://Anki.Example.com/reader/api/check')).toBe(HOME);
    expect(originOf('https://api.wanikani.com/v2')).toBe(WK);
    expect(originOf('http://10.0.0.2:8080/')).toBe('http://10.0.0.2:8080');
  });

  it('is offline with no network, or once nothing answered', () => {
    expect(isOffline(STARTING)).toBe(false);
    expect(isOffline({ ...STARTING, path: 'none' })).toBe(true);
    expect(isOffline(silent({ ...STARTING, path: 'cellular' }, HOME, false))).toBe(true);
  });

  it('tells a server that is down from being offline', () => {
    const down = silent({ ...STARTING, path: 'wifi' }, HOME, true);
    expect(isOffline(down)).toBe(false);
    expect(cantReach(down, HOME)).toBe(true);
    expect(cantReach(down, WK)).toBe(false);
    expect(problemWith(down, HOME)).toBe('server');
    expect(problemWith(silent(down, WK, true), undefined)).toBeNull();
    expect(problemWith({ ...STARTING, path: 'none' }, HOME)).toBe('offline');
  });

  it('clears a server once it answers, and the internet with it', () => {
    const s = silent(silent({ ...STARTING, path: 'wifi' }, HOME, true), WK, false);
    const after = answered(s, HOME);
    expect(after).toEqual({ path: 'wifi', noInternet: false, down: [] });
    expect(answered(after, HOME)).toBe(after);
  });

  it('starts afresh on a new network, but keeps what it knew with none', () => {
    const s: ConnectionState = { path: 'cellular', noInternet: true, down: [HOME] };
    expect(networkChanged(s, 'wifi')).toEqual({ path: 'wifi', noInternet: false, down: [] });
    expect(networkChanged(s, 'none')).toEqual({ ...s, path: 'none' });
  });

  it('says when something can be reached again', () => {
    const none: ConnectionState = { ...STARTING, path: 'none' };
    expect(cameBack(none, networkChanged(none, 'wifi'))).toBe(true);
    expect(cameBack(STARTING, networkChanged(STARTING, 'wifi'))).toBe(false);
    const down = silent({ ...STARTING, path: 'wifi' }, HOME, true);
    expect(cameBack(down, answered(down, HOME))).toBe(true);
  });

  it('checks a dead network soon, then once a minute', () => {
    expect(recheckDelayMs(0)).toBe(10_000);
    expect(recheckDelayMs(1)).toBe(20_000);
    expect(recheckDelayMs(5)).toBe(60_000);
  });
});

describe('guardFetch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A fetch that answers after `ms`, or never, and fails once aborted, as fetch does. */
  const slowFetch = (ms: number | null) => vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    if (ms !== null) setTimeout(() => resolve(new Response('{}')), ms);
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  }));

  const setup = (fetch: ReturnType<typeof slowFetch>, probeOk: boolean, state: ConnectionState = STARTING) => {
    const reports: boolean[] = [];
    const probe = vi.fn(async () => probeOk);
    const guarded = guardFetch({ fetch, origin: HOME, probe, state: () => state, report: (ok) => reports.push(ok), quietMs: 8000, longestMs: 60_000 });
    return { guarded, reports, probe };
  };

  it('tries nothing with no network', async () => {
    const fetch = slowFetch(10);
    const { guarded } = setup(fetch, true, { ...STARTING, path: 'none' });
    await expect(guarded('u')).rejects.toBeInstanceOf(OfflineError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes a quick answer through, unchecked', async () => {
    const { guarded, reports, probe } = setup(slowFetch(100), false);
    const r = guarded('u');
    await vi.advanceTimersByTimeAsync(100);
    await expect(r).resolves.toBeInstanceOf(Response);
    expect(probe).not.toHaveBeenCalled();
    expect(reports).toEqual([true]);
  });

  it('gives up on a stalled request once the server is found out of reach', async () => {
    const { guarded, reports } = setup(slowFetch(null), false);
    const r = guarded('u');
    const settled = expect(r).rejects.toBeInstanceOf(OfflineError);
    await vi.advanceTimersByTimeAsync(8000);
    await settled;
    expect(reports).toEqual([false]);
  });

  it('lets a slow answer finish when the server is there', async () => {
    const { guarded, reports } = setup(slowFetch(30_000), true);
    const r = guarded('u');
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(r).resolves.toBeInstanceOf(Response);
    expect(reports).toEqual([true, true]);
  });

  it('stops waiting at the longest wait', async () => {
    const { guarded } = setup(slowFetch(null), true);
    const r = guarded('u');
    const settled = expect(r).rejects.toBeInstanceOf(SlowServerError);
    await vi.advanceTimersByTimeAsync(60_000);
    await settled;
  });

  it('checks at once when the server was last out of reach', async () => {
    const { guarded, probe } = setup(slowFetch(null), false, { path: 'cellular', noInternet: false, down: [HOME] });
    const settled = expect(guarded('u')).rejects.toBeInstanceOf(OfflineError);
    await vi.advanceTimersByTimeAsync(0);
    await settled;
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('counts a request the network refuses as offline', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('Network request failed'); });
    const { guarded, reports } = setup(fetch as unknown as ReturnType<typeof slowFetch>, true);
    await expect(guarded('u')).rejects.toBeInstanceOf(OfflineError);
    expect(reports).toEqual([false]);
  });

  it("leaves the connection alone when the caller aborts", async () => {
    const { guarded, reports } = setup(slowFetch(null), true);
    const caller = new AbortController();
    const r = guarded('u', { signal: caller.signal });
    caller.abort();
    await expect(r).rejects.toThrow('aborted');
    expect(reports).toEqual([]);
  });
});

describe('sharedProbe', () => {
  it('shares one check among callers, and makes a new one after', async () => {
    let n = 0;
    const probe = sharedProbe(async () => { n++; return true; });
    await Promise.all([probe(), probe(), probe()]);
    expect(n).toBe(1);
    await probe();
    expect(n).toBe(2);
  });

  it('reads a failed check as no answer', async () => {
    const probe = sharedProbe(async () => { throw new Error('x'); });
    await expect(probe()).resolves.toBe(false);
  });
});
