// Words added for Claude to fill in while the server couldn't be reached: kept on the phone
// (src/ui/held.ts) and sent to the note queue when it can be (src/ui/HeldWork.tsx). Like the queue
// itself, nothing here adds a note: each word still waits to be reviewed in the note editor once
// Claude has filled it in. Pure, so it's tested.
import type { GlossLanguage } from './api';

export interface HeldEntry {
  entry: string;
  meaning: string;
}

/** One deck's words, sent to the queue together, as Quick add sends them. */
export interface HeldWords {
  language: GlossLanguage;
  deck: string;
  entries: HeldEntry[];
  /** Why the server refused them when they were last sent; tried again next time. */
  problem?: string;
}

/** The list with `entries` held for `deck`, a word already waiting there not held twice. */
export function holdWords(list: readonly HeldWords[], language: GlossLanguage, deck: string, entries: readonly HeldEntry[]): HeldWords[] {
  const i = list.findIndex((g) => g.language === language && g.deck === deck && !g.problem);
  const group = i >= 0 ? list[i] : { language, deck, entries: [] };
  const known = new Set(group.entries.map((e) => e.entry));
  const added = entries.filter((e) => !known.has(e.entry) && known.add(e.entry));
  const next = { ...group, entries: [...group.entries, ...added] };
  return i >= 0 ? list.map((g, j) => (j === i ? next : g)) : [...list, next];
}

/** The list without `entry` in `deck` (removed from the queue screen). */
export function dropWord(list: readonly HeldWords[], deck: string, entry: string): HeldWords[] {
  return list
    .map((g) => (g.deck === deck ? { ...g, entries: g.entries.filter((e) => e.entry !== entry) } : g))
    .filter((g) => g.entries.length);
}

/**
 * The list after the groups in `tried` were sent: `left` weren't (no connection) and stay, `refused`
 * stay with the server's reason, and the rest reached the queue and come off. A group changed while
 * they were being sent (a word added to it, or removed on the queue screen) is a new object the send
 * never saw, so it loses just the words that reached the queue; matching whole groups by identity
 * alone would keep them, and send them again.
 */
export function afterWordsSent(
  list: readonly HeldWords[],
  tried: readonly HeldWords[],
  left: readonly HeldWords[],
  refused: readonly { item: HeldWords; problem: string }[],
): HeldWords[] {
  const sent = tried.filter((g) => !left.includes(g) && !refused.some((r) => r.item === g));
  const reached = new Set(sent.flatMap((g) => g.entries.map((e) => JSON.stringify([g.language, g.deck, e.entry]))));
  return list.flatMap((g): HeldWords[] => {
    if (sent.includes(g)) return [];
    const problem = refused.find((r) => r.item === g)?.problem;
    if (problem !== undefined) return [{ ...g, problem }];
    if (tried.includes(g)) return [g];
    const entries = g.entries.filter((e) => !reached.has(JSON.stringify([g.language, g.deck, e.entry])));
    return entries.length === g.entries.length ? [g] : entries.length ? [{ ...g, entries }] : [];
  });
}

/** How many words are held, and how many of those the server refused last time. */
export function heldCounts(list: readonly HeldWords[]): { waiting: number; refused: number } {
  let waiting = 0;
  let refused = 0;
  for (const g of list) {
    if (g.problem) refused += g.entries.length;
    else waiting += g.entries.length;
  }
  return { waiting, refused };
}

export function parseHeldWords(raw: unknown): HeldWords[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((g): g is HeldWords => typeof g?.language === 'string' && typeof g?.deck === 'string' && Array.isArray(g?.entries)
    && g.entries.every((e: HeldEntry) => typeof e?.entry === 'string' && typeof e?.meaning === 'string'));
}
