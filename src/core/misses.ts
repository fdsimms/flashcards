import { isOmnilanguage, speechLangFor } from './cards';
import type { Note } from './types';

/**
 * What was wrong when a card was answered Again, and the reminder it brings back: "Last time: tone
 * was wrong". The reason is chosen from Again's menu in Review, is kept on that answer's review row
 * (`ReviewLogEntry.miss`), and never changes the rating or the schedule. Franki's own: it isn't
 * written into the Anki collection.
 *
 * Pure: the screen gathers the inputs. Which reminder a card shows is read from its answers each
 * time, never stored, so undoing an answer takes its reason back with it.
 */

export interface MissReason {
  /** Kept on the review row. Never renamed: old rows carry it. */
  key: string;
  /** The menu item and, lowercased, the reminder. */
  label: string;
}

const MEANING: MissReason = { key: 'meaning', label: 'Meaning' };

const THAI: MissReason[] = [
  { key: 'tone', label: 'Tone' },
  { key: 'vowel-length', label: 'Vowel length' },
  { key: 'spelling', label: 'Spelling' },
  MEANING,
];

const GENDERED: MissReason[] = [
  { key: 'gender', label: 'Gender' },
  { key: 'stress', label: 'Stress' },
  { key: 'ending', label: 'Ending' },
  MEANING,
];

// Languages where stress isn't the usual slip: gender, the written form (Spanish accents, French and
// Norwegian spelling), and the ending a verb or noun takes.
const WRITTEN: MissReason[] = [
  { key: 'gender', label: 'Gender' },
  { key: 'spelling', label: 'Spelling' },
  { key: 'ending', label: 'Ending' },
  MEANING,
];

const JAPANESE: MissReason[] = [
  { key: 'reading', label: 'Reading' },
  { key: 'pitch', label: 'Pitch accent' },
  MEANING,
];

/**
 * The reasons offered, by the language's code. A fixed list for now; a language with none gets a
 * plain Again button. Add a language here, not in a screen.
 */
const REASONS_BY_LANGUAGE: Record<string, MissReason[]> = {
  th: THAI,
  de: GENDERED,
  pl: GENDERED,
  ru: GENDERED,
  el: GENDERED,
  es: WRITTEN,
  fr: WRITTEN,
  nb: WRITTEN,
  ja: JAPANESE,
};

/** The reasons Again's menu offers for this note: only Omnilanguage notes in a language listed above. */
export function missReasonsFor(note: Note): MissReason[] {
  if (!isOmnilanguage(note)) return [];
  const code = speechLangFor(note)?.split('-')[0];
  return (code && REASONS_BY_LANGUAGE[code]) || [];
}

/** How many answers in a row without a reason it takes for its reminder to go. */
export const MISS_CLEAR_AFTER = 2;

/** A card's answers, oldest first: the reason chosen with each, if any. */
export type MissAnswers = (string | undefined)[];

/**
 * The reasons still to remind about, the most recently missed first: a reason stays until
 * `MISS_CLEAR_AFTER` answers have come after the last time it was chosen, and choosing it again
 * starts the count over.
 */
export function activeMisses(answers: MissAnswers): string[] {
  const last = new Map<string, number>();
  answers.forEach((miss, i) => { if (miss) last.set(miss, i); });
  return [...last]
    .filter(([, i]) => answers.length - 1 - i < MISS_CLEAR_AFTER)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
}

/**
 * The reminder under a card's front, or null when there is nothing to say. A reason the note's
 * language no longer offers is left out rather than shown with no name.
 */
export function missReminder(answers: MissAnswers, offered: MissReason[]): string | null {
  const names = activeMisses(answers)
    .map((key) => offered.find((r) => r.key === key)?.label.toLowerCase())
    .filter((name): name is string => !!name);
  if (!names.length) return null;
  // One reason per answer and a window of `MISS_CLEAR_AFTER` answers: never more than two at once.
  return `Last time: ${names.join(' and ')} ${names.length === 1 ? 'was' : 'were'} wrong`;
}

/** Every card's answers, as the screen keeps them while it's open. */
export type MissLog = Map<string, MissAnswers>;

/** The log with one more answer on the card (`miss` undefined for one without a reason). */
export function withAnswer(log: MissLog, cardId: string, miss: string | undefined): MissLog {
  const out = new Map(log);
  out.set(cardId, [...(log.get(cardId) ?? []), miss]);
  return out;
}

/** The log with the card's latest answer taken back, as an undo does. */
export function withoutLastAnswer(log: MissLog, cardId: string): MissLog {
  const answers = log.get(cardId);
  if (!answers?.length) return log;
  const out = new Map(log);
  out.set(cardId, answers.slice(0, -1));
  return out;
}
