import { describe, expect, it } from 'vitest';
import {
  againPrompts, checkAnswer, chooseForms, formGiven, formGrammar, practicedGroups, practicedGroupsLine, confusedAnswers, confusions, weakForms, formsOf, formsSettings, formsSuggestion, headword, introductions, patternOf, patternPrompts,
  practiceChoices, practicePool, promptFor, promptKeys, drillPrompts, mergeSentencePrompts, studiedWords, sentenceFor, sentenceGap, unreadableNotice, withoutArticle, wordPrompts,
  type FormPrompt, type PracticeRecord, type WordForm,
} from '../../src/core/forms';
import { newSchedState } from '../../src/core/scheduler';
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
  it("reads Norwegian's own articles as a gender, the same ones it asks for", () => {
    const bok = omniNote({ Entry: 'bok', Meaning: 'book', Language: 'norwegian', Gender: 'ei' });
    expect(formsOf(bok).unreadable).toEqual([]);
    expect(formsOf(bok).forms[0].answers).toEqual(['ei', 'en']);
    expect(formsOf(omniNote({ Entry: 'hus', Language: 'norwegian', Gender: 'et' })).forms[0].answers).toEqual(['et']);
  });
  it('accepts en as well as ei for a Norwegian feminine, the Entry\'s own first, and never offers en as wrong', () => {
    const enBok = omniNote({ Entry: 'en bok', Language: 'norwegian', Gender: 'f' });
    expect(formsOf(enBok).forms[0].answers).toEqual(['en', 'ei']);
    expect(formsOf(omniNote({ Entry: 'ei bok', Language: 'norwegian', Gender: 'f' })).forms[0].answers).toEqual(['ei', 'en']);
    for (const note of [enBok, omniNote({ Entry: 'bok', Language: 'norwegian', Gender: 'f' })]) {
      const p = promptFor(note, formsOf(note).forms[0], [], seeded());
      expect(p.headword).toBe('bok');
      expect(p.choices!.filter((c) => !p.answers.includes(c))).toEqual(['et']);
      expect(checkAnswer('ei', p.answers)).toBe('right');
      expect(checkAnswer('en', p.answers)).toBe('right');
    }
    // A masculine noun can't take ei, so it's still offered.
    const stol = omniNote({ Entry: 'en stol', Language: 'norwegian', Gender: 'm' });
    expect([...promptFor(stol, formsOf(stol).forms[0], [], seeded()).choices!].sort()).toEqual(['ei', 'en', 'et']);
  });
  it("asks the gender as a word when the Entry's own article isn't the one its gender gives", () => {
    const gender = (Entry: string, Language: string, Gender: string) => formsOf(omniNote({ Entry, Language, Gender })).forms[0].answers;
    // Feminine, but el (and un) before a stressed a.
    expect(gender('el agua', 'spanish', 'f')).toEqual(['feminine']);
    expect(gender('un águila', 'spanish', 'f')).toEqual(['feminine']);
    expect(gender('el hambre', 'spanish', 'f')).toEqual(['feminine']);
    // The article that goes with the gender, definite or not, is asked as before.
    expect(gender('la mesa', 'spanish', 'f')).toEqual(['la']);
    expect(gender('una mano', 'spanish', 'f')).toEqual(['la']);
    expect(gender('el libro', 'spanish', 'm')).toEqual(['el']);
    // French l' before a vowel, whatever the Entry shows: neither le nor la is right.
    expect(gender("l'arbre", 'french', 'm')).toEqual(['masculine']);
    expect(gender('un ami', 'french', 'm')).toEqual(['masculine']);
    expect(gender('école', 'french', 'f')).toEqual(['feminine']);
    expect(gender('le livre', 'french', 'm')).toEqual(['le']);
    // Italian: il and la as the gender gives them; lo and l' (before s + consonant, z, a vowel) as a word.
    expect(gender('il libro', 'italian', 'm')).toEqual(['il']);
    expect(gender('la casa', 'italian', 'f')).toEqual(['la']);
    expect(gender('un libro', 'italian', 'm')).toEqual(['il']);
    expect(gender('lo zaino', 'italian', 'm')).toEqual(['masculine']);
    expect(gender('lo studente', 'italian', 'm')).toEqual(['masculine']);
    expect(gender("l'amica", 'italian', 'f')).toEqual(['feminine']);
    expect(gender('le héros', 'french', 'm')).toEqual(['le']);
    // German, Greek and Polish articles always go with the gender.
    expect(gender('ein Haus', 'german', 'n')).toEqual(['das']);
    expect(gender('η γυναίκα', 'greek', 'f')).toEqual(['η']);
    expect(gender('ta córka', 'polish', 'f')).toEqual(['ta']);
  });
  it('offers the genders the language has as words, and shows the word without its misleading article', () => {
    const agua = omniNote({ Entry: 'el agua', Meaning: 'water', Language: 'spanish', Gender: 'f' });
    const p = promptFor(agua, formsOf(agua).forms[0], [], seeded());
    expect(p.headword).toBe('agua');
    expect([...p.choices!].sort()).toEqual(['feminine', 'masculine']);
    expect(p.answers).toEqual(['feminine']);
    const ru = omniNote({ Entry: 'стол', Language: 'russian', Gender: 'm' });
    expect([...promptFor(ru, formsOf(ru).forms[0], [], seeded()).choices!].sort()).toEqual(['feminine', 'masculine', 'neuter']);
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
  it('knows the Greek plural and genitive articles, French une and German ein and des', () => {
    expect(['τα παιδιά', 'οι άντρες', 'του παιδιού', 'της γυναίκας', 'των παιδιών'].map((w) => withoutArticle(w))).toEqual(['παιδιά', 'άντρες', 'παιδιού', 'γυναίκας', 'παιδιών']);
    expect(['une table', 'un livre', "l'arbre", 'l’école', 'les tables'].map((w) => withoutArticle(w))).toEqual(['table', 'livre', 'arbre', 'école', 'tables']);
    expect(['ein Tisch', 'eine Frau', 'des Tisches'].map((w) => withoutArticle(w))).toEqual(['Tisch', 'Frau', 'Tisches']);
  });
  it('takes only a whole article, never the start of a word', () => {
    const words = ['unité', 'einer', 'eines Tages', 'ταξί', 'τουρίστας', 'οικογένεια', 'desde luego'];
    expect(words.map((w) => withoutArticle(w))).toEqual(words);
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
    expect(checkAnswer('елки', ['ёлка'])).toBe('wrong');
  });
  it('takes е for ё, as Russian usually writes it', () => {
    expect(checkAnswer('елка', ['ёлка'])).toBe('right');
    expect(checkAnswer('Ёлка', ['елка'])).toBe('right');
  });
  it('calls ø, æ, œ and ł typed without the mark almost, like a missing accent', () => {
    expect(checkAnswer('brodet', ['brødet'])).toBe('almost');
    expect(checkAnswer('aerlig', ['ærlig'])).toBe('almost');
    expect(checkAnswer('soeurs', ['sœurs'])).toBe('almost');
    expect(checkAnswer('szedl', ['szedł'])).toBe('almost');
  });
  it("calls another form of the word wrong, not almost: the mark is the ending being drilled", () => {
    expect(checkAnswer('pisze', ['piszę'], ['pisze', 'piszesz'])).toBe('wrong');
    expect(checkAnswer('pisze', ['piszę'])).toBe('almost');
    expect(checkAnswer('piszę', ['piszę'], ['pisze'])).toBe('right');
  });
  it("folds what the keyboard decides: a final σ, ss for ß, a curly apostrophe", () => {
    expect(checkAnswer('παιδιασ', ['παιδιάς'])).toBe('almost');
    expect(checkAnswer('παιδιάσ', ['παιδιάς'])).toBe('right');
    expect(checkAnswer('ass', ['aß'])).toBe('right');
    expect(checkAnswer('j’espère', ["j'espère"])).toBe('right');
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
    const keys = chooseForms(forms, history, DAY_START, 4, seeded()).map((f) => f.key);
    expect(keys[0]).toBe('preterite · yo');
    expect(keys[1]).toBe('preterite · tú');
    expect(keys.slice(2)).toEqual(expect.arrayContaining([expect.stringMatching(/^present · (yo|tú|él)$/)]));
    expect(keys).not.toContain('present · nosotros');
  });
  it('keeps asking a miss from days ago until it is put right twice', () => {
    const base = [rec('preterite · yo', false, at(1)), rec('present · yo', true, at(5)), rec('present · tú', true, at(5))];
    const first = (history: PracticeRecord[]) => chooseForms(forms, history, DAY_START, 6, seeded()).map((f) => f.key)[0];
    expect(first(base)).toBe('preterite · yo');
    expect(first([...base, rec('preterite · yo', true, at(5))])).toBe('preterite · yo');
    const cleared = chooseForms(forms, [...base, rec('preterite · yo', true, at(5)), rec('preterite · yo', true, at(6))], DAY_START, 6, seeded()).map((f) => f.key);
    expect(cleared[0]).not.toBe('preterite · yo');
  });
  it('asks the form missed most often first', () => {
    const history = [rec('present · yo', false, at(5)), rec('present · tú', false, at(4)), rec('present · tú', false, at(5))];
    expect(chooseForms(forms, history, DAY_START, 2, seeded()).map((f) => f.key)).toEqual(['present · tú', 'present · yo']);
  });
  it('asks forms whose answer is often confused before forms never asked', () => {
    const tisch = omniNote({ Entry: 'der Tisch', Language: 'german', Gender: 'm', Plural: 'die Tische' });
    const { forms: f } = formsOf(tisch);
    const keys = chooseForms(f, [], DAY_START, 2, seeded(), new Set(['der'])).map((x) => x.key);
    expect(keys[0]).toBe('field:Gender');
  });
});

