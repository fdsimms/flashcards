import { describe, expect, it } from 'vitest';
import { WaniKaniError, type WaniKaniApi, type WaniKaniUser } from '../../src/wanikani/api';
import { copyAge, dataUri, inlineImages, offlineData, offlineText, parseSnapshot, wantedAudio, type Snapshot } from '../../src/wanikani/offline';
import { makeSnapshot } from '../../src/wanikani/offlineService';
import { audioFileName, audioFor } from '../../src/wanikani/production';
import type { Outcome } from '../../src/wanikani/session';
import { parseAssignment, parseSubject } from '../../src/wanikani/subjects';
import { assignmentResource, kanjiResource, partResource, radicalResource, vocabResource } from './fixtures';

const HOUR = 4;
const user: WaniKaniUser = { username: 'u', level: 5, maxLevel: 60, onVacation: false, lessonBatch: 5 };
const a = (id: number, subjectId: number, data: Record<string, unknown> = {}) => parseAssignment(assignmentResource(id, subjectId, data))!;
const review = (id: number, at = '2026-11-12T12:00:00.000Z'): Outcome => ({ kind: 'review', assignmentId: id, subjectId: id, srsStage: 1, wrongMeaning: 0, wrongReading: 0, at });
const start = (id: number, at: string): Outcome => ({ kind: 'start', assignmentId: id, subjectId: id, at });

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    version: 1,
    savedAt: new Date(2026, 10, 12, 10).toISOString(),
    user,
    apprentice: 12,
    started: 3,
    reviews: [a(1, 2467), a(2, 450)],
    lessons: [a(3, 8762, { srs_stage: 0 }), a(4, 450, { srs_stage: 0 })],
    subjects: [parseSubject(vocabResource)!, parseSubject(kanjiResource)!, parseSubject(radicalResource)!],
    synonyms: [[2467, ['grown-up']]],
    ...over,
  };
}

describe('the offline copy', () => {
  it('reads back what was saved, and nothing else', () => {
    const s = snapshot();
    expect(parseSnapshot(JSON.stringify(s))).toEqual(s);
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot('not json')).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...s, version: 2 }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...s, reviews: 'x' }))).toBeNull();
  });

  it('leaves out items answered since it was made', () => {
    const d = offlineData(snapshot(), [review(1), start(3, '2026-11-12T11:00:00.000Z')], new Date(2026, 10, 12, 12), HOUR);
    expect(d.reviews.map((x) => x.id)).toEqual([2]);
    expect(d.lessons.map((x) => x.id)).toEqual([4]);
    expect(d.subjects.get(450)?.characters).toBe('力');
    expect(d.synonyms.get(2467)).toEqual(['grown-up']);
  });

  it('counts a lesson started offline against today, on top of the copy\'s own count', () => {
    const now = new Date(2026, 10, 12, 12);
    expect(offlineData(snapshot(), [], now, HOUR).started).toBe(3);
    expect(offlineData(snapshot(), [start(3, new Date(2026, 10, 12, 11).toISOString())], now, HOUR).started).toBe(4);
    // A start from yesterday's study day doesn't count today.
    expect(offlineData(snapshot(), [start(3, new Date(2026, 10, 11, 20).toISOString())], now, HOUR).started).toBe(3);
  });

  it('drops the copy\'s lesson count once a new study day has begun', () => {
    // Made at 10 AM on the 12th; it's now 5 AM on the 13th, a new day. Starts since then still count.
    const now = new Date(2026, 10, 13, 5);
    expect(offlineData(snapshot(), [], now, HOUR).started).toBe(0);
    expect(offlineData(snapshot(), [start(3, new Date(2026, 10, 13, 4, 30).toISOString())], now, HOUR).started).toBe(1);
    // Before the day starts it is still the 12th.
    expect(offlineData(snapshot(), [], new Date(2026, 10, 13, 3), HOUR).started).toBe(3);
  });
});

