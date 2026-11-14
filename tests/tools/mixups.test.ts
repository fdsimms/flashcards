import { describe, expect, it } from 'vitest';
import type { Note } from '../../src/core/types';
import { askable, missedPracticeLabel, mixupLanguage, mixupQuestion, mixupSet, nextMixup, practiceFromMisses, soundKey } from '../../src/tools/mixups';
import { omniNote } from '../support/fixtures';

const es = (id: string, Entry: string, Meaning: string, over: Record<string, string> = {}): Note =>
  ({ ...omniNote({ Entry, Meaning, Language: 'Spanish', Transliteration: '', ...over }), id, deck: 'Languages::Español' });
const th = (id: string, Entry: string, Meaning: string, Transliteration: string): Note =>
  ({ ...omniNote({ Entry, Meaning, Transliteration }), id });

const notes = [
  es('esperar', 'esperar', 'to hope; to wait'),
  es('esperanza', 'la esperanza', 'hope'),
  es('espera', 'la espera', 'wait (noun)'),
  es('aguardar', 'aguardar', 'to wait'),
  es('esta', 'esta', 'this (feminine)'),
  es('está', 'está', 'is (estar)'),
  th('klai', 'ไกล', 'far', 'klai'),
  th('klâi', 'ใกล้', 'near', 'klâi'),
  th('nangsue', 'หนังสือ', 'book', 'nǎng-sǔue'),
];
const all = new Set(notes.map((n) => n.id));
const fixed = () => 0;

describe('mixupLanguage', () => {
  it('reads the tool language from the note', () => {
    expect(mixupLanguage(notes[0])).toBe('es');
    expect(mixupLanguage(notes[6])).toBe('th');
  });
});

describe('soundKey', () => {
  it('takes tones and accents off a romanization or spelling', () => {
    expect(soundKey({ noteId: 'a', language: 'th', word: 'ใกล้', meaning: 'near', roman: 'klâi' })).toBe('klai');
    expect(soundKey({ noteId: 'a', language: 'es', word: 'está', meaning: 'is' })).toBe('esta');
    expect(soundKey({ noteId: 'a', language: 'th', word: 'ใกล้', meaning: 'near' })).toBeUndefined();
  });
});

describe('mixupSet', () => {
  const set = mixupSet(notes, all);

  it('links lookalikes with different meanings, by meaning', () => {
    expect(set.meaning.get('esperanza')).toEqual(expect.arrayContaining(['esperar', 'espera']));
    // esta and está look alike too, and mean different things.
    expect(set.meaning.get('esta')).toEqual(['está']);
  });

  it('links sound-alikes, by ear', () => {
    expect(set.ear.get('klâi')).toEqual(['klai']);
    expect(set.ear.get('está')).toEqual(['esta']);
    expect(set.ear.has('nangsue')).toBe(false);
  });

  it('leaves out words not being studied', () => {
    const some = mixupSet(notes, new Set(['klâi', 'esperar', 'esperanza']));
    expect(some.ear.has('klâi')).toBe(false);
    expect(some.meaning.get('esperar')).toEqual(['esperanza']);
    expect(some.words.has('klai')).toBe(false);
  });

  it("doesn't pair words that mean the same, which would both be right", () => {
    const same = mixupSet([es('a', 'esperar', 'to wait'), es('b', 'esperarse', 'to wait')], new Set(['a', 'b']));
    expect(same.meaning.size).toBe(0);
  });
});

describe('questions', () => {
  const set = mixupSet(notes, all);

  it('asks a word among its partners', () => {
    const q = mixupQuestion(set, 'meaning', 'esperanza', fixed)!;
    expect(q.target.word).toBe('la esperanza');
    expect(q.choices.map((c) => c.noteId).sort()).toEqual(['espera', 'esperanza', 'esperar']);
    expect(mixupQuestion(set, 'ear', 'nangsue', fixed)).toBeUndefined();
  });

  it('only asks in the chosen language', () => {
    expect(askable(set, 'ear', 'th').sort()).toEqual(['klai', 'klâi']);
  });

  it('asks the words just missed first, then others', () => {
    expect(nextMixup(set, 'ear', 'th', ['klâi'], [], fixed)).toBe('klâi');
    expect(nextMixup(set, 'ear', 'th', ['klâi'], ['klâi'], fixed)).toBe('klai');
    expect(nextMixup(set, 'ear', 'pl', [], [], fixed)).toBeUndefined();
  });
});

describe('practiceFromMisses', () => {
  const set = mixupSet(notes, all);

  it('splits misses by kind of reason, keeping only words with partners', () => {
    const plan = practiceFromMisses([
      { noteId: 'klâi', miss: 'tone' },
      { noteId: 'nangsue', miss: 'tone' },
      { noteId: 'esperanza' },
      { noteId: 'esta', miss: 'gender' },
    ], set);
    expect(plan).toEqual([
      { mode: 'ear', language: 'th', noteIds: ['klâi'], reason: 'tone' },
      { mode: 'meaning', language: 'es', noteIds: ['esperanza'] },
    ]);
  });

  it("goes by a word's latest miss", () => {
    expect(practiceFromMisses([{ noteId: 'esta', miss: 'gender' }, { noteId: 'esta', miss: 'meaning' }], set))
      .toEqual([{ mode: 'meaning', language: 'es', noteIds: ['esta'], reason: 'meaning' }]);
  });
});

describe('missedPracticeLabel', () => {
  it('names the shared reason, else the way they are told apart', () => {
    expect(missedPracticeLabel({ mode: 'ear', language: 'th', noteIds: ['a', 'b', 'c'], reason: 'tone' }, 'Tone')).toBe('Practice the 3 missed on tone');
    expect(missedPracticeLabel({ mode: 'ear', language: 'th', noteIds: ['a'], reason: 'vowel-length' }, 'Vowel length')).toBe('Practice the one missed on vowel length');
    expect(missedPracticeLabel({ mode: 'meaning', language: 'es', noteIds: ['a', 'b'] }, undefined)).toBe('Practice the 2 missed, by meaning');
  });
});
