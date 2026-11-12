import { describe, expect, it } from 'vitest';
import { createWaniKaniApi, outcomeRequest, parseUser, problemForStatus, query, startedSince, WaniKaniError } from '../../src/wanikani/api';
import { parseAssignment } from '../../src/wanikani/subjects';
import { assignmentResource, kanjiResource, vocabResource } from './fixtures';

type Call = { url: string; init?: RequestInit };

function fakeFetch(routes: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const { status = 200, body } = routes(url, init);
    return { ok: status < 400, status, json: async () => body, arrayBuffer: async () => new Uint8Array([1, 2]).buffer } as Response;
  };
  return { fn, calls };
}

describe('requests', () => {
  it('sends the token and the API revision', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { username: 'me', level: 14, subscription: { max_level_granted: 60 }, current_vacation_started_at: null, preferences: { lessons_batch_size: 7 } } } }));
    expect(await createWaniKaniApi('tok', fn).user()).toEqual({ username: 'me', level: 14, maxLevel: 60, onVacation: false, lessonBatch: 7 });
    expect(calls[0].url).toBe('https://api.wanikani.com/v2/user');
    expect(calls[0].init?.headers).toMatchObject({ Authorization: 'Bearer tok', 'Wanikani-Revision': '20170710' });
  });

  it('writes the bare availability filters and comma-separated lists', () => {
    expect(query({ immediately_available_for_review: true, hidden: false, levels: [1, 2, 3] }))
      .toBe('?immediately_available_for_review&hidden=false&levels=1%2C2%2C3');
    expect(query({ immediately_available_for_lessons: false, levels: undefined })).toBe('');
  });

  it('reads every page of a collection, and only pages on WaniKani', async () => {
    const page2 = 'https://api.wanikani.com/v2/assignments?page_after_id=1';
    const { fn, calls } = fakeFetch((url) => (url === page2
      ? { body: { data: [assignmentResource(2, 20)], pages: { next_url: 'https://evil.example/next' } } }
      : { body: { data: [assignmentResource(1, 10), assignmentResource(9, 90, { hidden: true })], pages: { next_url: page2 } } }));
    const got = await createWaniKaniApi('t', fn).reviewsAvailable(60);
    expect(got.map((a) => a.id)).toEqual([1, 2]);
    expect(calls).toHaveLength(2);
  });

  it('keeps a free account to the levels it opens', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { total_count: 4, data: [] } }));
    expect(await createWaniKaniApi('t', fn).counts(3)).toEqual({ reviews: 4, lessons: 4 });
    expect(calls.every((c) => c.url.includes('levels=1%2C2%2C3'))).toBe(true);
  });

  it('keeps only vocabulary for production cards', async () => {
    const { fn } = fakeFetch(() => ({ body: { data: [
      assignmentResource(1, 10, { srs_stage: 5 }),
      assignmentResource(2, 20, { srs_stage: 5, subject_type: 'kanji' }),
      assignmentResource(3, 30, { srs_stage: 6, subject_type: 'kana_vocabulary' }),
    ], pages: { next_url: null } } }));
    expect((await createWaniKaniApi('t', fn).passedVocabulary(60)).map((a) => a.id)).toEqual([1, 3]);
  });

  it('reads subjects and synonyms by id', async () => {
    const { fn, calls } = fakeFetch((url) => (url.includes('/subjects')
      ? { body: { data: [vocabResource, kanjiResource], pages: { next_url: null } } }
      : { body: { data: [{ data: { subject_id: 2467, meaning_synonyms: ['big kid'] } }], pages: { next_url: null } } }));
    const api = createWaniKaniApi('t', fn);
    expect((await api.subjects([2467, 450])).map((s) => s.id)).toEqual([2467, 450]);
    expect(calls[0].url).toBe('https://api.wanikani.com/v2/subjects?ids=2467%2C450');
    expect(await api.synonyms([2467])).toEqual(new Map([[2467, ['big kid']]]));
  });

  it('turns a failed status into a problem', async () => {
    const { fn } = fakeFetch(() => ({ status: 401, body: { error: 'Unauthorized', code: 401 } }));
    await expect(createWaniKaniApi('t', fn).user()).rejects.toEqual(new WaniKaniError('unauthorized', 401));
    const offline = async () => { throw new TypeError('Network request failed'); };
    await expect(createWaniKaniApi('t', offline).user()).rejects.toMatchObject({ problem: 'unavailable' });
    expect(problemForStatus(403)).toBe('forbidden');
    expect(problemForStatus(422)).toBe('rejected');
    expect(problemForStatus(429)).toBe('rateLimited');
    expect(problemForStatus(503)).toBe('unavailable');
  });
});

describe('sending answers', () => {
  it('posts a review with its wrong counts and when it was answered', async () => {
    const outcome = { kind: 'review' as const, assignmentId: 7, subjectId: 70, srsStage: 3, wrongMeaning: 1, wrongReading: 2, at: '2026-11-12T12:00:00.000Z' };
    expect(outcomeRequest(outcome)).toEqual({
      method: 'POST', path: '/reviews',
      body: { review: { assignment_id: 7, incorrect_meaning_answers: 1, incorrect_reading_answers: 2, created_at: '2026-11-12T12:00:00.000Z' } },
    });
    const { fn, calls } = fakeFetch(() => ({ body: {} }));
    await createWaniKaniApi('t', fn).send(outcome);
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(outcomeRequest(outcome).body);
  });

  it("starts a lesson's assignment", () => {
    expect(outcomeRequest({ kind: 'start', assignmentId: 8, subjectId: 80, at: '2026-11-12T12:00:00.000Z' })).toEqual({
      method: 'PUT', path: '/assignments/8/start', body: { assignment: { started_at: '2026-11-12T12:00:00.000Z' } },
    });
  });
});

describe('reading the account', () => {
  it("says a free account's level cap", () => {
    expect(parseUser({ data: { username: 'x', level: 2, subscription: { max_level_granted: 3 }, current_vacation_started_at: '2026-11-01T00:00:00Z' } }))
      .toEqual({ username: 'x', level: 2, maxLevel: 3, onVacation: true, lessonBatch: 5 });
    expect(parseUser({ data: {} })).toBeNull();
  });

  it('counts lessons started since the day began', () => {
    const since = new Date(2026, 10, 12, 4);
    const a = [
      assignmentResource(1, 1, { started_at: new Date(2026, 10, 12, 5).toISOString() }),
      assignmentResource(2, 2, { started_at: new Date(2026, 10, 12, 3).toISOString() }),
    ].map((r) => parseAssignment(r)!);
    expect(startedSince(a, since.getTime())).toBe(1);
  });
});