describe('recordings to keep', () => {
  it('lists each subject\'s MP3 by the name the card looks for', () => {
    const wanted = wantedAudio(snapshot(), (s) => {
      const audio = audioFor(s);
      return audio ? { name: audioFileName(s.id, audio), url: audio.url } : undefined;
    });
    expect([...wanted]).toEqual([['wanikani-2467-1.mp3', 'https://files.wanikani.com/a.mp3']]);
  });
});

describe('radical pictures', () => {
  const radical = parseSubject(radicalResource)!;

  it('makes a data URI', () => {
    expect(dataUri(new Uint8Array([104, 105]), 'image/svg+xml')).toBe('data:image/svg+xml;base64,aGk=');
  });

  it('inlines a picture, reuses one already inlined, and keeps the address when it cannot download', async () => {
    const asked: string[] = [];
    const [first] = await inlineImages([radical], [], async (url) => { asked.push(url); return new Uint8Array([1]); });
    expect(first.image?.url).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(first.image?.svg).toBe(true);

    const [again] = await inlineImages([radical], [first], async (url) => { asked.push(url); return new Uint8Array([2]); });
    expect(again.image).toEqual(first.image);
    expect(asked).toHaveLength(1);

    const [failed] = await inlineImages([radical], [], async () => { throw new WaniKaniError('unavailable'); });
    expect(failed.image?.url).toBe('https://files.wanikani.com/gun.svg');
  });
});

describe('making the copy', () => {
  function fakeApi(over: Partial<WaniKaniApi> = {}): WaniKaniApi {
    const subjects = [parseSubject(vocabResource)!, parseSubject(kanjiResource)!, parseSubject(radicalResource)!];
    return {
      reviewsAvailable: async () => [a(1, 2467)],
      lessonsAvailable: async () => [a(3, 8762, { srs_stage: 0 }), a(4, 450, { srs_stage: 0 })],
      subjects: async (ids: number[]) => subjects.filter((s) => ids.includes(s.id)),
      synonyms: async () => new Map([[2467, ['grown-up']]]),
      download: async () => new Uint8Array([1]),
      ...over,
    } as unknown as WaniKaniApi;
  }
  const opts = { user, apprentice: 7, started: 2, previous: null, now: new Date(2026, 10, 12, 12) };

  it('reads reviews, lessons, subjects and synonyms, with pictures inlined', async () => {
    const s = await makeSnapshot({ api: fakeApi() }, opts);
    expect(s).toMatchObject({ version: 1, apprentice: 7, started: 2, savedAt: opts.now.toISOString(), synonyms: [[2467, ['grown-up']]] });
    expect(s.reviews.map((x) => x.id)).toEqual([1]);
    expect(s.lessons.map((x) => x.id)).toEqual([3, 4]);
    // The parts (12, 440, 453) are asked for too; this fake API has none of them.
    expect(s.subjects.map((x) => x.id).sort((p, q) => p - q)).toEqual([450, 2467, 8762]);
    expect(s.subjects.find((x) => x.id === 8762)?.image?.url).toMatch(/^data:/);
    expect(parseSnapshot(JSON.stringify(s))).toEqual(s);
  });

  it('keeps the parts the items are made of, read in one batch, so an offline card shows them', async () => {
    const parts = [parseSubject(partResource(453, 'kanji', '大', 'Big'))!, parseSubject(partResource(440, 'kanji', '人', 'Person'))!, parseSubject(partResource(12, 'radical', '力', 'Power'))!];
    const own = [parseSubject(vocabResource)!, parseSubject(kanjiResource)!, parseSubject(radicalResource)!];
    const asked: number[][] = [];
    const subjects = async (ids: number[]) => { asked.push(ids); return [...own, ...parts].filter((s) => ids.includes(s.id)); };
    const s = await makeSnapshot({ api: fakeApi({ subjects }) }, opts);
    expect(asked).toEqual([[2467, 8762, 450], [453, 440, 12]]);
    expect(s.subjects.map((x) => x.id)).toEqual([2467, 450, 8762, 453, 440, 12]);
    // Through a save and a read, as an offline session gets it.
    const d = offlineData(parseSnapshot(JSON.stringify(s))!, [], new Date(2026, 10, 12, 13), HOUR);
    expect(d.subjects.get(453)?.characters).toBe('大');
    expect(d.reviews.map((x) => x.subjectId)).toEqual([2467]);
  });

  it('still makes a copy when the parts cannot be read', async () => {
    const own = [parseSubject(vocabResource)!, parseSubject(kanjiResource)!, parseSubject(radicalResource)!];
    let calls = 0;
    const subjects = async (ids: number[]) => {
      if (calls++) throw new WaniKaniError('unavailable');
      return own.filter((s) => ids.includes(s.id));
    };
    const s = await makeSnapshot({ api: fakeApi({ subjects }) }, opts);
    expect(s.subjects.map((x) => x.id)).toEqual([2467, 450, 8762]);
  });

  it('keeps only the lessons a day can offer, in lesson order', async () => {
    const many = Array.from({ length: 60 }, (_, i) => a(100 + i, 450, { srs_stage: 0 }));
    const s = await makeSnapshot({ api: fakeApi({ lessonsAvailable: async () => many }) }, opts);
    expect(s.lessons).toHaveLength(50);
  });

  it('still makes a copy when the synonyms cannot be read', async () => {
    const s = await makeSnapshot({ api: fakeApi({ synonyms: async () => { throw new WaniKaniError('unavailable'); } }) }, opts);
    expect(s.synonyms).toEqual([]);
  });

  it('fails when the reviews cannot be read, so the last copy stays', async () => {
    await expect(makeSnapshot({ api: fakeApi({ reviewsAvailable: async () => { throw new WaniKaniError('unavailable'); } }) }, opts)).rejects.toBeInstanceOf(WaniKaniError);
  });
});

