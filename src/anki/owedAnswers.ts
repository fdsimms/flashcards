import type { RatingValue } from '../core/scheduler';
import type { Card } from '../core/types';

/**
 * Answers owed to the kept Anki collection: given in Review and saved in Franki's own tables, but
 * not yet written into the collection. That write waits its turn for the collection (`lockAnki`),
 * which a sync holds while it talks to the server, so on a stalled connection it can wait a long
 * time. Each one is kept in the `anki_owed` table until it's written, and whatever is still there
 * at the next launch is written then (src/anki/owedService.ts): an app closed while a sync was
 * stuck no longer loses the answers given meanwhile to the next sync's refresh.
 *
 * This file is how one is kept as text. Pure, so it's tested.
 */

/** What `writeAnkiAnswer` takes (src/db/ankiLink.ts). */
export interface AnkiAnswer {
  before: Card; after: Card; rating: RatingValue; now: Date; takenMs: number; desiredRetention?: number;
  /** The card's deck's step counts, for Anki's `left`. */
  steps?: { learn: number; relearn: number };
  /** The card's deck's FSRS weights (none for Anki's defaults), for Anki's `decay`. */
  weights?: number[];
  /**
   * Answered in a filtered deck that doesn't reschedule: the card is shown again at `again`
   * (`previewAgain`), or, finished, goes home unchanged (`previewReturn`).
   */
  preview?: { again?: Date };
  /** Siblings to bury with the answer (`siblingsToBury`), in the same transaction. */
  bury?: Card[];
}

export interface OwedAnswer {
  answer: AnkiAnswer;
  /** The siblings as Franki saved them, buried: saved again with the card once the collection has the answer. */
  buried: Card[];
}

export function encodeOwed(owed: OwedAnswer): string {
  const { now, preview, ...rest } = owed.answer;
  return JSON.stringify({
    answer: { ...rest, now: now.toISOString(), ...(preview ? { preview: preview.again ? { again: preview.again.toISOString() } : {} } : {}) },
    buried: owed.buried,
  });
}

const isCard = (c: unknown): c is Card => !!c && typeof (c as Card).id === 'string' && typeof (c as Card).noteId === 'string' && !!(c as Card).sched;
const dateOf = (text: unknown): Date | null => {
  const d = typeof text === 'string' ? new Date(text) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/** The answer back from its text, or null for anything that isn't one (it's dropped, not guessed at). */
export function decodeOwed(text: string): OwedAnswer | null {
  let raw: any;
  try { raw = JSON.parse(text); } catch { return null; }
  const a = raw?.answer;
  const now = dateOf(a?.now);
  if (!a || !now || !isCard(a.before) || !isCard(a.after) || ![1, 2, 3, 4].includes(a.rating) || typeof a.takenMs !== 'number') return null;
  if (!Array.isArray(raw.buried) || !raw.buried.every(isCard) || (a.bury !== undefined && !(Array.isArray(a.bury) && a.bury.every(isCard)))) return null;
  let preview: AnkiAnswer['preview'];
  if (a.preview) {
    const again = a.preview.again === undefined ? undefined : dateOf(a.preview.again);
    if (again === null) return null;
    preview = again ? { again } : {};
  }
  const { preview: _p, now: _n, ...rest } = a;
  return { answer: { ...rest, now, ...(preview ? { preview } : {}) }, buried: raw.buried };
}
