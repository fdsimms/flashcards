import type { GrammarAnswer } from '../core/grammarDrills';
import type { GrammarRotation } from './api';
import { LANGUAGES } from './languages';

/**
 * Grammar rotation on the phone's side (docs/read-and-listen/architecture.md, Grammar, "Rotation"):
 * sending the practice answers the server judges a point by, and the shelf's notice when a point
 * has moved on. Pure, so it's tested; useGrammarRotation does the sending and the asking.
 */

/** At most this many answers go in one request; the rest go in the next. */
export const ANSWER_BATCH = 500;

/**
 * The answers still to send: those answered at or after `sentThrough` (every one when nothing has
 * been sent), oldest first, at most `ANSWER_BATCH`. The boundary is sent again rather than risk
 * missing an answer given in the same instant; the server keeps each answer once.
 */
export function answersToSend(all: readonly GrammarAnswer[], sentThrough: string | null): GrammarAnswer[] {
  const sorted = [...all].sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));
  return (sentThrough ? sorted.filter((a) => a.answeredAt >= sentThrough) : sorted).slice(0, ANSWER_BATCH);
}

/** What `sentThrough` becomes once `sent` reached the server: its latest answer's time. */
export function sentThroughAfter(sent: readonly GrammarAnswer[], before: string | null): string | null {
  const last = sent.reduce<string | null>((m, a) => (m === null || a.answeredAt > m ? a.answeredAt : m), null);
  return last ?? before;
}

/** Whether the answers up to `sentThrough` leave nothing new: another batch is needed when not. */
export const allSent = (all: readonly GrammarAnswer[], sentThrough: string | null): boolean =>
  answersToSend(all, sentThrough).every((a) => a.answeredAt === sentThrough);

/** A point's name without its gloss: "จะ" for "จะ (will)", for a button. */
export const shortName = (name: string): string => name.replace(/\s*\(.*\)\s*$/, '') || name;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Practice answers needed before the notice names them, as the server's rotation.DRILL_MIN. */
const DRILLS_NAMED = 5;

export interface RotationCopy {
  title: string;
  body: string;
  /** The button that opens the started point's lesson, or null when none started. */
  open: string | null;
}

/**
 * The notice for a swap (option B of the mock): what is practiced now, and why the last point moved
 * on. Null for a swap whose learned point this app's catalog doesn't name.
 */
export function rotationCopy(r: GrammarRotation): RotationCopy | null {
  if (!r.graduated) return null;
  const why = r.drill_asked >= DRILLS_NAMED
    ? `after ${plural(r.texts, 'text', 'texts')} and ${r.drill_right} of your last ${r.drill_asked} practice questions right.`
    : `after ${plural(r.texts, 'text', 'texts')} over ${plural(r.days, 'day', 'days')}.`;
  const moved = `${r.graduated.name} moved to Know it ${why}`;
  if (!r.started) {
    return {
      title: `${r.graduated.name} is learned`,
      body: `${moved} Every ${LANGUAGES[r.language].name} point in the list is practiced or known.`,
      open: null,
    };
  }
  return { title: `Now practicing ${r.started.name}`, body: moved, open: 'Open lesson' };
}

/** The line that replaces the notice after Undo. */
export const undoneLine = (r: GrammarRotation): string =>
  `Practicing ${shortName(r.graduated?.name ?? '')} again.`;
