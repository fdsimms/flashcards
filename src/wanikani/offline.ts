import { studyDayStart } from '../core/day';
import type { WaniKaniUser } from './api';
import type { Outcome } from './session';
import type { Assignment, Subject } from './subjects';

/**
 * The offline copy: what a WaniKani session needs (the reviews and lessons that were up, their
 * subjects and the user's synonyms), saved whenever WaniKani is reached, so a session can be
 * studied with no connection. Answers given from it go to the outbox like any other and are sent
 * when WaniKani can be reached again (useWaniKani).
 *
 * Only what was up when the copy was made can be studied: a review that comes due afterwards
 * isn't in it. Pronunciation recordings are kept as files (audioCache.ts); radical pictures are
 * inlined here as data URIs, so the card shows them as it does online.
 */

/** Lessons kept in the copy: the most a day's limit can ask for (NEW_PER_DAY_CHOICES). */
export const OFFLINE_LESSONS = 50;

export interface Snapshot {
  version: 1;
  savedAt: string;
  user: WaniKaniUser;
  /** Items at Apprentice when it was made, for the lesson limit. */
  apprentice: number;
  /** Lessons done that study day, here or on WaniKani, when it was made. */
  started: number;
  reviews: Assignment[];
  lessons: Assignment[];
  subjects: Subject[];
  synonyms: [number, string[]][];
}

export function parseSnapshot(raw: string | null | undefined): Snapshot | null {
  try {
    const o = raw ? JSON.parse(raw) : null;
    if (o?.version !== 1 || typeof o.savedAt !== 'string' || typeof o.user?.username !== 'string') return null;
    if (![o.reviews, o.lessons, o.subjects, o.synonyms].every(Array.isArray)) return null;
    if (typeof o.apprentice !== 'number' || typeof o.started !== 'number') return null;
    return o as Snapshot;
  } catch {
    return null;
  }
}

/** What a session is built from: the same pieces the live API gives, minus what has been answered since. */
export interface OfflineData {
  user: WaniKaniUser;
  savedAt: Date;
  apprentice: number;
  /** Lessons done that study day, counting those started offline. */
  started: number;
  reviews: Assignment[];
  lessons: Assignment[];
  subjects: Map<number, Subject>;
  synonyms: Map<number, string[]>;
}

/**
 * The copy as it stands now. `answered` is every outcome the copy doesn't know about: those still
 * waiting to be sent, and those sent since it was made. Their items are left out so they aren't
 * asked twice, and a lesson started offline counts against today's limit.
 */
export function offlineData(s: Snapshot, answered: readonly Outcome[], now: Date, dayStartsAtHour: number): OfflineData {
  const done = new Set(answered.map((o) => o.assignmentId));
  const dayStart = studyDayStart(now, dayStartsAtHour).getTime();
  // The copy's own count is only today's if it was made today.
  const sameDay = studyDayStart(new Date(s.savedAt), dayStartsAtHour).getTime() === dayStart;
  const startedHere = answered.filter((o) => o.kind === 'start' && Date.parse(o.at) >= dayStart).length;
  return {
    user: s.user,
    savedAt: new Date(s.savedAt),
    apprentice: s.apprentice,
    started: (sameDay ? s.started : 0) + startedHere,
    reviews: s.reviews.filter((a) => !done.has(a.id)),
    lessons: s.lessons.filter((a) => !done.has(a.id)),
    subjects: new Map(s.subjects.map((x) => [x.id, x])),
    synonyms: new Map(s.synonyms),
  };
}

/** The recordings the copy's reviews and lessons play (see `audioFor`), by file name, with where to get each. */
export function wantedAudio(s: Snapshot, audioOf: (subject: Subject) => { name: string; url: string } | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const subject of s.subjects) {
    const a = audioOf(subject);
    if (a) out.set(a.name, a.url);
  }
  return out;
}

/** A picture as a data URI, so a card can show it with no request. */
export function dataUri(bytes: Uint8Array, mime: string): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * Subjects with their radical pictures inlined. A picture already inlined in `previous` is reused
 * rather than downloaded again; one that can't be downloaded keeps its web address, which works
 * online and is retried at the next copy.
 */
export async function inlineImages(
  subjects: Subject[],
  previous: readonly Subject[],
  download: (url: string) => Promise<Uint8Array>,
): Promise<Subject[]> {
  const before = new Map(previous.map((s) => [s.id, s]));
  return Promise.all(subjects.map(async (s) => {
    if (!s.image || s.image.url.startsWith('data:')) return s;
    const kept = before.get(s.id)?.image;
    if (kept?.url.startsWith('data:')) return { ...s, image: kept };
    try {
      const bytes = await download(s.image.url);
      return { ...s, image: { ...s.image, url: dataUri(bytes, s.image.svg ? 'image/svg+xml' : 'image/png') } };
    } catch {
      return s;
    }
  }));
}
