import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AudioLesson } from '../../src/reader/api';
import { anyMaking, atEnd, clock, lessonDetail, lessonsOffered, parseNarrator, parseParticle, skipTo, stageSteps } from '../../src/reader/lessons';

const lesson = (over: Partial<AudioLesson> = {}): AudioLesson => ({
  id: 1, language: 'fr', scene: 'a café', title: 'At the café', state: 'ready', error: '',
  duration_ms: 252_000, created_at: '2026-11-15T12:00:00',
  phrases: [{ text: 'Un café.', english: 'A coffee.' }, { text: 'Merci.', english: 'Thanks.' }],
  dialogue: [], ...over,
});

describe('lessonsOffered', () => {
  it('is every language but English', () => {
    for (const code of ['fr', 'th', 'es', 'de', 'ru', 'el', 'pl', 'nb', 'ja'] as const) expect(lessonsOffered(code)).toBe(true);
    expect(lessonsOffered('en')).toBe(false);
  });
});

describe('anyMaking', () => {
  it('is true while one is being made, and only then', () => {
    expect(anyMaking([lesson(), lesson({ state: 'making' })])).toBe(true);
    expect(anyMaking([lesson(), lesson({ state: 'failed' })])).toBe(false);
    expect(anyMaking([])).toBe(false);
  });
});

describe('clock', () => {
  it('shows minutes and seconds', () => {
    expect(clock(86.9)).toBe('1:26');
    expect(clock(252)).toBe('4:12');
    expect(clock(5)).toBe('0:05');
  });
  it('shows 0:00 for nothing, a negative or a missing length', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(-3)).toBe('0:00');
    expect(clock(NaN)).toBe('0:00');
  });
});

describe('skipTo', () => {
  it('moves by the amount within the lesson', () => {
    expect(skipTo(60, 15, 250)).toBe(75);
    expect(skipTo(60, -15, 250)).toBe(45);
  });
  it('stops at the start and the end', () => {
    expect(skipTo(5, -15, 250)).toBe(0);
    expect(skipTo(245, 15, 250)).toBe(250);
  });
  it('has no end while the length is unknown', () => {
    expect(skipTo(10, 15, 0)).toBe(25);
  });
});

describe('atEnd', () => {
  it('is true within half a second of the end, and never before the length is known', () => {
    expect(atEnd(249.8, 250)).toBe(true);
    expect(atEnd(100, 250)).toBe(false);
    expect(atEnd(0, 0)).toBe(false);
  });
});

describe('lessonDetail', () => {
  it('says how long a ready lesson is, how many phrases it teaches and when it was made', () => {
    expect(lessonDetail(lesson({ created_at: '2026-11-15T12:00:00' }))).toBe('4 min · 2 phrases · Nov 15');
  });
  it('counts a short lesson as a minute and one phrase as singular', () => {
    expect(lessonDetail(lesson({ duration_ms: 20_000, phrases: [{ text: 'a', english: 'b' }], created_at: '' }))).toBe('1 min · 1 phrase');
  });
  it('says what a lesson being made is doing', () => {
    expect(lessonDetail(lesson({ state: 'making', stage: 'recording' }))).toBe('Recording the voices.');
    expect(lessonDetail(lesson({ state: 'making' }))).toBe('Writing the phrases.');
  });
  it('gives a failed lesson its reason, or says to try again', () => {
    expect(lessonDetail(lesson({ state: 'failed', error: "Azure couldn't speak the lesson. Azure answered 429." }))).toContain('Azure answered 429');
    expect(lessonDetail(lesson({ state: 'failed', error: '' }))).toBe("Couldn't make this lesson. Try again.");
  });
});

describe('stageSteps', () => {
  it('marks the steps before the stage done, the stage now and the rest to come', () => {
    expect(stageSteps('recording').map((s) => s.status)).toEqual(['done', 'now', 'todo']);
    expect(stageSteps('joining').map((s) => s.status)).toEqual(['done', 'done', 'now']);
  });
  it('starts at the first step when the stage is missing', () => {
    expect(stageSteps(undefined).map((s) => s.status)).toEqual(['now', 'todo', 'todo']);
  });
});

describe('parseNarrator', () => {
  // The same names the server's narrator check is tested with (server/reader/tests/test_lesson_service.py).
  const voices = JSON.parse(readFileSync(join(__dirname, '..', '..', 'server', 'speech', 'tests', 'voice-names.json'), 'utf8')) as
    { narrators: string[]; other_voices: string[]; not_voices: string[] };
  it('agrees with the server on every listed voice name', () => {
    for (const v of voices.narrators) expect(parseNarrator(v)).toBe(v);
    for (const v of [...voices.other_voices, ...voices.not_voices]) expect(parseNarrator(v)).toBe('');
  });
  it('keeps an English voice', () => {
    expect(parseNarrator('en-GB-RyanNeural')).toBe('en-GB-RyanNeural');
    expect(parseNarrator(' en-US-AvaMultilingualNeural ')).toBe('en-US-AvaMultilingualNeural');
    expect(parseNarrator('en-au-cyanspark:DragonHDOmniLatestNeural')).toBe('en-au-cyanspark:DragonHDOmniLatestNeural');
  });
  it('is empty, meaning the server\'s own, for nothing or anything else', () => {
    expect(parseNarrator(null)).toBe('');
    expect(parseNarrator('')).toBe('');
    expect(parseNarrator('fr-FR-HenriNeural')).toBe('');
    expect(parseNarrator('Guy')).toBe('');
  });
});

describe('parseParticle', () => {
  it('keeps kha and reads anything else as khrap', () => {
    expect(parseParticle('kha')).toBe('kha');
    expect(parseParticle('khrap')).toBe('khrap');
    expect(parseParticle(null)).toBe('khrap');
    expect(parseParticle('x')).toBe('khrap');
  });
});
