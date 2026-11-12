import { parseAssignment, parseSubject, type Assignment, type Subject } from './subjects';
import { parseSrsSystem, type SrsSystem } from './srs';
import type { Outcome } from './session';

/**
 * The user's own WaniKani account, over WaniKani's API (revision 20170710), with the token they
 * made on wanikani.com. Reads need any token; sending answers needs one with "reviews:create" and
 * "assignments:start" checked. Nothing from Franki goes with the requests but the answers.
 *
 * Request shapes were checked against @bachmacintosh/wanikani-api-types 1.8.0, not the live API
 * (its docs weren't reachable when this was written).
 */

export const API_BASE = 'https://api.wanikani.com/v2';
const API_REVISION = '20170710';
const REQUEST_TIMEOUT_MS = 15_000;
/** Subject ids per request: well under any URL length limit. */
const IDS_PER_REQUEST = 200;
/** A collection is read at most this many pages, so a runaway `next_url` can't loop forever. */
const MAX_PAGES = 40;

/** Why a request failed, in terms a screen can say something about. */
export type WaniKaniProblem =
  /** The token is wrong or was revoked. */
  | 'unauthorized'
  /** The token can read but isn't allowed to send answers or start lessons. */
  | 'forbidden'
  | 'rateLimited'
  /** WaniKani refused this answer (the item isn't up for review any more, say). Sending it again won't help. */
  | 'rejected'
  /** No answer, or a server error: worth trying again later. */
  | 'unavailable';

export class WaniKaniError extends Error {
  constructor(readonly problem: WaniKaniProblem, readonly status?: number) {
    super(problem);
  }
}

export function problemForStatus(status: number): WaniKaniProblem {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rateLimited';
  if (status === 404 || status === 409 || status === 422) return 'rejected';
  return 'unavailable';
}

/** What a problem means to the person, and what to do. */
export function problemText(problem: WaniKaniProblem): string {
  switch (problem) {
    case 'unauthorized': return "WaniKani didn't accept the token. Make a new one on wanikani.com and enter it in WaniKani's settings.";
    case 'forbidden': return 'This token can only read. Make one on wanikani.com with "reviews:create" and "assignments:start" checked, and enter it in WaniKani\'s settings.';
    case 'rateLimited': return 'WaniKani asked Franki to slow down. Try again in a minute.';
    case 'rejected': return "WaniKani didn't take this answer: the item may have been reviewed somewhere else.";
    case 'unavailable': return "Couldn't reach WaniKani. Check the connection and try again.";
  }
}

export interface WaniKaniUser {
  username: string;
  level: number;
  /** Levels the subscription opens: 3 on a free account. Items above it must not be studied. */
  maxLevel: number;
  onVacation: boolean;
}

export function parseUser(body: unknown): WaniKaniUser | null {
  const d = (body as { data?: Record<string, unknown> })?.data;
  if (!d || typeof d.username !== 'string' || typeof d.level !== 'number') return null;
  const sub = d.subscription as { max_level_granted?: unknown } | undefined;
  return {
    username: d.username,
    level: d.level,
    maxLevel: typeof sub?.max_level_granted === 'number' ? sub.max_level_granted : 60,
    onVacation: typeof d.current_vacation_started_at === 'string',
  };
}

/** How many assignments on a page were started (a lesson done) at or after `sinceMs`. */
export function startedSince(assignments: Assignment[], sinceMs: number): number {
  return assignments.filter((a) => a.startedAt && Date.parse(a.startedAt) >= sinceMs).length;
}

/** The request body for an outcome: a review with its wrong counts, or a lesson's start. */
export function outcomeRequest(o: Outcome): { method: 'POST' | 'PUT'; path: string; body: unknown } {
  if (o.kind === 'start') {
    return { method: 'PUT', path: `/assignments/${o.assignmentId}/start`, body: { assignment: { started_at: o.at } } };
  }
  return {
    method: 'POST', path: '/reviews',
    body: { review: { assignment_id: o.assignmentId, incorrect_meaning_answers: o.wrongMeaning, incorrect_reading_answers: o.wrongReading, created_at: o.at } },
  };
}

/** Filters WaniKani takes as a bare key ("?immediately_available_for_review"), not key=true. */
const BARE_FILTERS = new Set(['immediately_available_for_lessons', 'immediately_available_for_review', 'in_review']);

