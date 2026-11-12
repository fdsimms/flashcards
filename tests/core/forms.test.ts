import { describe, expect, it } from 'vitest';
import {
  checkAnswer, chooseForms, formsOf, formsSettings, formsSuggestion, headword, introductions, patternOf, patternPrompts,
  practiceChoices, practicePool, promptFor, sentenceGap, unreadableNotice, withoutArticle, wordPrompts, type PracticeRecord,
} from '../../src/core/forms';
import type { Note } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const DAY_START = 4;

/** A seeded random, so shuffles are the same every run. */
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const FORMS = [
  'present · yo: espero', 'present · tú: esperas', 'present · él: espera', 'present · nosotros: esperamos',
  'preterite · yo: esperé', 'preterite · tú: esperaste',
].join('<br>');

function esperar(over: Record<string, string> = {}, id = 'esperar'): Note {
  return {
    ...omniNote({ Entry: 'esperar', Meaning: 'to wait; to hope', Language: 'spanish', Context: 'Espero que vengas pronto.', ContextTranslation: 'I hope you come soon.', Forms: FORMS, VerbClass: '-ar, regular', ...over }),
    id, deck: '👅 Languages::🌮 Español',
  };
}

const at = (d: number, h = 12) => new Date(2026, 10, d, h).toISOString();
const rec = (key: string, correct: boolean, practicedAt: string, noteId = 'esperar'): PracticeRecord => ({ noteId, key, correct, practicedAt });

describe('formsOf', () => {
  it('reads one labeled form per line of the Forms field', () => {
    const { forms, unreadable } = formsOf(esperar());
    expect(forms).toHaveLength(6);
    expect(forms[0]).toEqual({ key: 'present · yo', group: 'present', label: 'yo', answers: ['espero'] });
    expect(unreadable).toEqual([]);
  });
  it('takes alternatives after a slash, a line with no group, and keeps lines it cannot read', () => {
    const { forms, unreadable } = formsOf(esperar({ Forms: 'imperfect subjunctive · yo: esperara / esperase<br>infinitive: esperar<br>no colon here<br>: lonely' }));
    expect(forms.map((f) => [f.key, f.answers])).toEqual([
      ['imperfect subjunctive · yo', ['esperara', 'esperase']],
      ['infinitive', ['esperar']],
    ]);
    expect(unreadable).toEqual(['no colon here', ': lonely']);
  });
  it("adds Omnilanguage's one-form fields, the gender as the language's article", () => {
    const tisch = omniNote({ Entry: 'der Tisch', Meaning: 'table', Language: 'german', Gender: 'm', Plural: 'die Tische' });
    const { forms } = formsOf(tisch);
    expect(forms).toEqual([
      { key: 'field:Gender', group: 'gender', label: 'gender', answers: ['der'] },
      { key: 'field:Plural', group: 'plural', label: 'plural', answers: ['die Tische', 'Tische'] },
    ]);
  });
  it('uses masculine / feminine / neuter where the language has no article table, and refuses an unknown gender', () => {
    const ru = omniNote({ Entry: 'стол', Meaning: 'table', Language: 'russian', Gender: 'm' });
    expect(formsOf(ru).forms[0].answers).toEqual(['masculine']);
    expect(formsOf(omniNote({ Gender: 'common' })).unreadable).toEqual(['Gender: common']);
  });
  it('has nothing for a note without forms, so nothing is suggested', () => {
    expect(formsOf(omniNote()).forms).toEqual([]);
  });
});

describe('withoutArticle / headword', () => {
  it('takes a leading article off, but not a word that is only an article', () => {
    expect(withoutArticle('el blindaje')).toBe('blindaje');
    expect(withoutArticle('ten pies')).toBe('pies');
    expect(withoutArticle('la')).toBe('la');
  });
  it('reads the Entry as plain text', () => {
    expect(headword(esperar({ Entry: '<b>esperar</b>' }))).toBe('esperar');
  });
});

describe('checkAnswer', () => {
  it('ignores case, spaces and a final full stop', () => {
    expect(checkAnswer('  Esperamos. ', ['esperamos'])).toBe('right');
  });
  it('calls a missing accent almost, since it is often another form', () => {
    expect(checkAnswer('espere', ['esperé'])).toBe('almost');
    expect(checkAnswer('елка', ['ёлка'])).toBe('almost');
  });
  it('accepts any of the alternatives, and nothing else', () => {
    expect(checkAnswer('esperase', ['esperara', 'esperase'])).toBe('right');
    expect(checkAnswer('esperaban', ['esperarán'])).toBe('wrong');
    expect(checkAnswer('', ['x'])).toBe('wrong');
  });
});

