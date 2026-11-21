import { isOmnilanguage } from './cards';
import { isInProgress } from './progress';
import type { Card, Note } from './types';

/**
 * A word's meaning-to-word card waits until the word is recognized, and so does its listening card.
 * Producing a word, or knowing it by ear, is harder than recognizing it written and builds on that,
 * so a new reverse or audio card met the same week as its forward card is mostly failed, and they
 * interfere. A reverse or audio card that is still new is left out of the queue
 * while the note's forward card is unstudied or in progress (`isInProgress`: not yet a review
 * scheduled a week or more out, the progress gate's own measure), and comes in once it has settled.
 *
 * Like the lookalike hold (lookalikes.ts) it only leaves cards out of the queue, through
 * `queueInput`'s `held`, for the deck list and Review alike: nothing is written, nothing is
 * rescheduled, and Anki on another device still offers the card. A note with no forward card to
 * wait for (SuppressFrontCard, a WaniKani production note), or whose forward card is suspended, is
 * never held. A card already started keeps its schedule.
 */
export function heldReverseCards(cards: readonly Card[], notes: Iterable<Note>): Set<string> {
  const omni = new Set<string>();
  for (const n of notes) if (isOmnilanguage(n)) omni.add(n.id);
  const waiting = new Set<string>();
  for (const c of cards) {
    if (c.kind !== 'forward' || !omni.has(c.noteId) || c.suspended || c.retired) continue;
    if (c.sched.state === 0 || isInProgress(c)) waiting.add(c.noteId);
  }
  const held = new Set<string>();
  for (const c of cards) {
    if ((c.kind === 'reverse' || c.kind === 'audio') && c.sched.state === 0 && waiting.has(c.noteId)) held.add(c.id);
  }
  return held;
}
