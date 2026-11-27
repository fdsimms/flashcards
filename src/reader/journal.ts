// The writing journal (docs/read-and-listen/architecture.md, Journal; server/reader journal.py): anything
// the owner writes in the language, checked by Claude sentence by sentence and kept on the server. What the
// screens decide, pure so it's tested: the first try's marks, the headline, which practice a kind of
// mistake offers, and the entries held on the phone while the server can't be reached. Nothing here grades
// a card or writes a note.
import type { JournalCheck, JournalEntry, JournalKind, JournalSentence, Language } from './api';

/** The longest entry the server checks (journal.py, `MAX_ENTRY`). */
export const JOURNAL_MAX = 2000;

/** A piece of a sentence on the first try: the learner's words, with a mistake numbered where it is. */
export interface MarkedPart {
  text: string;
  /** The mistake's number in the entry, 1 first; absent for words that are fine. */
  mark?: number;
}

/**
 * A sentence as written with each mistake's words picked out and numbered from `first`, in the order
 * they come in the sentence; `marks` gives each mistake's number, in the check's order. A mistake whose
 * words aren't in it (a word that's missing) is numbered after the rest, at the end of the sentence,
 * with nothing picked out.
 */
export function markedParts(sentence: JournalSentence, first: number): { parts: MarkedPart[]; marks: number[]; next: number } {
  const text = sentence.written;
  const lower = text.toLocaleLowerCase();
  const spans: { at: number; end: number; index: number }[] = [];
  const unplaced: number[] = [];
  sentence.mistakes.forEach((m, index) => {
    const was = m.was.toLocaleLowerCase();
    let at = was ? lower.indexOf(was) : -1;
    // The same words twice, or overlapping another mistake: the next copy that's free.
    while (at >= 0 && spans.some((s) => at < s.end && at + was.length > s.at)) at = lower.indexOf(was, at + 1);
    if (at >= 0) spans.push({ at, end: at + was.length, index });
    else unplaced.push(index);
  });
  spans.sort((a, b) => a.at - b.at);
  const marks: number[] = [];
  let n = first;
  for (const s of spans) marks[s.index] = n++;
  for (const index of unplaced) marks[index] = n++;
  const parts: MarkedPart[] = [];
  let at = 0;
  for (const s of spans) {
    if (s.at > at) parts.push({ text: text.slice(at, s.at) });
    parts.push({ text: text.slice(s.at, s.end), mark: marks[s.index] });
    at = s.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  for (const index of unplaced) parts.push({ text: '', mark: marks[index] });
  return { parts, marks, next: n };
}

/** Each sentence's parts and the first try's hints, numbered across the whole entry as the marks are. */
export function firstTry(check: JournalCheck): { sentences: MarkedPart[][]; hints: { mark: number; hint: string }[] } {
  const sentences: MarkedPart[][] = [];
  const hints: { mark: number; hint: string }[] = [];
  let next = 1;
  for (const s of check.sentences) {
    const marked = markedParts(s, next);
    sentences.push(marked.parts);
    hints.push(...s.mistakes.map((m, i) => ({ mark: marked.marks[i], hint: m.hint })).sort((a, b) => a.mark - b.mark));
    next = marked.next;
  }
  return { sentences, hints };
}

/** How many sentences have something to fix. */
export const toFix = (check: JournalCheck): number => check.sentences.filter((s) => s.verdict !== 'right').length;

/** The headline over a check: on the first try, how many sentences to fix; with the corrections, how many were right. */
export function journalHeadline(check: JournalCheck, corrections: boolean): string {
  const fix = toFix(check);
  const all = check.sentences.length;
  if (!fix) return all === 1 ? "Right. This is how it's said." : `All ${all} sentences right.`;
  if (corrections) return `${all - fix} of ${all} sentences right`;
  if (check.verdict === 'wrong') return fix === 1 ? 'Not quite. 1 sentence to fix.' : `Not quite. ${fix} sentences to fix.`;
  return fix === 1 ? 'Almost. 1 sentence to fix.' : `Almost. ${fix} sentences to fix.`;
}

/**
 * Whether a check is first shown without its corrections, for one more try: the first check of an entry
 * with something to fix (production.ts's `asksAnotherTry`, for a whole entry). The second check, or Show the
 * corrections, shows everything.
 */
export const asksAnotherTry = (entry: Pick<JournalEntry, 'tries' | 'check'>): boolean => entry.tries <= 1 && toFix(entry.check) > 0;

/** What a kind of mistake offers: Which case for a case ending in a language it has, a grammar point's page for a point, or nothing. */
export function kindPractice(kind: Pick<JournalKind, 'group' | 'point'>, caseLanguages: readonly Language[], language: Language): 'cases' | 'point' | null {
  if (kind.group.startsWith('case:') && caseLanguages.includes(language)) return 'cases';
  return kind.point ? 'point' : null;
}

/** A first line for the list of entries: the start of the entry, on one line. */
export function preview(text: string, most = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > most ? `${flat.slice(0, most - 1).trimEnd()}…` : flat;
}

// ==== Held entries ====

/** An entry checked while the server couldn't be reached: sent, and checked, when it can be. */
export interface HeldEntry {
  /** The phone's id for it, so it's checked once however many times it's sent. */
  key: string;
  language: Language;
  text: string;
  prompt: string;
  /** The entry it's written again for; absent for a new one. */
  entryId?: number;
  /** When it was held, epoch ms. */
  at: number;
  /** Why the server refused it when last sent; tried again next time. */
  problem?: string;
}

/** The list with `entry` held, replacing one with the same key or written again for the same entry. */
export function holdEntry(list: readonly HeldEntry[], entry: HeldEntry): HeldEntry[] {
  const same = (h: HeldEntry) => h.key === entry.key || (entry.entryId !== undefined && h.entryId === entry.entryId);
  return [...list.filter((h) => !same(h)), entry];
}

/**
 * The list after `tried` were sent: `left` weren't (no connection) and stay, `refused` stay with the
 * server's reason, the rest were checked and come off. One held again while they were sent (written
 * again) is a new object with the same key, and stays.
 */
export function afterEntriesSent(
  list: readonly HeldEntry[],
  tried: readonly HeldEntry[],
  left: readonly HeldEntry[],
  refused: readonly { item: HeldEntry; problem: string }[],
): HeldEntry[] {
  return list.flatMap((h): HeldEntry[] => {
    const problem = refused.find((r) => r.item === h)?.problem;
    if (problem !== undefined) return [{ ...h, problem }];
    if (tried.includes(h) && !left.includes(h)) return [];
    return [h];
  });
}

export function parseHeldEntries(raw: unknown): HeldEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((h): h is HeldEntry => typeof h?.key === 'string' && typeof h?.language === 'string' && typeof h?.text === 'string'
    && typeof h?.prompt === 'string' && typeof h?.at === 'number' && (h.entryId === undefined || typeof h.entryId === 'number'));
}

// ==== Drafts ====

/** An entry being written, kept as it's typed so leaving the screen loses nothing. One a language. */
export interface Draft {
  language: Language;
  text: string;
  prompt: string;
  key: string;
  /** The entry it's written again for (Try again, or editing a past entry). */
  entryId?: number;
}

export function parseDrafts(raw: unknown): Draft[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((d): d is Draft => typeof d?.language === 'string' && typeof d?.text === 'string' && typeof d?.prompt === 'string'
    && typeof d?.key === 'string' && (d.entryId === undefined || typeof d.entryId === 'number'));
}

/** The drafts with `language`'s set to `draft`, or taken out with null. */
export function withDraft(list: readonly Draft[], language: Language, draft: Draft | null): Draft[] {
  const rest = list.filter((d) => d.language !== language);
  return draft ? [...rest, draft] : rest;
}