export function query(params: Record<string, string | number | boolean | number[] | string[] | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (BARE_FILTERS.has(k)) {
      if (v === true) parts.push(k);
      continue;
    }
    parts.push(`${k}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface WaniKaniApi {
  user(): Promise<WaniKaniUser>;
  /** How many reviews and lessons are up now, without reading the items. */
  counts(maxLevel: number): Promise<{ reviews: number; lessons: number }>;
  /** Lessons done since `since` (the study day's start), here or anywhere else. */
  lessonsStartedSince(since: Date): Promise<number>;
  reviewsAvailable(maxLevel: number): Promise<Assignment[]>;
  lessonsAvailable(maxLevel: number): Promise<Assignment[]>;
  /** Vocabulary at Guru or above: what gets a production card. */
  passedVocabulary(maxLevel: number): Promise<Assignment[]>;
  subjects(ids: number[]): Promise<Subject[]>;
  srsSystems(): Promise<SrsSystem[]>;
  /** The user's own synonyms for each subject (study materials), by subject id. */
  synonyms(subjectIds: number[]): Promise<Map<number, string[]>>;
  /** Sends a finished review or a lesson's start. */
  send(outcome: Outcome): Promise<void>;
  /** A pronunciation recording, for a production note's Audio field. */
  download(url: string): Promise<Uint8Array>;
}

export function createWaniKaniApi(token: string, fetchFn: Fetch = fetch): WaniKaniApi {
  async function request(url: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Wanikani-Revision': API_REVISION,
          Accept: 'application/json',
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: controller.signal,
      });
    } catch {
      throw new WaniKaniError('unavailable');
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new WaniKaniError(problemForStatus(response.status), response.status);
    try {
      return await response.json();
    } catch {
      throw new WaniKaniError('unavailable');
    }
  }

  /** Every page of a collection. */
  async function collection(path: string): Promise<unknown[]> {
    let url: string | null = `${API_BASE}${path}`;
    const out: unknown[] = [];
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const body = await request(url) as { data?: unknown; pages?: { next_url?: unknown } };
      if (!Array.isArray(body?.data)) throw new WaniKaniError('unavailable');
      out.push(...body.data);
      const next = body.pages?.next_url;
      url = typeof next === 'string' && next.startsWith(API_BASE) ? next : null;
    }
    return out;
  }

  async function total(path: string): Promise<number> {
    const body = await request(`${API_BASE}${path}`) as { total_count?: unknown };
    if (typeof body?.total_count !== 'number') throw new WaniKaniError('unavailable');
    return body.total_count;
  }

  const levels = (maxLevel: number) => (maxLevel < 60 ? Array.from({ length: maxLevel }, (_, i) => i + 1) : undefined);
  const assignments = async (params: Parameters<typeof query>[0]) => (await collection(`/assignments${query(params)}`))
    .map(parseAssignment).filter((a): a is Assignment => !!a && !a.hidden);

  return {
    async user() {
      const user = parseUser(await request(`${API_BASE}/user`));
      if (!user) throw new WaniKaniError('unavailable');
      return user;
    },
    async counts(maxLevel) {
      const [reviews, lessons] = await Promise.all([
        total(`/assignments${query({ immediately_available_for_review: true, hidden: false, levels: levels(maxLevel) })}`),
        total(`/assignments${query({ immediately_available_for_lessons: true, hidden: false, levels: levels(maxLevel) })}`),
      ]);
      return { reviews, lessons };
    },
    async lessonsStartedSince(since) {
      // Assignments changed since the day began (reviews change them too), counted by when each was started.
      return startedSince(await assignments({ started: true, updated_after: since.toISOString() }), since.getTime());
    },
    reviewsAvailable: (maxLevel) => assignments({ immediately_available_for_review: true, hidden: false, levels: levels(maxLevel) }),
    lessonsAvailable: (maxLevel) => assignments({ immediately_available_for_lessons: true, hidden: false, levels: levels(maxLevel) }),
    // Not filtered by subject_types: the types it documents predate kana_vocabulary, and an unknown
    // value could fail the whole request. Radicals and kanji are dropped here instead.
    passedVocabulary: async (maxLevel) => (await assignments({ srs_stages: [5, 6, 7, 8, 9], hidden: false, levels: levels(maxLevel) }))
      .filter((a) => a.subjectType === 'vocabulary' || a.subjectType === 'kana_vocabulary'),
    async subjects(ids) {
      const out: Subject[] = [];
      for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
        const page = await collection(`/subjects${query({ ids: ids.slice(i, i + IDS_PER_REQUEST) })}`);
        out.push(...page.map(parseSubject).filter((s): s is Subject => !!s));
      }
      return out;
    },
    async srsSystems() {
      return (await collection('/spaced_repetition_systems')).map(parseSrsSystem).filter((s): s is SrsSystem => !!s);
    },
    async synonyms(subjectIds) {
      const out = new Map<number, string[]>();
      for (let i = 0; i < subjectIds.length; i += IDS_PER_REQUEST) {
        for (const r of await collection(`/study_materials${query({ subject_ids: subjectIds.slice(i, i + IDS_PER_REQUEST) })}`)) {
          const d = (r as { data?: { subject_id?: unknown; meaning_synonyms?: unknown } })?.data;
          if (typeof d?.subject_id === 'number' && Array.isArray(d.meaning_synonyms)) {
            out.set(d.subject_id, d.meaning_synonyms.filter((x): x is string => typeof x === 'string'));
          }
        }
      }
      return out;
    },
    async send(outcome) {
      const r = outcomeRequest(outcome);
      await request(`${API_BASE}${r.path}`, { method: r.method, body: r.body });
    },
    async download(url) {
      let response: Response;
      try {
        response = await fetchFn(url);
      } catch {
        throw new WaniKaniError('unavailable');
      }
      if (!response.ok) throw new WaniKaniError('unavailable', response.status);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
