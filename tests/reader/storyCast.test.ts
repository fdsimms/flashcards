import { expect, test } from 'vitest';
import type { AzureVoice } from '../../src/reader/api';
import { audioKey, castDetail, castFor, castInfo, CAST_KINDS, clampPitch, isCastKind, pitchLabel, PITCH_MAX, PITCH_MIN, resetChange, voicesForKind } from '../../src/reader/storyCast';

const cast = (voice = 'ru-RU-DariyaNeural', pitch = 0) =>
  Object.fromEntries(CAST_KINDS.map((k) => [k.kind, { voice, pitch }])) as never;

test('every kind of character is a man or a woman, and the server knows the same six', () => {
  expect(CAST_KINDS.map((k) => k.kind)).toEqual(['man', 'woman', 'boy', 'girl', 'elder_man', 'elder_woman']);
  expect(CAST_KINDS.filter((k) => k.gender === 'male').map((k) => k.label)).toEqual(['Man', 'Boy', 'Older man']);
  expect(castInfo('girl').gender).toBe('female');
  expect(isCastKind('girl')).toBe(true);
  expect(isCastKind('dragon')).toBe(false);
  expect(isCastKind(undefined)).toBe(false);
});

test('a pitch is clamped to what the server accepts and labelled with a real minus sign', () => {
  expect(clampPitch(99)).toBe(PITCH_MAX);
  expect(clampPitch(-99)).toBe(PITCH_MIN);
  expect(clampPitch(7.6)).toBe(8);
  expect(pitchLabel(18)).toBe('+18%');
  expect(pitchLabel(-8)).toBe('−8%');
  expect(pitchLabel(0)).toBe('0%');
});

test("a kind's row says the voice's name and its pitch change, if it has one", () => {
  expect(castDetail({ voice: 'ru-RU-DmitryNeural', pitch: 10 })).toBe('Dmitry, +10%');
  expect(castDetail({ voice: 'ru-RU-SvetlanaNeural', pitch: 0 })).toBe('Svetlana');
  expect(castDetail({ voice: 'en-US-AvaMultilingualNeural', pitch: -8 })).toBe('Ava, −8%');
});

test("a language's story voices are there only when the server has every kind", () => {
  expect(castFor({ cast: { ru: cast() } }, 'ru')).toBeDefined();
  expect(castFor({ cast: { ru: cast() } }, 'th')).toBeUndefined();
  expect(castFor({}, 'ru')).toBeUndefined();
  expect(castFor(null, 'ru')).toBeUndefined();
  const missing = cast() as Record<string, unknown>;
  delete missing.girl;
  expect(castFor({ cast: { ru: missing as never } }, 'ru')).toBeUndefined();
});

test("a kind can be given the voices of its gender only", () => {
  const voices: AzureVoice[] = [
    { voice: 'ru-RU-DmitryNeural', locale: 'ru-RU', name: 'Dmitry', gender: 'Male' },
    { voice: 'ru-RU-SvetlanaNeural', locale: 'ru-RU', name: 'Svetlana', gender: 'Female' },
    { voice: 'ru-RU-X', locale: 'ru-RU', name: 'X' },
  ];
  expect(voicesForKind(voices, 'girl').map((v) => v.name)).toEqual(['Svetlana']);
  expect(voicesForKind(voices, 'elder_man').map((v) => v.name)).toEqual(['Dmitry']);
});

test('resetting says null for every kind of the language and nothing for another', () => {
  const change = resetChange('ru');
  expect(Object.keys(change.cast)).toEqual(['ru']);
  expect(Object.values(change.cast.ru!)).toEqual([null, null, null, null, null, null]);
});

test('the same voices and pitch name the same cached audio, and it is safe as a file name', () => {
  expect(audioKey('ru', 'ru-RU-DariyaNeural', 18)).toBe(audioKey('ru', 'ru-RU-DariyaNeural', 18));
  expect(audioKey('ru', 'ru-RU-DariyaNeural', 18)).not.toBe(audioKey('ru', 'ru-RU-DariyaNeural', 20));
  expect(audioKey('a/b', '../x', -8)).toBe('a_b-___x--8');
});
