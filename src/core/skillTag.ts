import { addCalendarDays, studyDayStart } from './day';
import { GURU_INTERVAL_DAYS } from './progress';
import type { Card, DeckParams, Note } from './types';

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

/** The tag prefix of a drill step's card (`skill::drill::time-hours`), as src/tools/skills.ts writes it. */
export const SKILL_DRILL_TAG = `${SKILL_TAG}::drill::`;

/** A drill card: a skill card whose drill asks fresh questions each time (src/tools/skills.ts), not one fixed fact like a consonant's class. */
export const isDrillNote = (note: Pick<Note, 'tags'>): boolean => isSkillNote(note) && note.tags.some((t) => t.startsWith(SKILL_DRILL_TAG));

/**
 * The longest a drill card is put off, in days. A drill asks a few questions drawn from many (any date,
 * any time), so a Good says less about the whole skill than it does about one word, and the words the
 * drill draws from grow as the deck learns them (a month learned after the dates card went months out
 * would otherwise wait that long to be asked). The same week a skill's words must reach (`isSettled`),
 * and no shorter, or a step would never settle and the next one never open.
 */
export const DRILL_MAX_INTERVAL_DAYS = GURU_INTERVAL_DAYS;

/**
 * The settings a card is answered with: its deck's, with a drill card's maximum interval capped at
 * `DRILL_MAX_INTERVAL_DAYS`. Applied in Franki only, through the preset's own maximum (so fuzz and the
 * load balancer stay inside it, as Anki's do): the Skills subdeck also holds the skill's words, which a
 * preset of its own would cap too. A drill card answered in Anki gets its preset's interval, and the
 * next answer in Franki brings it back under the week.
 */
export function answerParams(params: DeckParams | undefined, note: Pick<Note, 'tags'> | undefined): DeckParams | undefined {
  if (!note || !isDrillNote(note)) return params;
  const base = params ?? { weights: [], desiredRetention: 0.9, maxInterval: DRILL_MAX_INTERVAL_DAYS };
  return base.maxInterval <= DRILL_MAX_INTERVAL_DAYS ? base : { ...base, maxInterval: DRILL_MAX_INTERVAL_DAYS };
}

/**
 * A drill step set aside, kept on its note so sync carries it and the server sees it (server/mcp's
 * skills.py reads the same tags): `stopped` when the learner chose Stop practicing (Skill cards, or the
 * suggestion in Review after a run of clean weeks), `covered` when a later step of its ladder that asks
 * everything it does has settled (`coverable`, src/tools/skills.ts). Either way its card stays suspended:
 * releasing a ladder's next step, resuming a paused deck and holding back for missing words all pass it
 * by, and only Start again takes the tag off.
 */
export const SKILL_STOPPED_TAG = `${SKILL_TAG}::stopped`;
export const SKILL_COVERED_TAG = `${SKILL_TAG}::covered`;

export type SetAside = 'stopped' | 'covered';

/** Why a skill note's step is set aside, or undefined when it isn't. Stopped wins: it's the learner's own choice. */
export function setAsideOf(tags: readonly string[]): SetAside | undefined {
  if (tags.includes(SKILL_STOPPED_TAG)) return 'stopped';
  if (tags.includes(SKILL_COVERED_TAG)) return 'covered';
  return undefined;
}

/**
 * Whether a drill card is due further out than `DRILL_MAX_INTERVAL_DAYS` study days: scheduled before the
 * cap, or answered in Anki, which doesn't know it. Review brings such a card in with Set Due Date when it
 * loads (`useSkillRelease`), so the cap holds for a card already months out and not only from its next answer.
 * Only a review: a card in learning is due within the week anyway, and a new card has no due day.
 */
export function drillDueTooFar(card: Pick<Card, 'sched' | 'suspended' | 'retired'>, now: Date, dayStartsAtHour: number): boolean {
  if (card.sched.state !== 2 || card.suspended || card.retired) return false;
  const last = addCalendarDays(studyDayStart(now, dayStartsAtHour), DRILL_MAX_INTERVAL_DAYS);
  return studyDayStart(new Date(card.sched.due), dayStartsAtHour).getTime() > last.getTime();
}