describe('chooseForms', () => {
  const { forms } = formsOf(esperar());
  it('asks the forms missed last time first, then never-asked ones, then the oldest', () => {
    const history = [
      rec('present · yo', true, at(1)), rec('present · tú', true, at(1)), rec('present · él', true, at(1)),
      rec('present · nosotros', true, at(5)), rec('preterite · yo', false, at(5)),
    ];
    const keys = chooseForms(forms, history, 4, DAY_START, seeded()).map((f) => f.key);
    expect(keys[0]).toBe('preterite · yo');
    expect(keys[1]).toBe('preterite · tú');
    expect(keys.slice(2)).toEqual(expect.arrayContaining([expect.stringMatching(/^present · (yo|tú|él)$/)]));
    expect(keys).not.toContain('present · nosotros');
  });
  it('forgets a miss that was put right later the same day', () => {
    const history = [rec('preterite · yo', false, at(5, 10)), rec('preterite · yo', true, at(5, 11)), rec('present · yo', true, at(5, 9))];
    const keys = chooseForms(forms, history, 6, DAY_START, seeded()).map((f) => f.key);
    expect(keys.indexOf('preterite · yo')).toBeGreaterThan(keys.indexOf('present · tú'));
  });
});

describe('promptFor', () => {
  it("offers the word's own other forms as the wrong choices, same tense first", () => {
    const note = esperar();
    const form = formsOf(note).forms.find((f) => f.key === 'present · nosotros')!;
    const p = promptFor(note, form, [], seeded());
    expect(p.choices).toHaveLength(4);
    expect(p.choices).toContain('esperamos');
    expect(p.choices!.filter((c) => c !== 'esperamos').every((c) => ['espero', 'esperas', 'espera'].includes(c))).toBe(true);
    expect(p).toMatchObject({ headword: 'esperar', meaning: 'to wait; to hope', label: 'nosotros', group: 'present' });
  });
  it('fills in from the same form of other words when the word has too few', () => {
    const tisch = { ...omniNote({ Entry: 'der Tisch', Language: 'german', Plural: 'die Tische' }), id: 'tisch' };
    const hund = { ...omniNote({ Entry: 'der Hund', Language: 'german', Plural: 'die Hunde' }), id: 'hund' };
    const chat = { ...omniNote({ Entry: 'le chat', Language: 'french', Plural: 'les chats' }), id: 'chat' };
    const pool = [tisch, hund, chat].map((n) => ({ note: n, forms: formsOf(n).forms }));
    const p = promptFor(tisch, formsOf(tisch).forms[0], pool, seeded());
    expect(p.choices).toEqual(expect.arrayContaining(['die Tische', 'die Hunde']));
    expect(p.choices).not.toContain('les chats');
  });
  it('is typed when there is nothing to pick from', () => {
    const lone = omniNote({ Entry: 'czekać', Language: 'polish', AspectPartner: 'poczekać' });
    expect(promptFor(lone, formsOf(lone).forms[0], [], seeded()).choices).toBeUndefined();
  });
  it('offers the articles for a gender, and shows the word without its own', () => {
    const tisch = omniNote({ Entry: 'der Tisch', Language: 'german', Gender: 'm' });
    const p = promptFor(tisch, formsOf(tisch).forms[0], [], seeded());
    expect(p.headword).toBe('Tisch');
    expect([...p.choices!].sort()).toEqual(['das', 'der', 'die']);
    expect(p.sentence).toBeUndefined();
  });
});

describe('sentenceGap', () => {
  it('blanks a whole-word occurrence of the answer, whatever its case', () => {
    expect(sentenceGap(esperar(), ['espero'])).toEqual({ before: '', after: ' que vengas pronto.', translation: 'I hope you come soon.' });
  });
  it('does not match inside a longer word', () => {
    expect(sentenceGap(esperar({ Context: 'Esperamos aquí.' }), ['espera'])).toBeUndefined();
  });
  it('matches anywhere in a script without spaces between words', () => {
    const th = omniNote({ Context: 'หมาสองตัว' });
    expect(sentenceGap(th, ['ตัว'])).toMatchObject({ before: 'หมาสอง', after: '' });
  });
});

describe('formsSuggestion', () => {
  const note = esperar();
  const { forms } = formsOf(note);
  const base = { note, forms, now: NOW, dayStartsAtHour: DAY_START };
  it('suggests a word met this week whose forms were never practiced', () => {
    const s = formsSuggestion({ ...base, history: [], introducedAt: new Date(2026, 10, 8, 9) });
    expect(s).toMatchObject({ reason: 'new', title: 'New this week: practice its forms?' });
    expect(s!.detail).toBe("You know what esperar means, but you haven't practiced its forms yet.");
  });
  it('says nothing for an older word never practiced, or a note without forms', () => {
    expect(formsSuggestion({ ...base, history: [], introducedAt: new Date(2026, 9, 1) })).toBeUndefined();
    expect(formsSuggestion({ ...base, forms: [], history: [], introducedAt: NOW })).toBeUndefined();
  });
  it('names the tense of a form missed last time, never the form', () => {
    const s = formsSuggestion({ ...base, history: [rec('preterite · yo', false, at(9)), rec('present · yo', true, at(9))] });
    expect(s).toEqual({ reason: 'missed', title: 'Practice its forms again?', detail: 'Last time you missed one of its preterite forms.' });
    expect(s!.detail).not.toContain('esperé');
  });
  it('suggests again after a month, and never twice in a study day', () => {
    expect(formsSuggestion({ ...base, history: [rec('present · yo', true, at(5).replace('2026-11', '2026-10'))] })?.reason).toBe('stale');
    expect(formsSuggestion({ ...base, history: [rec('present · yo', true, at(5))] })).toBeUndefined();
    expect(formsSuggestion({ ...base, history: [rec('preterite · yo', false, at(11, 9))] })).toBeUndefined();
  });
});