describe('weakForms', () => {
  it('owes two right answers per miss, and counts up while misses keep coming', () => {
    expect([...weakForms([rec('a', false, at(1))], DAY_START)]).toEqual([['a', 2]]);
    expect([...weakForms([rec('a', false, at(1)), rec('a', true, at(2))], DAY_START)]).toEqual([['a', 1]]);
    expect([...weakForms([rec('a', false, at(1)), rec('a', false, at(2))], DAY_START)]).toEqual([['a', 4]]);
    expect(weakForms([rec('a', false, at(1)), rec('a', true, at(2)), rec('a', true, at(3))], DAY_START).size).toBe(0);
  });
  it('reads the history in time order whatever order it is given', () => {
    expect(weakForms([rec('a', true, at(3)), rec('a', false, at(1)), rec('a', true, at(2))], DAY_START).size).toBe(0);
  });

  const t = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();
  it('takes nothing off for a right answer straight after a miss the same study day', () => {
    // The retry at the end of the drill, with the answer just seen.
    expect([...weakForms([rec('a', false, t(11, 12)), rec('a', true, t(11, 12, 5))], DAY_START)]).toEqual([['a', 2]]);
    // The right answer after it counts, the same day or later: two of them still clear the miss.
    const retried = [rec('a', false, t(11, 12)), rec('a', true, t(11, 12, 5)), rec('a', true, t(11, 18))];
    expect([...weakForms(retried, DAY_START)]).toEqual([['a', 1]]);
    expect(weakForms([...retried, rec('a', true, t(12, 9))], DAY_START).size).toBe(0);
  });
  it('looks only at the same form for what came before', () => {
    const history = [rec('a', false, t(11, 12)), rec('b', true, t(11, 12, 1)), rec('a', true, t(11, 12, 2))];
    expect([...weakForms(history, DAY_START)]).toEqual([['a', 2]]);
  });
  it('takes the study day from the collection, not midnight', () => {
    // 1 a.m. still belongs to the day before, so it's a same-day retry.
    expect([...weakForms([rec('a', false, t(11, 23)), rec('a', true, t(12, 1))], DAY_START)]).toEqual([['a', 2]]);
    // A miss at 3 a.m. and a right answer at 5 a.m. fall on two study days, unless the day starts at 6.
    expect([...weakForms([rec('a', false, t(12, 3)), rec('a', true, t(12, 5))], DAY_START)]).toEqual([['a', 1]]);
    expect([...weakForms([rec('a', false, t(12, 3)), rec('a', true, t(12, 5))], 6)]).toEqual([['a', 2]]);
  });
});

