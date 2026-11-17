import { expect, test } from 'vitest';
import type { AzureVoice } from '../../src/reader/api';
import { auditionVoices, audioKey, castDetail, castFor, castInfo, CAST_KINDS, clampPitch, isCastKind, pitchLabel, PITCH_MAX, PITCH_MIN, resetChange, voiceFamily, voiceNotes, voiceTag, voicesForKind } from '../../src/reader/storyCast';

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

test('the audition lists the kind\'s voices, or only the Multilingual ones among them', () => {
  const voices: AzureVoice[] = [
    { voice: 'pl-PL-ZofiaNeural', locale: 'pl-PL', name: 'Zofia', gender: 'Female' },
    { voice: 'pl-PL-MarekNeural', locale: 'pl-PL', name: 'Marek', gender: 'Male' },
    { voice: 'en-US-AvaMultilingualNeural', locale: 'en-US', name: 'Ava', gender: 'Female' },
    { voice: 'en-US-AndrewMultilingualNeural', locale: 'en-US', name: 'Andrew', gender: 'Male' },
  ];
  expect(auditionVoices(voices, 'girl', 'all').map((v) => v.name)).toEqual(['Zofia', 'Ava']);
  expect(auditionVoices(voices, 'girl', 'multilingual').map((v) => v.name)).toEqual(['Ava']);
  expect(auditionVoices(voices, 'boy', 'multilingual').map((v) => v.name)).toEqual(['Andrew']);
});

test('names the family a voice id belongs to', () => {
  expect(voiceFamily('en-US-Ava:DragonHDLatestNeural')).toBe('hd');
  expect(voiceFamily('en-US-Ava:DragonHDFlashLatestNeural')).toBe('hd-flash');
  expect(voiceFamily('en-AU-Cyanspark:DragonHDOmniLatestNeural')).toBe('hd-omni');
  expect(voiceFamily('en-AU-Isla:MAI-Voice-2')).toBe('mai');
  expect(voiceFamily('en-AU-Isla:MAI-Voice-2.1-Flash')).toBe('mai-flash');
  expect(voiceFamily('en-AU-AnnetteNeural')).toBeUndefined();
});

test('tags only the special voices', () => {
  expect(voiceTag('en-AU-Cyanspark:DragonHDOmniLatestNeural')).toBe('HD Omni');
  expect(voiceTag('en-AU-AnnetteNeural')).toBeUndefined();
});

test('explains just the kinds listed', () => {
  expect(voiceNotes([{ voice: 'en-AU-AnnetteNeural' }])).toEqual([]);
  const notes = voiceNotes([{ voice: 'en-AU-Isla:MAI-Voice-2-Flash' }, { voice: 'en-AU-AnnetteNeural' }]);
  expect(notes).toHaveLength(1);
  expect(notes[0].term).toBe('MAI Flash');
  expect(voiceNotes([{ voice: 'a:DragonHDLatestNeural' }]).some((n) => n.term === 'Latest')).toBe(true);
});
