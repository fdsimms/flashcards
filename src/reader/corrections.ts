// Corrections kept from a rehearsal (Situations, started from a cram): the lines of the owner's that
// needed a fix, kept on the phone when they tap Keep these, so Theme ideas can aim at what they keep
// getting wrong. Pure, so it's tested; kept in the documents folder (correctionsStorage.ts). Nothing here
// grades a card, writes a note or leaves the phone except as a line of what to aim at in a theme request.
import type { Language, SituationFeedback } from './api';

export interface KeptCorrection {
  language: Language;
  /** The owner's line as they said it. */
  said: string;
  /** The same line with only its mistakes fixed. */
  corrected: string;
  note: string;
  /** When it was kept, epoch ms. */
  at: number;
}

/** The most corrections kept, across languages; the oldest go first. */
export const MAX_KEPT = 30;
/** A correction not looked at in this many days is dropped: what was wrong once is no guide for ever. */
export const KEPT_DAYS = 60;
/** The most lines of kept corrections a theme request carries, and the longest one (the server's `MAX_WEAK_CHARS`). */
export const KEPT_LINES_MAX = 4;
export const KEPT_LINE_CHARS = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The lines of a rehearsal with a fix worth keeping: not right, with a correction that differs from what was said. `mine` holds the owner's lines by index. */
export function keepable(feedback: SituationFeedback, mine: ReadonlyMap<number, string>): Pick<KeptCorrection, 'said' | 'corrected' | 'note'>[] {
  const out: Pick<KeptCorrection, 'said' | 'corrected' | 'note'>[] = [];
  for (const l of feedback.lines) {
    const said = (mine.get(l.index) ?? '').replace(/\s+/g, ' ').trim();
    const corrected = l.corrected.replace(/\s+/g, ' ').trim();
    if (l.verdict !== 'right' && said && corrected && corrected !== said) out.push({ said, corrected, note: l.note.trim() });
  }
  return out;
}

/** The list with `items` kept for `language`: newest first, one already kept not kept twice, the old dropped, at most `MAX_KEPT`. */
export function keep(list: readonly KeptCorrection[], language: Language, items: readonly Pick<KeptCorrection, 'said' | 'corrected' | 'note'>[], now: number): KeptCorrection[] {
  const seen = new Set<string>();
  const key = (c: Pick<KeptCorrection, 'language' | 'said' | 'corrected'>) => `${c.language}\n${c.said}\n${c.corrected}`;
  const fresh = items.map((i) => ({ ...i, language, at: now }));
  const out: KeptCorrection[] = [];
  for (const c of [...fresh, ...list]) {
    if (now - c.at >= KEPT_DAYS * DAY_MS || seen.has(key(c))) continue;
    seen.add(key(c));
    out.push(c);
  }
  return out.slice(0, MAX_KEPT);
}

/** What to tell the theme request about `language`'s kept corrections: a line for each of the newest, at most `KEPT_LINES_MAX`. */
export function keptLines(list: readonly KeptCorrection[], language: Language, now: number): string[] {
  return list
    .filter((c) => c.language === language && now - c.at < KEPT_DAYS * DAY_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, KEPT_LINES_MAX)
    .map((c) => `Mistake in a rehearsal: said "${c.said}", corrected to "${c.corrected}"`.slice(0, KEPT_LINE_CHARS));
}

export function parseKept(raw: unknown): KeptCorrection[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is KeptCorrection => typeof c?.language === 'string' && typeof c?.said === 'string' && typeof c?.corrected === 'string'
    && typeof c?.note === 'string' && typeof c?.at === 'number');
}
