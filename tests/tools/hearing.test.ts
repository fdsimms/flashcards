import { describe, expect, it } from 'vitest';
import type { AzureVoice, Language } from '../../src/reader/api';
import {
  allWords, clipName, drawHearing, HEARING, hearingPatterns, hearingVoices, MAX_VOICES, questionKey, roundResults, soundById, soundOf,
  hearingFromMisses, hearingPracticeLabel, needsRecording, practicedByHearing, soundsOf, spokenText, targetsFor, TONE_QUESTION_SHARE, TONE_SET,
  validFocus, voiceKey, weakestSound, type HearingLanguage,
} from '../../src/tools/hearing';
import { toneOfRoman } from '../../src/tools/thai/script';
import { TOOLS } from '../../src/tools/tools';

const languages = Object.entries(HEARING) as [Language, HearingLanguage][];
const thai = HEARING.th!;

/** A random source that returns these in turn, then repeats the last. */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe('the word sets', () => {
  it.each(languages)('are well formed in %s', (_, lang) => {
    const soundIds = new Set(soundsOf(lang).map((s) => s.id));
    const groupIds = new Set(lang.groups.map((g) => g.id));
    for (const set of lang.sets) {
      expect(set.words.length).toBeGreaterThanOrEqual(2);
      expect(new Set(set.words.map((w) => w.word)).size).toBe(set.words.length);
      // Two words a voice is given alike can't be told apart by ear.
      expect(new Set(set.words.map(voiceKey)).size).toBe(set.words.length);
      for (const w of set.words) {
        expect(w.roman.trim()).not.toBe('');
        expect(w.meaning.trim()).not.toBe('');
        expect(soundIds.has(soundOf(set, w))).toBe(true);
      }
    }
    for (const s of lang.sounds) expect(groupIds.has(s.group)).toBe(true);
    // Every group has something to ask.
    for (const g of lang.groups) expect(targetsFor(lang, { kind: 'group', id: g.id }).length).toBeGreaterThan(0);
  });

  it("gives a Thai tone set's words each a different tone", () => {
    for (const set of thai.sets.filter((s) => s.sound === TONE_SET)) {
      const tones = set.words.map((w) => toneOfRoman(w.roman));
      expect(new Set(tones).size).toBe(tones.length);
    }
  });

  it("keeps the tone the same across a Thai set that isn't about tone, so a miss is about the one sound", () => {
    for (const set of thai.sets.filter((s) => s.sound !== TONE_SET)) {
      expect(new Set(set.words.map((w) => toneOfRoman(w.roman))).size).toBe(1);
    }
  });

  it('gives a Russian word to the voice without its stress mark, and shows it with one', () => {
    for (const set of HEARING.ru!.sets) {
      for (const w of set.words) {
        expect(spokenText(w)).not.toMatch(/́/);
        expect(w.word.normalize('NFD').replace(/́/g, '')).toBe(spokenText(w).normalize('NFD'));
      }
    }
  });

  it('gives each word of a Russian stress pair its IPA, stressed where its mark is', () => {
    for (const set of HEARING.ru!.sets.filter((s) => s.sound === 'stress')) {
      expect(new Set(set.words.map(spokenText)).size).toBe(1);
      for (const w of set.words) {
        expect(needsRecording(w)).toBe(true);
        // The same syllable is stressed in both: as many vowels come before the marked one in the
        // word as before the ˈ in its IPA.
        const letters = [...w.word.normalize('NFD')];
        const mark = letters.indexOf('\u0301');
        const beforeMark = letters.slice(0, mark - 1).filter((ch) => /[аеёиоуыэюя]/.test(ch)).length;
        const beforeStress = [...w.ipa!.split('ˈ')[0]].filter((ch) => /[aeiouɐəʊɪɨɛɔæ]/.test(ch)).length;
        expect(mark).toBeGreaterThan(0);
        expect(beforeStress).toBe(beforeMark);
      }
    }
  });

  it('leaves the stress pairs out when only the phone can play them', () => {
    const ru = HEARING.ru!;
    expect(targetsFor(ru, { kind: 'group', id: 'stress' }).length).toBeGreaterThan(0);
    expect(targetsFor(ru, { kind: 'group', id: 'stress' }, false)).toEqual([]);
    for (const [s] of targetsFor(ru, { kind: 'all' }, false)) expect(ru.sets[s].sound).not.toBe('stress');
  });

  it('gives a Japanese reading only with the kanji it reads, in kana that matches the word shown', () => {
    for (const set of HEARING.ja!.sets) {
      for (const w of set.words) {
        if (w.reading) {
          expect(w.say).toBeDefined();
          expect(w.reading).toBe(w.word);
        }
      }
    }
  });

  it('is offered as a tool in exactly the languages that have sets', () => {
    expect([...(TOOLS.find((t) => t.id === 'hearing')?.languages ?? [])].sort()).toEqual(['ja', 'pl', 'ru', 'th']);
  });
});

