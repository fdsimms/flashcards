import { WaniKaniError, type WaniKaniProblem } from './api';

/**
 * Meaning synonyms the learner saved (or took back) that haven't reached WaniKani yet. Saving
 * a wrong typed meaning as a right one counts at once on this phone and is sent when WaniKani can
 * be reached, as answers are (prefs.ts, `flushOutbox`). Kept in the state file, in order.
 */
export interface SynonymChange {
  subjectId: number;
  synonym: string;
  /** Takes the synonym off the word instead of adding it. */
  remove?: boolean;
}

/** One key per synonym, as the typing check compares them (case and surrounding space don't matter). */
const same = (a: SynonymChange, b: SynonymChange) => a.subjectId === b.subjectId && a.synonym.trim().toLowerCase() === b.synonym.trim().toLowerCase();

/**
 * `queue` with `change` added. A change that undoes one still waiting (a save taken back before it
 * was sent) cancels it, so nothing goes to WaniKani at all.
 */
export function queueSynonym(queue: readonly SynonymChange[], change: SynonymChange): SynonymChange[] {
  const i = queue.findIndex((q) => same(q, change) && !!q.remove !== !!change.remove);
  if (i >= 0) return queue.filter((_, j) => j !== i);
  if (queue.some((q) => same(q, change) && !!q.remove === !!change.remove)) return [...queue];
  return [...queue, change];
}

/** A word's synonyms as WaniKani lists them, with the changes still waiting applied. */
export function withPending(subjectId: number, synonyms: readonly string[], queue: readonly SynonymChange[]): string[] {
  let out = [...synonyms];
  for (const q of queue) {
    if (q.subjectId !== subjectId) continue;
    out = q.remove ? out.filter((s) => s.trim().toLowerCase() !== q.synonym.trim().toLowerCase()) : out.some((s) => s.trim().toLowerCase() === q.synonym.trim().toLowerCase()) ? out : [...out, q.synonym];
  }
  return out;
}

export function isSynonymChange(x: unknown): x is SynonymChange {
  const o = x as Partial<SynonymChange> | null;
  return !!o && typeof o.subjectId === 'number' && typeof o.synonym === 'string' && (o.remove === undefined || typeof o.remove === 'boolean');
}

export interface SynonymFlush {
  left: SynonymChange[];
  problem?: WaniKaniProblem;
}

/**
 * Sends each change in order. WaniKani refusing one drops it and goes on; anything that could work
 * later (no connection, a bad token) stops there and keeps the rest.
 */
export async function flushSynonyms(queue: readonly SynonymChange[], send: (c: SynonymChange) => Promise<void>): Promise<SynonymFlush> {
  for (let i = 0; i < queue.length; i++) {
    try {
      await send(queue[i]);
    } catch (e) {
      const problem = e instanceof WaniKaniError ? e.problem : 'unavailable';
      if (problem === 'rejected') continue;
      return { left: queue.slice(i), problem };
    }
  }
  return { left: [] };
}
