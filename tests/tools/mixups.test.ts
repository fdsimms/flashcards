import { describe, expect, it } from 'vitest';
import type { Note } from '../../src/core/types';
import { askable, isRepeatForm, linkCandidates, missedPracticeLabel, mixupLanguage, mixupQuestion, mixupSet, nextMixup, practiceFromMisses, searchWords, soundKey } from '../../src/tools/mixups';
import { newPair } from '../../src/core/confusedPairs';
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
    // Kana keeps its voicing marks, and katakana is read as hiragana.
    expect(soundKey({ noteId: 'a', language: 'ja', word: '海岸', meaning: 'coast', roman: 'かいがん' })).toBe('かいがん');
    expect(soundKey({ noteId: 'a', language: 'ja', word: 'パン', meaning: 'bread', roman: 'パン' })).toBe('ぱん');
  });
  it('keeps a letter its language hears: Polish ą and ę, German umlauts, Russian й and ё', () => {
    const key = (language: 'pl' | 'de' | 'ru', word: string) => soundKey({ noteId: 'a', language, word, meaning: 'x' });
    expect(key('pl', 'kąt')).not.toBe(key('pl', 'kat'));
    expect(key('pl', 'pięć')).not.toBe(key('pl', 'piec'));
    expect(key('de', 'schön')).not.toBe(key('de', 'schon'));
    expect(key('ru', 'мой')).not.toBe(key('ru', 'мои'));
    expect(key('ru', 'всё')).not.toBe(key('ru', 'все'));
    // A stress mark added for learning isn't a letter.
    expect(key('ru', 'молоко́')).toBe(key('ru', 'молоко'));
  });
  it('hears a Japanese long vowel as short, and a small っ or ゃ as missed', () => {
    const key = (roman: string) => soundKey({ noteId: 'a', language: 'ja', word: 'x', meaning: 'x', roman });
    expect(key('おばあさん')).toBe(key('おばさん'));
    expect(key('びょういん')).toBe(key('びよういん'));
    expect(key('きって')).toBe(key('きて'));
    expect(key('コーヒー')).toBe(key('こひ'));
    expect(key('せんせい')).toBe('せんせ');
    expect(key('あい')).toBe('あい'); // not a long vowel: い after an a
    expect(key('かいがん')).not.toBe(key('かいかん'));
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

  it("doesn't pair a Thai word with its ๆ form by meaning, though their glosses differ", () => {
    const pair = mixupSet([th('jing', 'จริง', 'real; true', 'jing'), th('jingjing', 'จริงๆ', 'really; truly', 'jing jing'), th('jing2', 'จริง ๆ', 'for real', 'jing jing')], new Set(['jing', 'jingjing', 'jing2']));
    expect(pair.meaning.size).toBe(0);
    // By ear they're still told apart from other words, and a spelled-out space doesn't hide the mark.
    expect(isRepeatForm(pair.words.get('jing')!, pair.words.get('jing2')!)).toBe(true);
    expect(isRepeatForm(pair.words.get('jing')!, pair.words.get('jing')!)).toBe(false);
  });
});

