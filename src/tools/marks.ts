/**
 * What a Practice tool remembers of your answers: per tool and language, how often each pattern
 * (patterns.ts: Thai's thûm hours, a Polish amount ending in 2 to 4) was missed lately, so the next
 * question leans toward it. A light lean, never a schedule: every question can still come up,
 * getting a pattern right takes a miss back off, and a pattern left alone fades after
 * `FADE_DAYS`. Kept on this phone only (storage.ts); nothing here touches a card.
 */

/** One pattern's misses, and when they last changed (epoch ms), for fading. */
export interface Tally {
  misses: number;
  at: number;
}

/** Each tool and language's tallies (`markList`), by pattern. A pattern with no misses isn't kept. */
export type Marks = Record<string, Record<string, Tally>>;

/** The most misses a pattern counts, and so the most a question is weighted: 1 + this. */
export const MAX_MISSES = 3;

/** A pattern not marked in this many days counts for nothing and is dropped. */
export const FADE_DAYS = 30;

/** How many questions are drawn to choose one from: the more, the stronger the lean. */
export const CANDIDATES = 4;

const DAY_MS = 24 * 60 * 60 * 1000;

export function markList(tool: string, language: string): string {
  return `${tool}:${language}`;
}

const live = (t: Tally | undefined, now: number): t is Tally => !!t && now - t.at < FADE_DAYS * DAY_MS;

/**
 * `marks` with one answer recorded: a miss adds one to each of the question's patterns (up to
 * MAX_MISSES), a right answer takes one off. Faded tallies in that list are dropped as it goes.
 */
export function recordMark(marks: Marks, list: string, patterns: string[], right: boolean, now: number): Marks {
  const kept: Record<string, Tally> = {};
  for (const [p, t] of Object.entries(marks[list] ?? {})) if (live(t, now)) kept[p] = t;
  for (const p of new Set(patterns)) {
    const misses = Math.max(0, Math.min(MAX_MISSES, (kept[p]?.misses ?? 0) + (right ? -1 : 1)));
    if (misses) kept[p] = { misses, at: now };
    else delete kept[p];
  }
  const next = { ...marks };
  if (Object.keys(kept).length) next[list] = kept;
  else delete next[list];
  return next;
}

/** How strongly a question with these patterns is drawn: 1, plus its patterns' live misses, at most 1 + MAX_MISSES. */
export function weightOf(tallies: Record<string, Tally> | undefined, patterns: string[], now: number): number {
  let misses = 0;
  for (const p of new Set(patterns)) {
    const t = tallies?.[p];
    if (live(t, now)) misses += t.misses;
  }
  return 1 + Math.min(MAX_MISSES, misses);
}

/**
 * A question from `draw` (the tool's own random pick), leaning toward missed patterns: CANDIDATES
 * are drawn and one chosen in proportion to its weight. With nothing missed, every candidate weighs
 * the same, so it's exactly `draw`'s own odds; and since each candidate is one of `draw`'s, a
 * guarantee it makes (never the previous question again) still holds.
 */
export function pickWeighted<T>(
  draw: () => T,
  patternsOf: (item: T) => string[],
  tallies: Record<string, Tally> | undefined,
  now: number,
  random: () => number = Math.random,
): T {
  const first = draw();
  if (!tallies || !Object.keys(tallies).length) return first;
  const candidates = [first];
  for (let i = 1; i < CANDIDATES; i++) candidates.push(draw());
  const weights = candidates.map((c) => weightOf(tallies, patternsOf(c), now));
  let r = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r < 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/** Anything unreadable is dropped: the tallies only lean the odds, so losing them costs little. */
export function parseMarks(raw: string | null): Marks {
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const marks: Marks = {};
  for (const [list, tallies] of Object.entries(parsed as Record<string, unknown>)) {
    if (!tallies || typeof tallies !== 'object') continue;
    const kept: Record<string, Tally> = {};
    for (const [p, t] of Object.entries(tallies as Record<string, unknown>)) {
      const { misses, at } = (t ?? {}) as Partial<Tally>;
      if (Number.isInteger(misses) && misses! > 0 && typeof at === 'number' && Number.isFinite(at)) kept[p] = { misses: Math.min(MAX_MISSES, misses!), at };
    }
    if (Object.keys(kept).length) marks[list] = kept;
  }
  return marks;
}