describe('sounds and patterns', () => {
  it("tallies a tone set's word under its own tone, and any other set's under the set's sound", () => {
    const tones = thai.sets[0];
    expect(tones.words.map((w) => soundOf(tones, w))).toEqual(['tone:rising', 'tone:low', 'tone:falling']);
    const vowels = thai.sets.findIndex((s) => s.sound === 'vowel-length');
    expect(hearingPatterns(thai, { kind: 'pick', set: vowels, target: 1 })).toEqual(['vowel-length']);
    expect(hearingPatterns(thai, { kind: 'tone', set: 0, target: 2 })).toEqual(['tone:falling']);
  });

  it('lists the tones as sounds only where a language has tone sets', () => {
    expect(soundById(thai, 'tone:high')?.label).toBe('High tone');
    expect(soundById(HEARING.pl!, 'tone:high')).toBeUndefined();
  });
});

describe('what a round asks', () => {
  it('keeps to a group, or to the words standing for one sound', () => {
    for (const [s] of targetsFor(thai, { kind: 'group', id: 'vowels' })) expect(thai.sets[s].sound).toBe('vowel-length');
    const falling = targetsFor(thai, { kind: 'sound', id: 'tone:falling' });
    expect(falling.length).toBeGreaterThan(0);
    for (const [s, w] of falling) expect(soundOf(thai.sets[s], thai.sets[s].words[w])).toBe('tone:falling');
    expect(targetsFor(thai, { kind: 'all' }).length).toBe(thai.sets.reduce((n, s) => n + s.words.length, 0));
  });

  it('asks a tone set for the tone some of the time, and never asks another set for one', () => {
    // First draw picks the target, second decides the kind.
    expect(drawHearing(thai, { kind: 'group', id: 'tones' }, undefined, seq(0, TONE_QUESTION_SHARE - 0.01))?.kind).toBe('tone');
    expect(drawHearing(thai, { kind: 'group', id: 'tones' }, undefined, seq(0, TONE_QUESTION_SHARE + 0.01))?.kind).toBe('pick');
    for (let i = 0; i < 50; i++) expect(drawHearing(thai, { kind: 'group', id: 'vowels' }, undefined, Math.random)?.kind).toBe('pick');
  });

  it("doesn't ask the same question twice in a row while there's another", () => {
    const first = drawHearing(HEARING.pl!, { kind: 'all' }, undefined, seq(0))!;
    const next = drawHearing(HEARING.pl!, { kind: 'all' }, questionKey(first), seq(0, 0, 0.99))!;
    expect(questionKey(next)).not.toBe(questionKey(first));
  });

  it('falls back to every sound for a group or sound the language no longer has', () => {
    expect(validFocus(thai, { kind: 'group', id: 'tones' })).toEqual({ kind: 'group', id: 'tones' });
    expect(validFocus(HEARING.pl!, { kind: 'group', id: 'tones' })).toEqual({ kind: 'all' });
    expect(validFocus(thai, { kind: 'sound', id: 'tone:mid' })).toEqual({ kind: 'sound', id: 'tone:mid' });
    expect(validFocus(thai, { kind: 'sound', id: 'sz-ś' })).toEqual({ kind: 'all' });
  });
});