describe('how old the copy is', () => {
  // A fixed clock, so the test doesn't depend on the machine's locale.
  const time = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const saved = new Date(2026, 10, 12, 9, 14);

  it('gives the time on the day it was made and the day after, then the days since', () => {
    expect(copyAge(saved, new Date(2026, 10, 12, 18), HOUR, time)).toBe('today at 9:14');
    expect(copyAge(saved, new Date(2026, 10, 13, 9), HOUR, time)).toBe('yesterday at 9:14');
    expect(copyAge(saved, new Date(2026, 10, 14, 9), HOUR, time)).toBe('2 days ago');
    expect(copyAge(saved, new Date(2026, 10, 22, 9), HOUR, time)).toBe('10 days ago');
  });

  it('counts by study days: before the day starts, it is still the day before', () => {
    // 2 AM on the 13th is still the 12th's study day.
    expect(copyAge(saved, new Date(2026, 10, 13, 2), HOUR, time)).toBe('today at 9:14');
    // Made at 1 AM on the 13th: that's the 12th's study day, so "yesterday" from 5 AM on the 13th.
    expect(copyAge(new Date(2026, 10, 13, 1, 5), new Date(2026, 10, 13, 5), HOUR, time)).toBe('yesterday at 1:05');
    // With the day starting at midnight, it's today.
    expect(copyAge(new Date(2026, 10, 13, 1, 5), new Date(2026, 10, 13, 5), 0, time)).toBe('today at 1:05');
  });

  it('counts across a change of clocks, and treats a copy from the future as today', () => {
    // Daylight saving ends on 2026-11-01 in North America: the day is 25 hours long there.
    expect(copyAge(new Date(2026, 9, 31, 12), new Date(2026, 10, 2, 12), HOUR, time)).toBe('2 days ago');
    expect(copyAge(new Date(2026, 10, 12, 20), new Date(2026, 10, 12, 10), HOUR, time)).toBe('today at 20:00');
  });

  it('says where the session comes from', () => {
    expect(offlineText(saved, new Date(2026, 10, 14, 9), HOUR, time)).toBe('Offline. Studying from the copy saved 2 days ago');
    // The phone's own clock format, whatever it is.
    expect(offlineText(saved, new Date(2026, 10, 12, 10), HOUR)).toMatch(/^Offline\. Studying from the copy saved today at \S/);
  });
});
