/**
 * Keeping under WaniKani's rate limit. WaniKani answers at most 60 requests a minute for an account
 * and refuses the rest (429). Franki's reads come in bursts (a session closing sends its answers,
 * then reads the counts, the offline copy, the stats and production notes at once), and a burst
 * past the limit used to show "Too many requests" on the deck list. So requests are spaced to stay
 * under it, and one refused anyway (wanikani.com or another app using the same account) waits for
 * the limit to reset and is tried again, rather than failing.
 *
 * The limit and the RateLimit-Reset header (the time the limit resets, in epoch seconds) are from
 * memory of WaniKani's docs, which weren't reachable when this was written. Neither is relied on:
 * the pace leaves room under 60, and a reset that's missing or unlikely waits a minute.
 */

/** Requests Franki makes in any minute: under WaniKani's 60, leaving room for wanikani.com open at the same time. */
export const REQUESTS_PER_MINUTE = 50;
export const WINDOW_MS = 60_000;
/** The longest a refused request waits before trying again: a little over WaniKani's own window. */
const LONGEST_WAIT_MS = 65_000;

/**
 * When the next request may go: now, unless `limit` have gone (or are booked to go) in the minute
 * before; never before `heldUntil` (a refusal's reset); and never before one already booked, so
 * requests go in the order they asked. `booked` is in order, oldest first.
 */
export function nextSlot(booked: readonly number[], now: number, heldUntil: number, limit = REQUESTS_PER_MINUTE): number {
  let at = Math.max(now, heldUntil);
  if (booked.length >= limit) at = Math.max(at, booked[booked.length - limit] + WINDOW_MS);
  if (booked.length) at = Math.max(at, booked[booked.length - 1]);
  return at;
}

/** How long a refused request waits: until RateLimit-Reset (epoch seconds), or a minute when it's missing or unlikely. */
export function retryDelay(reset: string | null | undefined, now: number): number {
  const at = reset ? Number(reset) * 1000 : NaN;
  if (!Number.isFinite(at)) return WINDOW_MS;
  // A reset already passed (the phone's clock runs ahead, say) still waits a second, so the retry isn't refused at once.
  return Math.min(Math.max(at - now, 1000), LONGEST_WAIT_MS);
}

export interface Pacer {
  /** Waits until a request may go, and books it. */
  wait(): Promise<void>;
  /** Holds every request until `ms` from now: after a refusal. */
  hold(ms: number): void;
}

export function createPacer(
  clock: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Pacer {
  let booked: number[] = [];
  let heldUntil = 0;
  return {
    async wait() {
      const now = clock();
      const at = nextSlot(booked, now, heldUntil);
      // Booked before the wait, so requests asking at the same moment (a Promise.all) each get their own slot.
      booked = [...booked.filter((t) => t > now - WINDOW_MS), at].slice(-REQUESTS_PER_MINUTE);
      if (at > now) await sleep(at - now);
    },
    hold(ms) {
      heldUntil = Math.max(heldUntil, clock() + ms);
    },
  };
}