describe('againPrompts', () => {
  const note = esperar();
  const prompts = formsOf(note).forms.map((f) => promptFor(note, f, [], seeded()));
  it('moves each answer to another place among the same choices', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const again = againPrompts(prompts, seeded(seed));
      again.forEach((p, i) => {
        const before = prompts[i];
        expect(p).not.toBe(before);
        expect([...p.choices!].sort()).toEqual([...before.choices!].sort());
        expect(p.choices!.indexOf(p.answers[0])).not.toBe(before.choices!.indexOf(before.answers[0]));
        expect({ ...p, choices: undefined }).toEqual({ ...before, choices: undefined });
      });
    }
  });
  it('leaves a typed prompt as it is', () => {
    const lone = omniNote({ Entry: 'czekać', Language: 'polish', AspectPartner: 'poczekać' });
    const typed = promptFor(lone, formsOf(lone).forms[0], [], seeded());
    const [again] = againPrompts([typed], seeded());
    expect(again).toEqual(typed);
    expect(again).not.toBe(typed); // a new prompt, so the drill logs its answer afresh
  });
});

describe('confusions', () => {
  const noun = (id: string, gender: string) => omniNote({ Entry: id, Language: 'polish', Gender: gender });
  const words = [['a', 'f'], ['b', 'f'], ['c', 'f'], ['d', 'm']].map(([id, g]) => ({ note: { ...noun(id, g), id }, forms: formsOf(noun(id, g)).forms }));
  const miss = (noteId: string, given: string, day: number): PracticeRecord => ({ noteId, key: 'field:Gender', correct: false, practicedAt: at(day), given });

  it('finds the same wrong answer for the same right one across several words', () => {
    const list = confusions([miss('a', 'ten', 1), miss('b', 'ten', 2), miss('c', 'Ten ', 3), miss('d', 'ta', 3)], words);
    expect(list).toEqual([{ kind: 'answer', expected: 'ta', given: 'ten', misses: 3, words: 3, lastAt: at(3) }]);
    expect(confusedAnswers(list)).toEqual(new Set(['ta']));
  });

  describe('between forms', () => {
    const verb = (id: string, preterite: string, subjunctive: string) => {
      const note = esperar({ Entry: id, Forms: [
        `preterite · yo: ${preterite}`, `present subjunctive · yo: ${subjunctive}`, `present subjunctive · él: ${subjunctive}`, `present · yo: ${id.slice(0, -2)}o`,
      ].join('<br>') }, id);
      return { note, forms: formsOf(note).forms };
    };
    const verbs = [verb('hablar', 'hablé', 'hable'), verb('esperar', 'esperé', 'espere'), verb('mirar', 'miré', 'mire')];
    const wrong = (noteId: string, given: string, day: number, key = 'preterite · yo'): PracticeRecord => ({ noteId, key, correct: false, practicedAt: at(day), given });

    it("finds another form of each word given for the one asked, though the answers differ from word to word", () => {
      const history = [wrong('hablar', 'hable', 1), wrong('esperar', 'espere', 2), wrong('mirar', 'mire', 3), wrong('hablar', 'Hable', 4)];
      // The answers differ word to word, so no "answer" mix-up shows; the forms do. Spelled like
      // "· él" as well, it's taken for the person asked.
      expect(confusions(history, verbs)).toEqual([
        { kind: 'form', expected: 'preterite · yo', given: 'present subjunctive · yo', misses: 4, words: 3, lastAt: at(4) },
      ]);
    });
    it('needs enough misses on more than one word, and a wrong answer that is one of the forms', () => {
      expect(confusions([wrong('hablar', 'hable', 1), wrong('esperar', 'espere', 2)], verbs)).toEqual([]);
      expect(confusions([wrong('hablar', 'hable', 1), wrong('hablar', 'hable', 2), wrong('hablar', 'hable', 3)], verbs)).toEqual([]);
      expect(confusions([wrong('hablar', 'hablaba', 1), wrong('esperar', 'esperaba', 2), wrong('mirar', 'miraba', 3)], verbs)).toEqual([]);
    });
    it('asks the form mixed up sooner, in every word', () => {
      const list = confusions([wrong('hablar', 'hable', 1), wrong('esperar', 'espere', 2), wrong('mirar', 'mire', 3)], verbs);
      const tener = verb('tener', 'tuve', 'tenga');
      for (let seed = 1; seed <= 10; seed++) {
        expect(chooseForms(tener.forms, [], DAY_START, 1, seeded(seed), confusedAnswers(list)).map((f) => f.key)).toEqual(['preterite · yo']);
      }
    });
  });
  it('needs enough misses on more than one word, and an answer that was kept', () => {
    expect(confusions([miss('a', 'ten', 1), miss('b', 'ten', 2)], words)).toEqual([]);
    expect(confusions([miss('a', 'ten', 1), miss('a', 'ten', 2), miss('a', 'ten', 3)], words)).toEqual([]);
    const noGiven = (id: string): PracticeRecord => ({ noteId: id, key: 'field:Gender', correct: false, practicedAt: at(1) });
    expect(confusions([noGiven('a'), noGiven('b'), noGiven('c')], words)).toEqual([]);
  });
  it('ignores a right answer that only differs in how it was written', () => {
    const right = (id: string): PracticeRecord => ({ noteId: id, key: 'field:Gender', correct: false, practicedAt: at(1), given: 'TA' });
    expect(confusions([right('a'), right('b'), right('c')], words)).toEqual([]);
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
  it("names the word's other forms, so a wrong answer can say which one it was", () => {
    const note = esperar();
    const p = promptFor(note, formsOf(note).forms.find((f) => f.key === 'present · nosotros')!, [], seeded());
    expect(p.otherForms).toContainEqual({ text: 'espero', name: 'present · yo' });
    expect(p.otherForms!.some((o) => o.text === 'esperamos')).toBe(false);
    expect(formGiven('Espero', p)).toBe('present · yo');
    expect(formGiven('esperamos', p)).toBeUndefined();
    expect(formGiven('xyz', p)).toBeUndefined();
  });
  it('names a form with no group of its own by its label, and takes a wrong answer for the asked person first', () => {
    const note = esperar({ Forms: 'infinitive: esperar<br>preterite · yo: esperé<br>present subjunctive · él: espere<br>present subjunctive · yo: espere' });
    const p = promptFor(note, formsOf(note).forms[1], [], seeded());
    expect(p.otherForms).toContainEqual({ text: 'esperar', name: 'infinitive' });
    expect(formGiven('espere', p)).toBe('present subjunctive · yo');
  });
  it('reads the right answer aloud in the note\'s language, a gender with its word, and nothing it can\'t say', () => {
    const note = esperar();
    expect(promptFor(note, formsOf(note).forms[0], [], seeded()).say).toEqual({ text: 'espero', lang: 'es-MX' });
    const mesa = omniNote({ Entry: 'la mesa', Language: 'spanish', Gender: 'f' });
    expect(promptFor(mesa, formsOf(mesa).forms[0], [], seeded()).say).toEqual({ text: 'la mesa', lang: 'es-MX' });
    // A gender asked as a word is English, not the note's language.
    const agua = omniNote({ Entry: 'el agua', Language: 'spanish', Gender: 'f' });
    expect(promptFor(agua, formsOf(agua).forms[0], [], seeded()).say).toBeUndefined();
    const unknown = { ...esperar({ Language: 'klingon' }), deck: 'Other' };
    expect(promptFor(unknown, formsOf(unknown).forms[0], [], seeded()).say).toBeUndefined();
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
    const table = omniNote({ Entry: 'une table', Language: 'french', Gender: 'f' });
    expect(promptFor(table, formsOf(table).forms[0], [], seeded()).headword).toBe('table');
  });
  it('accepts a listed form without its article', () => {
    const paidi = omniNote({ Entry: 'το παιδί', Language: 'greek', Gender: 'n', Plural: 'τα παιδιά' });
    const plural = formsOf(paidi).forms.find((f) => f.key === 'field:Plural')!;
    expect(checkAnswer('παιδιά', plural.answers)).toBe('right');
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
    expect(s).toMatchObject({ reason: 'new', title: 'New this week: practice its grammar?' });
    expect(s!.detail).toBe("You know what esperar means, but you haven't practiced its grammar yet.");
  });
  it('says nothing for an older word never practiced, or a note without forms', () => {
    expect(formsSuggestion({ ...base, history: [], introducedAt: new Date(2026, 9, 1) })).toBeUndefined();
    expect(formsSuggestion({ ...base, forms: [], history: [], introducedAt: NOW })).toBeUndefined();
  });
  it('names the tense of a form missed last time, never the form', () => {
    const s = formsSuggestion({ ...base, history: [rec('preterite · yo', false, at(9)), rec('present · yo', true, at(9))] });
    expect(s).toEqual({ reason: 'missed', title: 'Practice its grammar again?', detail: 'Last time you missed one of its preterite forms.' });
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
    const ps = patternPrompts(words, { patterns: ['-ar, regular'], groups: ['present'] }, [], DAY_START, 10, seeded());
    expect(ps).toHaveLength(6);
    expect(new Set(ps.map((p) => p.noteId))).toEqual(new Set(['esperar', 'hablar']));
    expect(ps.every((p) => p.group === 'present')).toBe(true);
    for (let i = 1; i < ps.length; i++) {
      // esperar has 4 present forms and hablar 2, so two esperar prompts in a row is unavoidable once.
      if (ps[i].noteId === ps[i - 1].noteId) expect(ps[i].noteId).toBe('esperar');
    }
  });
  it('puts forms still owed right answers first', () => {
    const ps = patternPrompts(words, { patterns: ['irregular'], groups: ['present'] }, [rec('present · tú', false, at(9), 'tener')], DAY_START, 1, seeded());
    expect(ps.map((p) => p.key)).toEqual(['present · tú']);
  });
  it('then asks the form asked longest ago', () => {
    const history = [rec('present · yo', true, at(9), 'tener'), rec('present · tú', true, at(2), 'tener')];
    for (let seed = 1; seed <= 20; seed++) {
      const ps = patternPrompts(words, { patterns: ['irregular'], groups: ['present'] }, history, DAY_START, 1, seeded(seed * 7919));
      expect(ps.map((p) => p.key)).toEqual(['present · tú']);
    }
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
    const ps = wordPrompts([esperar(), hablar], practicePool([esperar(), hablar]), [], DAY_START, 2, seeded());
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

describe('drillPrompts', () => {
  const hablar = esperar({ Entry: 'hablar', Forms: 'present · yo: hablo<br>present · tú: hablas', Context: 'Hablo poco.' }, 'hablar');
  const notes = [esperar(), hablar];
  const studied = (noteId: string) => ({ id: `${noteId}:forward`, noteId, kind: 'forward' as const, suspended: false, retired: false, sched: { ...newSchedState(NOW), state: 2 } });
  const data = { notes, cards: [studied('esperar')], practice: [], dayStartsAtHour: DAY_START };

  it("asks the words named, up to the number per word", () => {
    const { prompts } = drillPrompts({ kind: 'words', noteIds: ['hablar', 'gone'], perWord: 6 }, data, seeded());
    expect(prompts.map((p) => p.noteId)).toEqual(['hablar', 'hablar']);
  });
  it('practices a pattern with studied words only, and in a sentence only forms the sentence holds', () => {
    const request = { kind: 'pattern' as const, deck: '👅 Languages', patterns: ['-ar, regular'], groups: ['present'], sentence: false };
    expect(new Set(drillPrompts(request, data, seeded()).prompts.map((p) => p.noteId))).toEqual(new Set(['esperar']));
    const both = { ...data, cards: [studied('esperar'), studied('hablar')] };
    const inSentence = drillPrompts({ ...request, sentence: true }, both, seeded()).prompts;
    expect(inSentence.map((p) => p.key).sort()).toEqual(['present · yo', 'present · yo']);
    expect(inSentence.every((p) => p.sentence)).toBe(true);
  });
  it('asks forms that would show the same sentence with the same answer once, logged under each', () => {
    const espera = esperar({
      Context: 'Ella esperaba el autobús.',
      Forms: 'imperfect · yo: esperaba<br>imperfect · él: esperaba<br>imperfect · tú: esperabas<br>present · él: espera',
    });
    const request = { kind: 'pattern' as const, deck: '👅 Languages', patterns: ['-ar, regular'], groups: ['imperfect', 'present'], sentence: true };
    const { prompts } = drillPrompts(request, { ...data, notes: [espera] }, seeded());
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ group: 'imperfect', answers: ['esperaba'], sentence: { before: 'Ella ', after: ' el autobús.' } });
    expect(['yo / él', 'él / yo']).toContain(prompts[0].label);
    expect([...promptKeys(prompts[0])].sort()).toEqual(['imperfect · yo', 'imperfect · él']);
    // A limit counts the prompts asked, not the forms they stand for.
    expect(drillPrompts({ ...request, limit: 1 }, { ...data, notes: [espera] }, seeded()).prompts).toHaveLength(1);
  });
  it("shows no sentence outside \"In a sentence\" for a form whose answer another form shares, but merged in it does", () => {
    const espera = esperar({
      Context: 'Ella esperaba el autobús.',
      Forms: 'imperfect · yo: esperaba<br>imperfect · él: esperaba<br>imperfect · tú: esperabas',
    });
    const request = { kind: 'pattern' as const, deck: '👅 Languages', patterns: ['-ar, regular'], groups: ['imperfect'], sentence: false };
    const picked = drillPrompts(request, { ...data, notes: [espera] }, seeded()).prompts;
    expect(picked.map((p) => p.key).sort()).toEqual(['imperfect · tú', 'imperfect · yo', 'imperfect · él']);
    expect(picked.every((p) => !p.sentence)).toBe(true);
    const words = drillPrompts({ kind: 'words', noteIds: ['esperar'], perWord: 6 }, { ...data, notes: [espera] }, seeded()).prompts;
    expect(words.filter((p) => p.key !== 'imperfect · tú').every((p) => !p.sentence)).toBe(true);
    const [merged] = drillPrompts({ ...request, sentence: true }, { ...data, notes: [espera] }, seeded()).prompts;
    expect(merged.sentence).toMatchObject({ before: 'Ella ', after: ' el autobús.' });
    expect([...promptKeys(merged)].sort()).toEqual(['imperfect · yo', 'imperfect · él']);
  });
  it('keeps the sentence for a form no other form shares, and ignores fields', () => {
    const note = esperar({ Context: 'Ella esperaba el autobús.', Forms: 'imperfect · él: esperaba<br>imperfect · tú: esperabas', Plural: 'esperaba' });
    const { forms } = formsOf(note);
    const el = forms.find((f) => f.key === 'imperfect · él')!;
    expect(sentenceFor(note, el, forms)).toMatchObject({ before: 'Ella ', after: ' el autobús.' });
    expect(promptFor(note, el, [], seeded()).sentence).toMatchObject({ before: 'Ella ' });
    // Shared only by an alternative that isn't the word in the gap: the gap still says which form it is.
    const subj = esperar({ Context: 'Ojalá esperase.', Forms: 'imperfect subjunctive · yo: esperara / esperase<br>imperfect subjunctive · nosotros: esperáramos<br>past · x: esperara' });
    const yo = formsOf(subj).forms[0];
    expect(sentenceFor(subj, yo, formsOf(subj).forms)).toMatchObject({ before: 'Ojalá ', after: '.' });
  });
  it('names each form in full when the forms merged are of different groups, and leaves other words alone', () => {
    const p = (noteId: string, key: string, answers: string[]): FormPrompt => {
      const [group, label] = key.split(' · ');
      return { noteId, key, headword: noteId, meaning: '', label, group, answers, sentence: { before: 'Ya ', after: '.' } };
    };
    const merged = mergeSentencePrompts([
      p('a', 'present · él', ['espera']), p('b', 'present · él', ['espera']), p('a', 'imperative · tú', ['Espera']), p('a', 'present · yo', ['espero']),
    ]);
    expect(merged.map((x) => [x.noteId, x.label, x.group, promptKeys(x)])).toEqual([
      ['a', 'present · él / imperative · tú', '', ['present · él', 'imperative · tú']],
      ['b', 'él', 'present', ['present · él']],
      ['a', 'yo', 'present', ['present · yo']],
    ]);
    // A prompt with no sentence is never merged.
    const bare = { ...p('a', 'present · él', ['espera']), sentence: undefined };
    expect(mergeSentencePrompts([bare, bare])).toHaveLength(2);
  });
  it('caps a pattern drill only when asked to', () => {
    const request = { kind: 'pattern' as const, deck: '👅 Languages', patterns: ['-ar, regular'], groups: ['present'], sentence: false };
    const all = drillPrompts(request, data, seeded()).prompts.length;
    expect(all).toBeGreaterThan(1);
    expect(drillPrompts({ ...request, limit: 1 }, data, seeded()).prompts).toHaveLength(1);
    expect(drillPrompts({ ...request, limit: 99 }, data, seeded()).prompts).toHaveLength(all);
  });
  it('lists studied words in a deck and its subdecks', () => {
    expect(studiedWords('👅 Languages', notes, [studied('hablar')]).map((w) => w.note.id)).toEqual(['hablar']);
    expect(studiedWords('Other', notes, [studied('hablar')])).toEqual([]);
  });
});

describe('grammar points in forms practice (docs/grammar.md)', () => {
  const preterite = new Set(['es.preterite']);
  const { forms } = formsOf(esperar());

  it("knows a form's grammar point from its group in the note's language", () => {
    expect(formGrammar(esperar(), forms[4])?.id).toBe('es.preterite');
    expect(formGrammar(esperar(), forms[0])).toBeUndefined(); // the present has no point
    const tisch = omniNote({ Entry: 'der Tisch', Language: 'german', Plural: 'die Tische' });
    expect(formGrammar(tisch, formsOf(tisch).forms[0])).toBeUndefined(); // a field, not a group
  });

  it('names the grammar point on the prompt, for after the answer', () => {
    const p = promptFor(esperar(), forms[4], [], seeded());
    expect(p.grammar).toEqual({ id: 'es.preterite', name: 'Preterite', note: 'Finished past events: hablé, comió, fueron' });
    expect(promptFor(esperar(), forms[0], [], seeded()).grammar).toBeUndefined();
  });

  it("asks a practiced point's forms after the ones still owed, before the rest", () => {
    const practiced = (f: WordForm) => f.group === 'preterite';
    expect(chooseForms(forms, [], DAY_START, 2, seeded(), new Set(), practiced).map((f) => f.group)).toEqual(['preterite', 'preterite']);
    // A form still owed right answers comes first all the same.
    const keys = chooseForms(forms, [rec('present · él', false, at(5))], DAY_START, 3, seeded(), new Set(), practiced).map((f) => f.key);
    expect(keys).toEqual(['present · él', expect.stringMatching(/^preterite/), expect.stringMatching(/^preterite/)]);
  });

  it("asks a drill's practiced forms first, by the choices passed in, and not without them", () => {
    const data = { notes: [esperar()], cards: [], practice: [], dayStartsAtHour: DAY_START };
    const request = { kind: 'words' as const, noteIds: ['esperar'], perWord: 2 };
    const groups = (practicing?: Set<string>) => drillPrompts(request, { ...data, practicing }, seeded()).prompts.map((p) => p.key.split(' · ')[0]);
    expect(groups(preterite)).toEqual(['preterite', 'preterite']);
    expect(groups(new Set(['es.future', 'pl.past']))).not.toEqual(['preterite', 'preterite']);
  });

  it('starts the practice screen with the practiced kinds of form, and says why', () => {
    const words = practicePool([esperar()]);
    expect(practicedGroups(words, new Set())).toEqual({ groups: [], points: [] });
    const chosen = practicedGroups(words, new Set(['es.preterite', 'es.future']));
    expect(chosen.groups).toEqual(['preterite']); // esperar lists no future forms
    expect(practicedGroupsLine(chosen.points)).toBe("Chosen because you're practicing the preterite in Read & Listen.");
  });

  it('names several points in one line, each once across languages', () => {
    const czekac = { ...omniNote({ Entry: 'czekać', Language: 'polish', Forms: 'past · on: czekał' }), id: 'czekac' };
    const ждать = { ...omniNote({ Entry: 'ждать', Language: 'russian', Forms: 'past · он: ждал' }), id: 'zhdat' };
    const words = practicePool([esperar(), czekac, ждать]);
    const chosen = practicedGroups(words, new Set(['es.preterite', 'pl.past', 'ru.past']));
    expect(chosen.groups).toEqual(['preterite', 'past']);
    expect(practicedGroupsLine(chosen.points)).toBe("Chosen because you're practicing the preterite and the past tense in Read & Listen.");
    expect(practicedGroupsLine([])).toBeUndefined();
  });
});

describe('withoutArticle with a language', () => {
  it("takes only that language's articles", () => {
    expect(withoutArticle('en fait', 'fr-FR')).toBe('en fait');
    expect(withoutArticle('a pesar', 'es')).toBe('a pesar');
    expect(withoutArticle('en bok', 'nb-NO')).toBe('bok');
    expect(withoutArticle('el blindaje', 'es-MX')).toBe('blindaje');
    expect(withoutArticle("l'arbre", 'fr')).toBe('arbre');
  });
  it('takes any article for a language with no list, or none given', () => {
    expect(withoutArticle('to wait', 'en-US')).toBe('wait');
    expect(withoutArticle('en fait')).toBe('fait');
  });
});
