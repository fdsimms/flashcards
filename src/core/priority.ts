import { deckLineage, inheritedSetting, isInDeck } from './deckTree';
import type { DeckSettings, Note } from './types';

/**
 * "Tagged cards first" (Franki's own, `DeckSettings.priority*`): new cards whose note carries a tag
 * (words from a tutor lesson, say) come before the deck's other new cards. It only reorders cards
 * the daily limits already let in, never adds any, and never touches reviews, so FSRS keeps its
 * schedule. It ends on its own for each card: once the card has been studied (it's no longer New),
 * or `days` after Franki first saw the tag on its note, and it can't take more than `percent` of the
 * new cards a day allows.
 */
export const DEFAULT_PRIORITY_DAYS = 14;
export const DEFAULT_PRIORITY_PERCENT = 50;
export const MAX_PRIORITY_DAYS = 365;

const DAY_MS = 86400000;

export interface PrioritySettings {
  on: boolean;
  tag: string;
  days: number;
  percent: number;
  /** The deck whose own switch decides this (nearest on the way up), where first-seen dates are kept. */
  owner: string | undefined;
}

/** The setting for a deck: its own, else its nearest ancestor's, as the other deck settings are. */
export function prioritySettings(deck: string, all: Map<string, DeckSettings>): PrioritySettings {
  const owner = deckLineage(deck).reverse().find((d) => all.get(d)?.priorityFirst !== undefined);
  return {
    on: owner !== undefined && all.get(owner)!.priorityFirst === true,
    tag: (inheritedSetting(deck, all, 'priorityTag') ?? '').trim(),
    days: inheritedSetting(deck, all, 'priorityDays') ?? DEFAULT_PRIORITY_DAYS,
    percent: inheritedSetting(deck, all, 'priorityPercent') ?? DEFAULT_PRIORITY_PERCENT,
    owner,
  };
}

/** Anki's tag match: case-insensitive, and `tag` also matches `tag::child`. */
export function noteHasTag(note: Note, tag: string): boolean {
  const t = tag.trim().toLowerCase();
  if (!t) return false;
  return note.tags.some((x) => { const l = x.toLowerCase(); return l === t || l.startsWith(`${t}::`); });
}

/** A whole number from what was typed, within `min`..`max`, or what to fix. */
export function parsePriorityNumber(text: string, min: number, max: number, what: string): { value: number } | { error: string } {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return { error: `${what} must be a whole number from ${min} to ${max}.` };
  const n = Number(t);
  if (n < min || n > max) return { error: `${what} must be from ${min} to ${max}.` };
  return { value: n };
}

/** How many of the new cards a deck lets in today may come first: `percent` of them, at least one. */
export function boostCap(percent: number, room: number): number {
  if (!Number.isFinite(room)) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.ceil((percent / 100) * room));
}

export interface Boost {
  /** Notes whose new cards come first. */
  noteIds: Set<string>;
  percent: number;
}

/**
 * The boost for each deck studied: its tagged notes still inside their window, and the cap. The
 * deck list and the review screen both call this, so a deck never counts cards it opens without.
 * A tagged note Franki hasn't recorded yet (`planPriorityStamps` writes it) counts from now.
 */
export function boostFor(a: { notes: Iterable<Note>; settings: Map<string, DeckSettings>; now: Date }): (root: string) => Boost | undefined {
  const notes = [...a.notes];
  const memo = new Map<string, Boost | undefined>();
  return (root) => {
    if (memo.has(root)) return memo.get(root);
    const s = prioritySettings(root, a.settings);
    let result: Boost | undefined;
    if (s.on && s.tag) {
      const noteIds = new Set<string>();
      for (const n of notes) {
        if (!isInDeck(n.deck, root) || !noteHasTag(n, s.tag)) continue;
        const owner = prioritySettings(n.deck, a.settings).owner;
        const since = owner ? a.settings.get(owner)?.priorityStamps?.[n.id] : undefined;
        if (!since || a.now.getTime() - new Date(since).getTime() < s.days * DAY_MS) noteIds.add(n.id);
      }
      if (noteIds.size) result = { noteIds, percent: s.percent };
    }
    memo.set(root, result);
    return result;
  };
}

/**
 * The first-seen dates to save: a stamp for each tagged note that has none, and none for a note
 * that lost the tag (so tagging it again starts a new window). Only decks whose settings change
 * are returned.
 */
export function planPriorityStamps(notes: Iterable<Note>, settings: Map<string, DeckSettings>, now: Date): Map<string, DeckSettings> {
  const list = [...notes];
  const out = new Map<string, DeckSettings>();
  for (const [deck, own] of settings) {
    if (own.priorityFirst === undefined) continue;
    const s = prioritySettings(deck, settings);
    const next: Record<string, string> = {};
    if (s.on && s.tag) {
      for (const n of list) {
        if (!isInDeck(n.deck, deck) || prioritySettings(n.deck, settings).owner !== deck || !noteHasTag(n, s.tag)) continue;
        next[n.id] = own.priorityStamps?.[n.id] ?? now.toISOString();
      }
    }
    const before = own.priorityStamps ?? {};
    const same = Object.keys(next).length === Object.keys(before).length && Object.entries(next).every(([k, v]) => before[k] === v);
    if (!same) out.set(deck, { ...own, priorityStamps: Object.keys(next).length ? next : undefined });
  }
  return out;
}