describe('mixupSet in Japanese', () => {
  const ja = (id: string, Entry: string, Meaning: string, KanaReading: string): Note =>
    ({ ...omniNote({ Entry, Meaning, Language: 'japanese', Transliteration: '', KanaReading }), id, deck: '👅 Languages::🍥 日本語' });
  const words = [
    ja('gekidan', '劇団', 'theater company', 'げきだん'), ja('gekijou', '劇場', 'theater', 'げきじょう'),
    ja('obasan', 'おばさん', 'aunt', 'おばさん'), ja('obaasan', 'おばあさん', 'grandmother', 'おばあさん'),
    ja('keiken', '経験', 'experience', 'けいけん'), ja('keikensuru', '経験する', 'to experience', 'けいけんする'),
  ];
  const set = mixupSet(words, new Set(words.map((w) => w.id)));
  it('asks words a kanji apart, and a noun against its suru verb, by meaning', () => {
    expect(set.meaning.get('gekidan')).toEqual(['gekijou']);
    // As Spanish asks esperar against la espera.
    expect(set.meaning.get('keiken')).toEqual(['keikensuru']);
  });
  it('asks a long vowel against a short one by ear', () => {
    expect(set.ear.get('obasan')).toEqual(['obaasan']);
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
      { noteId: 'nangsue', miss: 'meaning' },
      { noteId: 'esperanza' },
      { noteId: 'esta', miss: 'gender' },
    ], set);
    expect(plan).toEqual([
      { mode: 'meaning', language: 'es', noteIds: ['esperanza'] },
    ]);
  });

  it("leaves a Thai word missed on its tone or vowel length to Hearing sounds (hearing.ts), even one with sound-alikes", () => {
    expect(practiceFromMisses([{ noteId: 'klâi', miss: 'tone' }, { noteId: 'klâi', miss: 'vowel-length' }], set)).toEqual([]);
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

describe('your pairs', () => {
  const linked = [newPair('nangsue', 'esperar', new Date(2026, 10, 11, 9))!, newPair('esta', 'espera', new Date(2026, 10, 11, 9))!];
  const set = mixupSet(notes, all, linked);

  it("asks linked words whatever they look or sound like, even in another language's deck", () => {
    expect(set.pairs.get('nangsue')).toEqual(['esperar']);
    expect(set.pairs.get('esperar')).toEqual(['nangsue']);
    expect(mixupQuestion(set, 'pairs', 'esta', fixed)!.choices.map((c) => c.noteId).sort()).toEqual(['espera', 'esta']);
  });

  it('asks nothing when nothing is linked', () => {
    expect(mixupSet(notes, all).pairs.size).toBe(0);
  });

  it("leaves out a pair with a word that isn't studied, and words that mean the same", () => {
    expect(mixupSet(notes, new Set(['esta']), linked).pairs.size).toBe(0);
    const same = mixupSet([es('a', 'esperar', 'to wait'), es('b', 'aguardar', 'to wait')], new Set(['a', 'b']), [newPair('a', 'b', new Date(2026, 10, 11))!]);
    expect(same.pairs.size).toBe(0);
  });

  it('is practiced for words missed as mixed up with another, and says no reason', () => {
    const plan = practiceFromMisses([{ noteId: 'esta', miss: 'confused' }, { noteId: 'klâi', miss: 'confused' }], set);
    expect(plan).toEqual([{ mode: 'pairs', language: 'es', noteIds: ['esta'] }]);
    expect(missedPracticeLabel(plan[0], 'Mixed up with another word')).toBe('Practice the one missed, with your pairs');
  });

  it('keeps a word missed as mixed up out of the look and sound practice', () => {
    expect(practiceFromMisses([{ noteId: 'esperanza', miss: 'confused' }], set)).toEqual([]);
  });
});

describe('linkCandidates', () => {
  const set = mixupSet(notes, all);

  it('offers sound-alikes, then lookalikes, once each', () => {
    expect(linkCandidates(set, 'esta', new Set()).map((c) => [c.word.noteId, c.why])).toEqual([['está', 'sounds close']]);
    expect(linkCandidates(set, 'esperanza', new Set()).map((c) => c.why)).toEqual(['looks close', 'looks close']);
  });

  it('leaves out words already linked, and stops at the limit', () => {
    expect(linkCandidates(set, 'esta', new Set(['está']))).toEqual([]);
    expect(linkCandidates(set, 'esperanza', new Set(), 1)).toHaveLength(1);
  });
});

describe('searchWords', () => {
  const set = mixupSet(notes, all);

  it('finds words in the language by spelling, romanization or meaning', () => {
    expect(searchWords(set, 'th', 'near', 'klai', new Set()).map((w) => w.noteId)).toEqual(['klâi']);
    expect(searchWords(set, 'th', 'nǎng', 'klai', new Set()).map((w) => w.noteId)).toEqual(['nangsue']);
    expect(searchWords(set, 'es', 'espera', 'espera', new Set()).map((w) => w.noteId)).toEqual(['esperar', 'esperanza']);
    expect(searchWords(set, 'th', 'nang', 'klai', new Set()).map((w) => w.noteId)).toEqual(['nangsue']);
  });

  it('puts the closest first, before cutting the list at its limit', () => {
    // 'wait' is aguardar's whole meaning, a listed meaning of esperar's, and only part of espera's.
    expect(searchWords(set, 'es', 'wait', 'esta', new Set()).map((w) => w.noteId)).toEqual(['aguardar', 'esperar', 'espera']);
    expect(searchWords(set, 'es', 'wait', 'esta', new Set(), 1).map((w) => w.noteId)).toEqual(['aguardar']);
    // The spelling before the meaning: 'esta' is está with its accent aside, then estar in a meaning.
    expect(searchWords(set, 'es', 'esta', 'esperar', new Set()).map((w) => w.noteId)).toEqual(['esta', 'está']);
  });

  it('leaves out the word itself, linked ones and other languages, and an empty search finds nothing', () => {
    expect(searchWords(set, 'es', 'esper', 'esperar', new Set(['esperanza'])).map((w) => w.noteId)).toEqual(['espera']);
    expect(searchWords(set, 'es', 'book', 'esta', new Set())).toEqual([]);
    expect(searchWords(set, 'es', '  ', 'esta', new Set())).toEqual([]);
  });
});
