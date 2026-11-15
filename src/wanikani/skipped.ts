import type { Assignment, Subject } from './subjects';

/**
 * Words skipped for good: left out of every review on this phone. WaniKani has no way to hide an
 * item, so it still schedules and lists them on wanikani.com; nothing is sent for them from here.
 * Kept in the state file (prefs.ts, `WaniKaniState`), not the options, since the list can grow.
 */
export interface SkippedWord {
  subjectId: number;
  /** The review's assignment, to take the word out of the counts (which are of assignments). */
  assignmentId: number;
  /** What the options list shows: the word and its first meaning. */
  characters: string;
  meaning: string;
}

/** The skipped list with `subject` (the review `assignmentId` is for) added; one already on it isn't added twice. */
export function skipWord(skipped: readonly SkippedWord[], subject: Subject, assignmentId: number): SkippedWord[] {
  if (skipped.some((w) => w.subjectId === subject.id)) return [...skipped];
  const meaning = (subject.meanings.find((m) => m.primary) ?? subject.meanings[0])?.meaning ?? '';
  return [...skipped, { subjectId: subject.id, assignmentId, characters: subject.characters ?? '', meaning }];
}

export function unskipWord(skipped: readonly SkippedWord[], subjectId: number): SkippedWord[] {
  return skipped.filter((w) => w.subjectId !== subjectId);
}

/** Only vocabulary can be skipped: radicals and kanji unlock the levels, which skipping would hold up. */
export function canSkip(subject: Pick<Subject, 'type'> | undefined): boolean {
  return subject?.type === 'vocabulary' || subject?.type === 'kana_vocabulary';
}

/** The assignments without those of skipped words. */
export function withoutSkipped(assignments: Assignment[], skipped: readonly SkippedWord[]): Assignment[] {
  if (!skipped.length) return assignments;
  const ids = new Set(skipped.map((w) => w.subjectId));
  return assignments.filter((a) => !ids.has(a.subjectId));
}

export function parseSkipped(raw: unknown): SkippedWord[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((w): w is SkippedWord => !!w && typeof w.subjectId === 'number' && typeof w.assignmentId === 'number'
    && typeof w.characters === 'string' && typeof w.meaning === 'string');
}