describe("a round's results", () => {
  it('lists each sound with its share right, the weakest first, and offers the weakest only if it was missed', () => {
    const results = roundResults(thai, [
      { sound: 'tone:low', right: true }, { sound: 'tone:low', right: false },
      { sound: 'vowel-length', right: true }, { sound: 'vowel-length', right: true },
      { sound: 'tone:falling', right: false }, { sound: 'tone:falling', right: false }, { sound: 'tone:falling', right: true },
    ]);
    expect(results.map((r) => [r.label, r.right, r.asked])).toEqual([['Falling tone', 1, 3], ['Low tone', 1, 2], ['Short or long vowel', 2, 2]]);
    expect(weakestSound(results)?.sound).toBe('tone:falling');
    expect(weakestSound(roundResults(thai, [{ sound: 'tone:low', right: true }]))).toBeUndefined();
  });
});

describe('the voices', () => {
  const v = (voice: string, locale: string, gender: string): AzureVoice => ({ voice, locale, name: voice, gender });

  it("takes the language's own voices, women and men in turn, up to the limit", () => {
    const voices = [
      v('pl-PL-ZofiaNeural', 'pl-PL', 'Female'), v('pl-PL-AgnieszkaNeural', 'pl-PL', 'Female'), v('pl-PL-MarekNeural', 'pl-PL', 'Male'),
      v('en-US-AvaMultilingualNeural', 'en-US', 'Female'), v('pl-PL-Zofia:DragonHDLatestNeural', 'pl-PL', 'Female'),
    ];
    expect(hearingVoices(voices, 'pl')).toEqual(['pl-PL-ZofiaNeural', 'pl-PL-MarekNeural', 'pl-PL-AgnieszkaNeural']);
    const many = Array.from({ length: 8 }, (_, i) => v(`ja-JP-V${i}Neural`, 'ja-JP', i % 3 ? 'Female' : 'Male'));
    expect(hearingVoices(many, 'ja')).toHaveLength(MAX_VOICES);
    expect(hearingVoices(many, 'ja')[0]).toBe('ja-JP-V0Neural');
  });

  it('has none for a language with no voices of its own', () => {
    expect(hearingVoices([v('en-US-AvaMultilingualNeural', 'en-US', 'Female')], 'th')).toEqual([]);
  });

  it("names a recording by what's said, the voice and the reading", () => {
    const [snow] = HEARING.ja!.sets.find((s) => s.words.some((w) => w.word === 'ゆき'))!.words;
    expect(clipName(snow, 'ja-JP-NanamiNeural')).toBe(clipName(snow, 'ja-JP-NanamiNeural'));
    expect(clipName(snow, 'ja-JP-NanamiNeural')).not.toBe(clipName({ ...snow, reading: undefined }, 'ja-JP-NanamiNeural'));
    expect(clipName(snow, 'ja-JP-NanamiNeural')).not.toBe(clipName(snow, 'ja-JP-KeitaNeural'));
  });

  it('records each word once, however many sets it is in', () => {
    const words = allWords(thai);
    expect(words.filter((w) => w.word === 'ข้าว')).toHaveLength(1);
    expect(new Set(words.map((w) => w.word)).size).toBe(words.length);
  });
});

describe("a session's misses", () => {
  const languages: Record<string, Language> = { a: 'th', b: 'th', c: 'th', d: 'pl', e: 'th' };
  const languageOf = (id: string) => languages[id];

  it('opens Thai words missed on tone or vowel length on that group, once each by its latest reason', () => {
    const practice = hearingFromMisses([
      { noteId: 'a', miss: 'tone' }, { noteId: 'b', miss: 'tone' }, { noteId: 'c', miss: 'vowel-length' },
      { noteId: 'e', miss: 'tone' }, { noteId: 'e', miss: 'meaning' }, { noteId: 'd', miss: 'spelling' },
    ], languageOf);
    expect(practice).toEqual([{ language: 'th', group: 'tones', count: 2 }, { language: 'th', group: 'vowels', count: 1 }]);
    expect(practice.map(hearingPracticeLabel)).toEqual(['Practice hearing tones', 'Practice hearing vowel length']);
  });

  it('takes only the reasons it practices, in the languages it has', () => {
    expect(practicedByHearing('th', 'tone')).toBe(true);
    expect(practicedByHearing('th', 'spelling')).toBe(false);
    expect(practicedByHearing('ru', 'stress')).toBe(false);
    expect(practicedByHearing(undefined, 'tone')).toBe(false);
  });
});
