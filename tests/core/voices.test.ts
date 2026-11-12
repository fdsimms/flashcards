import { describe, expect, it } from 'vitest';
import type { NoteType } from '../../src/core/types';
import {
  chosenVoice, deckLanguages, defaultRate, languageKey, OMNI_RATE, parseVoiceSettings, tagSpeech, voiceQuality, voicesIn, wordSpeech,
} from '../../src/core/voices';
import { omniNote } from '../support/fixtures';

const voices = [
  { identifier: 'com.apple.voice.compact.th-TH.Kanya', name: 'Kanya', language: 'th-TH', quality: 'Default' },
  { identifier: 'com.apple.voice.enhanced.th-TH.Narisa', name: 'Narisa', language: 'th-TH', quality: 'Enhanced' },
  { identifier: 'com.apple.voice.compact.es-MX.Paulina', name: 'Paulina', language: 'es-MX', quality: 'Default' },
  { identifier: 'com.apple.voice.premium.es-ES.Marisol', name: 'Marisol', language: 'es-ES', quality: 'Default' },
  { identifier: 'com.apple.voice.compact.en-US.Samantha', name: 'Samantha', language: 'en-US', quality: 'Default' },
  { identifier: 'com.apple.speech.synthesis.voice.Albert', name: 'Albert', language: 'en-US', quality: 'Enhanced' },
];

const basic: NoteType = {
  name: 'Basic (tts)', kind: 'normal', fields: ['Front', 'Back'], css: '',
  templates: [{ ord: 0, name: 'Card 1', front: '{{tts pl_PL voices=Apple_Zosia speed=0.8:Front}}', back: '{{tts en_US:text:Back}}' }],
};
const basicNote = { id: 'b1', deck: 'Polski', model: 'Basic (tts)', fields: { Front: '<b>kot</b>', Back: 'cat' }, tags: [] };

describe('the languages the decks are read in', () => {
  it("takes Omnilanguage notes' languages and the tts filters' in templates, with something to read in each", () => {
    const langs = deckLanguages([omniNote(), basicNote], [basic]);
    expect(langs).toEqual([
      { key: 'en', name: 'English', lang: 'en-US', sample: 'cat', omni: false },
      { key: 'pl', name: 'Polish', lang: 'pl-PL', sample: 'kot', omni: false },
      { key: 'th', name: 'Thai', lang: 'th-TH', sample: 'หนังสือ', omni: true },
    ]);
  });

  it('keeps a language with a choice saved, so it can still be changed', () => {
    expect(deckLanguages([], [], { ru: { rate: 0.8 } })).toEqual([{ key: 'ru', name: 'Russian', lang: 'ru', sample: undefined, omni: false }]);
  });

  it('reads an Omnilanguage word a little slower until a speed is chosen, and a tts filter at normal speed', () => {
    const [en, , th] = deckLanguages([omniNote(), basicNote], [basic]);
    expect(defaultRate(th)).toBe(OMNI_RATE);
    expect(defaultRate(en)).toBe(1);
  });
});

describe("the phone's voices", () => {
  it('keys a language by its code alone', () => {
    expect(languageKey('th_TH')).toBe('th');
    expect(languageKey('es-MX')).toBe('es');
    expect(languageKey('pl')).toBe('pl');
  });

  it("tells Premium apart, which expo-speech reports as Default", () => {
    expect(voices.map(voiceQuality)).toEqual(['Default', 'Enhanced', 'Default', 'Premium', 'Default', 'Enhanced']);
  });

  it('lists every region of a language, the best sounding first, without the novelty voices', () => {
    expect(voicesIn(voices, 'es').map((v) => v.name)).toEqual(['Marisol', 'Paulina']);
    expect(voicesIn(voices, 'th').map((v) => v.name)).toEqual(['Narisa', 'Kanya']);
    expect(voicesIn(voices, 'en').map((v) => v.name)).toEqual(['Samantha']);
  });

  it('uses a chosen voice only while the phone has it', () => {
    expect(chosenVoice(voices, { th: { voice: 'com.apple.voice.enhanced.th-TH.Narisa' } }, 'th-TH')).toBe('com.apple.voice.enhanced.th-TH.Narisa');
    expect(chosenVoice(voices, { th: { voice: 'com.apple.voice.premium.th-TH.Gone' } }, 'th-TH')).toBeUndefined();
  });
});

describe('reading aloud', () => {
  const settings = { es: { voice: 'com.apple.voice.premium.es-ES.Marisol', rate: 0.7 } };

  it("reads an Omnilanguage word with its language's voice and speed, else iOS's at the default speed", () => {
    expect(wordSpeech(voices, settings, 'es-MX')).toEqual({ language: 'es-MX', voice: 'com.apple.voice.premium.es-ES.Marisol', rate: 0.7 });
    expect(wordSpeech(voices, settings, 'th-TH')).toEqual({ language: 'th-TH', voice: undefined, rate: OMNI_RATE });
    expect(wordSpeech(voices, settings, undefined)).toEqual({ rate: OMNI_RATE });
  });

  it("puts a template's own voice and speed before the chosen ones, as Anki does", () => {
    const tag = (voices: string[], speed: number, lang = 'es_ES') => ({ text: 'x', lang, voices, speed });
    expect(tagSpeech(voices, settings, tag([], 1))).toEqual({ language: 'es-ES', voice: 'com.apple.voice.premium.es-ES.Marisol', rate: 0.7 });
    expect(tagSpeech(voices, settings, tag(['Apple_Paulina'], 0.8, 'es_MX'))).toEqual({ language: 'es-MX', voice: 'com.apple.voice.compact.es-MX.Paulina', rate: 0.8 });
    expect(tagSpeech(voices, {}, tag([], 1))).toEqual({ language: 'es-ES', voice: undefined, rate: 1 });
  });

  it('reads back only well-formed saved choices', () => {
    expect(parseVoiceSettings('{"th":{"voice":"a","voiceName":"A","rate":0.8},"x":3,"es":{"rate":-1}}')).toEqual({ th: { voice: 'a', voiceName: 'A', rate: 0.8 }, es: {} });
    expect(parseVoiceSettings('not json')).toEqual({});
    expect(parseVoiceSettings(null)).toEqual({});
  });
});
