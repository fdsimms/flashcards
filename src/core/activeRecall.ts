import { isOmnilanguage } from './cards';
import { headword } from './forms';
import { htmlToText } from './html';
import type { Card, Note } from './types';

/**
 * Two small asks in Review that make a card's learner produce something rather than only
 * recognize it. Neither touches scheduling: the learner still rates the card, and the rating is
 * all FSRS sees.
 *
 * - **Type it**: on a reverse card (the meaning shown, the word asked), the word can be typed before
 *   the answer is shown, and the back then shows what was typed against it (typedCompare.ts).
 * - **Your own hook**: the first time a new word's answer is shown, a field to write a mnemonic of
 *   one's own, saved to the note's Mnemonic as the leech hint is (`withMnemonic`). Making the link
 *   oneself is what makes it stick; the leech hint asks only once a word has been missed again and again.
 */

/** What Type it compares against on this card: the word, for an Omnilanguage reverse card; else none. */
export function typeItAnswer(note: Note, card: Card): string | undefined {
  if (!isOmnilanguage(note) || card.kind !== 'reverse') return undefined;
  return headword(note) || undefined;
}

/**
 * Whether the answer side asks for the learner's own hook: an Omnilanguage note seen for the first
 * time (this card and every other card of the note still new), with nothing in Mnemonic yet. Once
 * a card of the note has been answered, it isn't asked again, written or not.
 */
export function asksOwnHook(note: Note, card: Card, noteCards: readonly Card[]): boolean {
  if (!isOmnilanguage(note) || htmlToText(note.fields.Mnemonic ?? '').trim()) return false;
  return [card, ...noteCards].every((c) => c.sched.state === 0 && !c.sched.reps);
}