describe('formsSettings', () => {
  it("takes a subdeck's own setting, else the nearest ancestor's, else the default", () => {
    const all = new Map([['L', { suggestForms: false, formPrompts: 8 }], ['L::Es::Verbs', { suggestForms: true }]]);
    expect(formsSettings('L::Es', all)).toEqual({ suggest: false, prompts: 8 });
    expect(formsSettings('L::Es::Verbs', all)).toEqual({ suggest: true, prompts: 8 });
    expect(formsSettings('Other', all)).toEqual({ suggest: true, prompts: 6 });
  });
});

describe('pattern practice', () => {
  const hablar = esperar({ Entry: 'hablar', Forms: 'present · yo: hablo<br>present · tú: hablas<br>preterite · yo: hablé' }, 'hablar');
  const tener = esperar({ Entry: 'tener', VerbClass: 'irregular', Forms: 'present · yo: tengo<br>present · tú: tienes' }, 'tener');
  const words = [esperar(), hablar, tener].map((n) => ({ note: n, forms: formsOf(n).forms }));

  it('lists patterns from VerbClass and the form groups, in order', () => {
    expect(practiceChoices(words)).toEqual({ patterns: ['-ar, regular', 'irregular'], groups: ['present', 'preterite'] });
    expect(patternOf(omniNote({ PartOfSpeech: 'noun' }))).toBe('noun');
    expect(patternOf(omniNote())).toBe('other');
  });
  it('asks only the chosen patterns and groups, and spreads the words out', () => {
    const ps = patternPrompts(words, { patterns: ['-ar, regular'], groups: ['present'] }, [], 10, DAY_START, seeded());
    expect(ps).toHaveLength(6);
    expect(new Set(ps.map((p) => p.noteId))).toEqual(new Set(['esperar', 'hablar']));
    expect(ps.every((p) => p.group === 'present')).toBe(true);
    for (let i = 1; i < ps.length; i++) {
      // esperar has 4 present forms and hablar 2, so two esperar prompts in a row is unavoidable once.
      if (ps[i].noteId === ps[i - 1].noteId) expect(ps[i].noteId).toBe('esperar');
    }
  });
  it('puts forms missed last time first', () => {
    const ps = patternPrompts(words, { patterns: ['irregular'], groups: ['present'] }, [rec('present · tú', false, at(9), 'tener')], 1, DAY_START, seeded());
    expect(ps.map((p) => p.key)).toEqual(['present · tú']);
  });
});

describe('introductions', () => {
  it("takes each note's earliest first answer to a New card", () => {
    const log = (cardId: string, state: number, reviewedAt: string) => ({ cardId, rating: 3 as const, reviewedAt, state, due: '', stability: 1, difficulty: 1 });
    const out = introductions(
      [log('a:reverse', 0, at(9)), log('a:forward', 0, at(8)), log('a:forward', 2, at(7)), log('b:forward', 1, at(9))],
      new Map([['a:forward', 'a'], ['a:reverse', 'a'], ['b:forward', 'b']]),
    );
    expect(out.get('a')!.toISOString()).toBe(at(8));
    expect(out.has('b')).toBe(false);
  });
});

describe('wordPrompts', () => {
  it("asks each word's forms in turn, up to the number per word", () => {
    const hablar = esperar({ Entry: 'hablar', Forms: 'present · yo: hablo<br>present · tú: hablas' }, 'hablar');
    const ps = wordPrompts([esperar(), hablar], practicePool([esperar(), hablar]), [], 2, DAY_START, seeded());
    expect(ps.map((p) => p.noteId)).toEqual(['esperar', 'hablar', 'esperar', 'hablar']);
  });
});

describe('practicePool', () => {
  it('keeps only notes with forms', () => {
    expect(practicePool([esperar(), omniNote()]).map((w) => w.note.id)).toEqual(['esperar']);
  });
});

describe('unreadableNotice', () => {
  it("counts the lines it couldn't read, by word, and says how to write them", () => {
    expect(unreadableNotice([esperar()])).toBeUndefined();
    const notice = unreadableNotice([esperar({ Forms: 'present · yo: espero<br>espero<br>esperas' })]);
    expect(notice).toContain('(2 in esperar)');
    expect(notice).toContain('"present · yo: espero"');
  });
});
