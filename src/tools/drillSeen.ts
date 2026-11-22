/**
 * What a skill drill has asked lately, so its questions come round like a shuffled bag instead of
 * at random: 9:43 doesn't come back while others in the step haven't been asked. Per step and
 * language, the keys of the last `SEEN_KEPT` distinct questions, least recently asked first. A
 * step with fewer questions than that (1 to 10) cycles through all of them before any repeats;
 * a step with more (any minute, thousands) only avoids the recent ones, which is as much as a
 * bag would give there. Kept on this phone only (drillSeenStorage.ts); nothing here touches a card.
 */

export type DrillSeen = Record<string, string[]>;

/** How many distinct questions a step remembers. */
export const SEEN_KEPT = 30;

/** How many questions are drawn looking for one not seen lately, before giving up and taking the least recent. */
export const SEEN_TRIES = 40;

export const seenList = (language: string, stepId: string): string => `${language}:${stepId}`;

/** `seen` with `key` asked just now: it goes to the end of its list, and the oldest drop off past `SEEN_KEPT`. */
export function recordSeen(seen: DrillSeen, list: string, key: string): DrillSeen {
  const kept = (seen[list] ?? []).filter((k) => k !== key);
  kept.push(key);
  return { ...seen, [list]: kept.slice(-SEEN_KEPT) };
}

/** `seen` without `key` in `list`: a miss answered right since, no longer one to ask first. */
export function forgetSeen(seen: DrillSeen, list: string, key: string): DrillSeen {
  const kept = (seen[list] ?? []).filter((k) => k !== key);
  if (kept.length === (seen[list] ?? []).length) return seen;
  const { [list]: _gone, ...rest } = seen;
  return kept.length ? { ...rest, [list]: kept } : rest;
}

/** The list a step's missed months are kept in, beside its asked questions: a dates drill asks one of them first next time (`nextMonth`). */
export const missedList = (language: string, stepId: string): string => `${seenList(language, stepId)}:missed`;

/**
 * A question from `draw` that isn't in `recent` (least recently asked first). When every one of
 * `SEEN_TRIES` draws was asked lately (a small step, all of whose questions have been), the draw
 * asked longest ago wins, so a small step cycles through all its questions.
 */
export function drawUnseen<T>(draw: () => T, keyOf: (q: T) => string, recent: readonly string[] | undefined): T {
  const first = draw();
  if (!recent?.length) return first;
  let best = first;
  let bestAge = recent.indexOf(keyOf(first));
  if (bestAge < 0) return first;
  for (let i = 1; i < SEEN_TRIES; i++) {
    const q = draw();
    const age = recent.indexOf(keyOf(q));
    if (age < 0) return q;
    if (age < bestAge) { best = q; bestAge = age; }
  }
  return best;
}

/** What was saved, read back leniently: anything that isn't a list of keys is dropped. */
export function parseSeen(raw: unknown): DrillSeen {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: DrillSeen = {};
  for (const [list, keys] of Object.entries(raw)) {
    if (!Array.isArray(keys)) continue;
    const clean = keys.filter((k): k is string => typeof k === 'string');
    if (clean.length) out[list] = clean.slice(-SEEN_KEPT);
  }
  return out;
}

/** What was read from the file with the questions asked since, which come last: an answer given before the read finished isn't lost. */
export function mergeSeen(stored: DrillSeen, fresh: DrillSeen): DrillSeen {
  let merged = stored;
  for (const [list, keys] of Object.entries(fresh)) for (const k of keys) merged = recordSeen(merged, list, k);
  return merged;
}
