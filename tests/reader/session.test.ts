import { expect, test } from 'vitest';
import type { ReaderText } from '../../src/reader/api';
import { answerQuiz, formatDuration, heard, isFlagged, listenedOnly, lookUp, startSession, toggleFlag, toLog } from '../../src/reader/session';

const QUIZ = { choices: ['a', 'b', 'c', 'd'], answer: 0 };
const TEXT: ReaderText = { id: 7, topicId: 1, title: 't', coverage: 0.97, stretch: [], roles: {}, form: 'dialogue', language: 'th', grammar: [], lines: [] };

test('looking a word up records it once', () => {
  let s = startSession(TEXT, 0);
  s = lookUp(lookUp(s, 'ทอน'), 'ทอน');
  s = lookUp(s, 'กิน');
  expect(s.glossed).toEqual(['ทอน', 'กิน']);
});

test('marking a word unknown toggles', () => {
  let s = toggleFlag(startSession(TEXT, 0), 'ทอน');
  expect(isFlagged(s, 'ทอน')).toBe(true);
  s = toggleFlag(s, 'ทอน');
  expect(isFlagged(s, 'ทอน')).toBe(false);
});

test('the log carries the words and whole seconds', () => {
  let s = startSession(TEXT, 1_000);
  s = toggleFlag(lookUp(s, 'ทอน'), 'ทอน');
  expect(toLog(s, 96_400, true)).toEqual({
    finished: true,
    words_glossed: ['ทอน'],
    words_flagged: ['ทอน'],
    audio_speed: null,
    listen_only: false,
    seconds: 95,
  });
});

test('quiz answers are logged by word, the latest answer kept, and never count as a lookup', () => {
  let s = answerQuiz(startSession(TEXT, 0), 'ทอน', false, { quiz: QUIZ, picked: 1 });
  s = answerQuiz(answerQuiz(s, 'ทอน', true, { quiz: QUIZ, picked: 0 }), 'ดี', false, { quiz: QUIZ, picked: null });
  expect(s.quizRight).toEqual(['ทอน']);
  expect(s.quizWrong).toEqual(['ดี']);
  expect(s.glossed).toEqual([]);
  expect(toLog(s, 0, true)).toMatchObject({ quiz_right: ['ทอน'], quiz_wrong: ['ดี'] });
});

test('a log with no quiz answers leaves the fields out', () => {
  expect(toLog(startSession(TEXT, 0), 0, true)).not.toHaveProperty('quiz_right');
});

test('a clock that went backwards logs zero seconds', () => {
  expect(toLog(startSession(TEXT, 5_000), 1_000, false).seconds).toBe(0);
});

test('durations read as minutes and seconds', () => {
  expect(formatDuration(0)).toBe('0:00');
  expect(formatDuration(134)).toBe('2:14');
});

test('the log carries the speed audio last played at', () => {
  const s = startSession(TEXT, 0);
  expect(toLog(s, 0, false).audio_speed).toBeNull();
  expect(toLog(heard(heard(s, 0.8), 0.9), 0, false).audio_speed).toBe(0.9);
});

test('a listen-only pass is logged', () => {
  const s = startSession(TEXT, 0);
  expect(toLog(s, 0, false).listen_only).toBe(false);
  expect(toLog(listenedOnly(s), 0, true).listen_only).toBe(true);
});

test('the log carries the check after reading only when it was taken', () => {
  const s = startSession(TEXT, 0);
  expect(toLog(s, 0, true, { right: 3, asked: 5 })).toMatchObject({ check_right: 3, check_asked: 5 });
  expect(toLog(s, 0, true, { right: 0, asked: 0 })).not.toHaveProperty('check_asked');
  expect(toLog(s, 0, true)).not.toHaveProperty('check_asked');
});

test('an answered quiz is kept by word with its choices and pick, the latest answer replacing the one before', () => {
  let s = answerQuiz(startSession(TEXT, 0), 'ทอน', false, { quiz: QUIZ, picked: null });
  expect(s.quizAnswers['ทอน']).toEqual({ quiz: QUIZ, picked: null });
  s = answerQuiz(s, 'ทอน', true, { quiz: QUIZ, picked: 0 });
  expect(s.quizAnswers).toEqual({ 'ทอน': { quiz: QUIZ, picked: 0 } });
  expect(toLog(s, 0, true)).not.toHaveProperty('quizAnswers');
});
