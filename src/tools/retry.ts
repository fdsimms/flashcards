/**
 * A missed question comes back once, a few questions later, in the Practice tools that draw at
 * random (time, money, dates): seeing it again after a short gap, rather than never that session,
 * is what makes the miss worth something. Pure, and kept only while the screen is open; nothing
 * here touches a card (tests/tools/noGrading.test.ts).
 *
 * Each question is retried at most once: one missed again on its retry isn't queued again. Misses
 * come back in the order they were made, one at a time, and never right after the same question.
 */

/** A missed question comes back this many questions after it, at random within the range. */
export const RETRY_AFTER_MIN = 3;
export const RETRY_AFTER_MAX = 5;

interface Waiting<T> {
  /** What makes it the same question (the asked date, the amount), to tell it from the one showing. */
  key: string;
  item: T;
  /** Questions still to go before it's due; 0 once it is. */
  wait: number;
}

export interface Retries<T> {
  /**
   * What the questions are asked in (the language, the mode): a question missed in one isn't
   * handed back in another, so a change of scope starts over.
   */
  scope: string;
  /** Waiting to come back, first missed first. */
  queue: Waiting<T>[];
  /** Every question queued so far, so none is retried twice. */
  queued: string[];
}

export function noRetries<T>(scope = ''): Retries<T> {
  return { scope, queue: [], queued: [] };
}

const inScope = <T>(r: Retries<T>, scope: string): Retries<T> => (r.scope === scope ? r : noRetries(scope));

/**
 * `r` with a miss of `item` queued to come back RETRY_AFTER_MIN to RETRY_AFTER_MAX questions
 * later, unless that question was queued before (it's waiting, or this was its retry). `random` is
 * Math.random's shape, for tests.
 */
export function queueMiss<T>(r: Retries<T>, scope: string, key: string, item: T, random: () => number = Math.random): Retries<T> {
  const at = inScope(r, scope);
  if (at.queued.includes(key)) return at;
  const wait = RETRY_AFTER_MIN + Math.floor(random() * (RETRY_AFTER_MAX - RETRY_AFTER_MIN + 1));
  return { scope, queue: [...at.queue, { key, item, wait }], queued: [...at.queued, key] };
}

/**
 * The question after the one showing (`currentKey`): one question has passed for each waiting, so
 * the first missed comes back once it's due, unless it's the one showing; anything else is
 * `draw`'s (the tool's own random pick, which never repeats the one showing either).
 */
export function nextQuestion<T>(r: Retries<T>, scope: string, currentKey: string | undefined, draw: () => T): { item: T; retries: Retries<T> } {
  const at = inScope(r, scope);
  const queue = at.queue.map((w) => ({ ...w, wait: Math.max(0, w.wait - 1) }));
  const head = queue[0];
  if (head && head.wait === 0 && head.key !== currentKey) {
    return { item: head.item, retries: { ...at, queue: queue.slice(1) } };
  }
  return { item: draw(), retries: { ...at, queue } };
}
