import type { Card, Note } from './types';

/** The tag every skill card's note carries (src/tools/skills.ts writes it). */
export const SKILL_TAG = 'skill';

/**
 * Skill cards are practice for a skill, not words, so their reviews sit outside the daily limits: a review
 * uses no room and adds nothing to today's studied counts, and a progress gate doesn't count them as in
 * progress or as unstudied words. A new skill card is the exception: it shares the deck's new-card limit
 * and counts as introduced, so a skills subdeck can't offer its parent more new cards than that limit.
 * Every one of those reads this.
 */
export const isSkillNote = (note: Pick<Note, 'tags'>): boolean => note.tags.includes(SKILL_TAG);

/** The ids of the cards whose notes are skill notes, which the queue and the studied counts leave out of the limits. */
export function skillCardIds(notes: Iterable<Pick<Note, 'id' | 'tags'>>, cards: Iterable<Pick<Card, 'id' | 'noteId'>>): Set<string> {
  const skillNotes = new Set([...notes].filter(isSkillNote).map((n) => n.id));
  return new Set([...cards].filter((c) => skillNotes.has(c.noteId)).map((c) => c.id));
}
