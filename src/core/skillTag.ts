import type { Card, Note } from './types';

/** The tag every skill card's note carries (src/tools/skills.ts writes it). */
export const SKILL_TAG = 'skill';

/**
 * Skill cards are practice for a skill, not words, so they sit outside the words' daily limits: they use no
 * new or review room, add nothing to today's studied counts, aren't counted by a progress gate or as
 * unstudied words, and a gate or a full limit never holds one back. The one limit that does hold new
 * skill cards is a count of their own against each deck's daily new limit (`StudiedToday.skillIntroduced`),
 * so a skills subdeck can't offer its parent more new cards than the parent's limit. Every one of those reads this.
 */
export const isSkillNote = (note: Pick<Note, 'tags'>): boolean => note.tags.includes(SKILL_TAG);

/** The ids of the cards whose notes are skill notes, which the queue and the studied counts leave out of the limits. */
export function skillCardIds(notes: Iterable<Pick<Note, 'id' | 'tags'>>, cards: Iterable<Pick<Card, 'id' | 'noteId'>>): Set<string> {
  const skillNotes = new Set([...notes].filter(isSkillNote).map((n) => n.id));
  return new Set([...cards].filter((c) => skillNotes.has(c.noteId)).map((c) => c.id));
}
