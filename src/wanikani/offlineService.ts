import type { WaniKaniApi, WaniKaniUser } from './api';
import { inlineImages, OFFLINE_LESSONS, type Snapshot } from './offline';
import { sessionItems } from './session';
import { withComponents } from './subjects';

/**
 * Making the offline copy (offline.ts): the reviews and lessons that are up, their subjects, the
 * radicals and kanji those are made of, and synonyms, read from WaniKani. Pure over the API it's given, so tests can fake one.
 */

export interface SnapshotDeps {
  api: Pick<WaniKaniApi, 'reviewsAvailable' | 'lessonsAvailable' | 'subjects' | 'synonyms' | 'download'>;
}

export async function makeSnapshot(
  deps: SnapshotDeps,
  opts: { user: WaniKaniUser; apprentice: number; started: number; previous: Snapshot | null; now: Date },
): Promise<Snapshot> {
  const [reviews, allLessons] = await Promise.all([deps.api.reviewsAvailable(opts.user.maxLevel), deps.api.lessonsAvailable(opts.user.maxLevel)]);
  const ids = [...new Set([...reviews, ...allLessons].map((a) => a.subjectId))];
  const read = await deps.api.subjects(ids);
  const bySubject = new Map(read.map((s) => [s.id, s]));
  // Only the lessons a day could offer, in the order they're offered (a long queue would make the copy large).
  const first = new Set(sessionItems([], allLessons, bySubject, OFFLINE_LESSONS).map((i) => i.assignmentId));
  const lessons = allLessons.filter((a) => first.has(a.id));
  const used = new Set([...reviews, ...lessons].map((a) => a.subjectId));
  // The parts go in too, so an offline card shows its "Made of" row, a radical's picture included.
  const withParts = await withComponents(read.filter((s) => used.has(s.id)), deps.api.subjects);
  const subjects = await inlineImages(withParts, opts.previous?.subjects ?? [], deps.api.download);
  // Typing counts the user's own synonyms as right; without them only WaniKani's do, which is still usable.
  const synonyms = await deps.api.synonyms([...used]).catch(() => new Map<number, string[]>());
  return {
    version: 1,
    savedAt: opts.now.toISOString(),
    user: opts.user,
    apprentice: opts.apprentice,
    started: opts.started,
    reviews,
    lessons,
    subjects,
    synonyms: [...synonyms],
  };
}
