// Words added for Claude to fill in while the server couldn't be reached: kept on the phone
// (src/ui/held.ts) and sent to the note queue when it can be (src/ui/HeldWork.tsx). Like the queue
// itself, nothing here adds a note: each word still waits to be reviewed in the note editor once
// Claude has filled it in. Pure, so it's tested.
import type { Language } from './api';

export interface HeldEntry {
  entry: string;
  meaning: string;
}

/** One deck's words, sent to the queue together, as Quick add sends them. */
export interface HeldWords {
  language: Language;
  deck: string;
  entries: HeldEntry[];
  /** Why the server refused them when they were last sent; tried again next time. */
  problem?: string;
}

/** The list with `entries` held for `deck`, a word already waiting there not held twice. */
export function holdWords(list: readonly HeldWords[], language: Language, deck: string, entries: readonly HeldEntry[]): HeldWords[] {
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
