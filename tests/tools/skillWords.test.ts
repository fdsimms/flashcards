import { describe, expect, it } from 'vitest';
import type { Language } from '../../src/reader/api';
import { DRILL_STEPS, drawQuestion, drillAnswer, hasDrills, type DrillQuestion, type DrillStep } from '../../src/tools/skills';
import {
  DIGIT_WORDS, groupWords, knownDays, knownMonths, MIN_MONTHS, MIN_ORDINALS, MONTH_MEANINGS, MONTH_WORDS, ORDINAL_DAY_WORDS, SKILL_WORD_NOTE_TYPE, stepNeeds, stillNeeded, WEEKDAY_MEANINGS, WEEKDAY_WORDS, WORD_SETS, wordDrafts,
} from '../../src/tools/skillWords';
import { weekdayOf } from '../../src/tools/date';
import { DATE_SAYERS } from '../../src/tools/tools';

const LANGUAGES = Object.keys(DATE_SAYERS) as Language[];

/** Everything a drill says for a question, lowercased, so a word can be looked for in it. */
function said(q: DrillQuestion, language: Language): string {
  const a = drillAnswer(q, language);
  if (!a) return '';
  return plain([a.everyday, ...a.also, ...(a.last ? [a.last.phrase] : [])].map((p) => `${p.text} ${p.roman ?? ''}`).join(' | '));
}

/** Lowercase, and without Greek's accents, which move when a word is inflected (ιανουάριος, ιανουαρίου). */
const plain = (s: string) => s.normalize('NFD').replace(/(?<=[\u0370-\u03ff][\u0300-\u036f]*)[\u0300-\u036f]/g, '').normalize('NFC').toLowerCase();

/** A word's start: a drill says "marca" and "рублей" for "marzec" and "рубль", so only the first letters are compared. Enough to catch a wrong word. */
const stem = (w: string) => plain(w).slice(0, Math.min(3, Math.max(1, w.length - 1)));

const date = (month: number, day: number, year = 2026): DrillQuestion => ({ kind: 'date', date: { year, month, day }, parts: { weekday: true, year: false } });
const number = (n: number): DrillQuestion => ({ kind: 'number', question: { kind: 'number', n } });

describe('the word lists', () => {
  it('give twelve months, seven weekdays and ten numbers for every language that has date drills', () => {
    expect(LANGUAGES.length).toBeGreaterThan(0);
    for (const l of LANGUAGES) {
      for (const [list, size] of [[MONTH_WORDS, 12], [WEEKDAY_WORDS, 7], [DIGIT_WORDS, 10]] as const) {
        expect(list[l], l).toHaveLength(size);
        expect(new Set(list[l]).size, l).toBe(size);
      }
    }
    expect(MONTH_MEANINGS[1]).toBe('February');
    expect(WEEKDAY_MEANINGS[0]).toBe('Sunday');
  });

  it('are the words the drills say, in every language', () => {
    for (const l of LANGUAGES) {
      MONTH_WORDS[l]!.forEach((w, i) => expect(said(date(i + 1, 20), l), `${l} month ${i + 1}`).toContain(stem(w)));
      // The weekdays: find a date on each.
      for (let d = 0; d < 7; d++) {
        const day = Array.from({ length: 7 }, (_, k) => k + 1).find((k) => weekdayOf({ year: 2026, month: 3, day: k }) === d)!;
        expect(said(date(3, day), l), `${l} weekday ${d}`).toContain(stem(WEEKDAY_WORDS[l]![d]));
      }
      DIGIT_WORDS[l]!.forEach((w, i) => expect(said(number(i + 1), l), `${l} number ${i + 1}`).toContain(stem(w)));
      const words = groupWords('numbers', l);
      expect(said(number(100), l), `${l} hundred`).toContain(stem(words.find((w) => w.meaning === 'hundred')!.entry));
      expect(said(number(2000), l), `${l} thousand`).toContain(stem(words.find((w) => w.meaning === 'thousand')!.entry));
      const time = (hour: number, minute: number): DrillQuestion => ({ kind: 'time', time: { hour, minute } });
      const half = groupWords('time', l).find((w) => w.meaning === 'half');
      if (half) expect(said(time(3, 30), l), `${l} half`).toContain(stem(half.entry));
      // The word is written to the deck with its own part of speech: wpół is an adverb, not an adjective.
      if (half && l === 'pl') expect(half.pos).toBe('adverb');
      const quarter = groupWords('time', l).find((w) => w.meaning === 'quarter');
      if (quarter) expect(said(time(3, 15), l) + said(time(3, 45), l), `${l} quarter`).toContain(stem(quarter.entry));
      const currency = groupWords('money', l).find((w) => !w.pos);
      expect(currency, `${l} currency`).toBeDefined();
      expect(said({ kind: 'money', amount: 1500 }, l), `${l} currency`).toContain(stem(currency!.entry));
    }
  });
});

/** A word's first letters, accents off: the drills say it declined, so only its start is compared. */
const TEEN_NB = ['elleve', 'tolv', 'tretten', 'fjorten', 'femten', 'seksten', 'sytten', 'atten', 'nitten'];
const TENS_NB = ['tjue', 'tretti', 'førti', 'femti', 'seksti', 'sytti', 'åtti', 'nitti'];
const stem4 = (w: string) => plain(w).slice(0, w.length <= 4 ? Math.max(1, w.length - 1) : Math.min(4, w.length - 2));

/** Every answer a step's drill gives in `language` over many seeded draws (time and money draw from a few thousand questions). */
function answersOf(step: DrillStep, language: Language): string {
  let state = 12345;
  const random = () => { state = (state * 16807) % 2147483647; return state / 2147483647; };
  const out = new Set<string>();
  let previous: DrillQuestion | undefined;
  for (let i = 0; i < 4000; i++) {
    previous = drawQuestion(step, previous, random, language);
    out.add(said(previous, language));
  }
  return [...out].join(' | ');
}

describe('the words every drill step waits for', () => {
  const steps = DRILL_STEPS.flatMap((step) => (Object.keys(DATE_SAYERS) as Language[]).filter((l) => hasDrills(step.group, l)).map((l) => [step, l] as const));

  it('are said in that step\'s answers, in every language (so no step waits for a word it never says)', { timeout: 60_000 }, () => {
    let checked = 0;
    for (const [step, language] of steps) {
      const answers = answersOf(step, language);
      // The number words are gated on every step that says a number, though a step says only some of them; the months and weekdays are checked above.
      for (const need of stepNeeds(step.id, language).filter((n) => !['number words', 'month names', 'weekday names'].includes(n.label))) {
        for (const word of need.words) {
          expect(answers, `${language} ${step.id}: ${need.label}, ${word}`).toContain(stem4(word));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(600);
  });

  it('only name steps that exist', () => {
    const ids = new Set(DRILL_STEPS.map((s) => s.id));
    for (const set of WORD_SETS) {
      for (const id of [...set.steps, ...Object.values(set.extraSteps ?? {}).flat()]) expect(ids.has(id), `${set.label}: ${id}`).toBe(true);
      for (const [l, words] of Object.entries(set.words)) expect(new Set(words!.map((w) => w.entry)).size, `${set.label} ${l}`).toBe(words!.length);
    }
  });

  it('leave no word of a language\'s drills unnamed: whatever the first answers of a group say is waited for or already a word of the language', () => {
    // Spot checks of words that were once missing: a day, a teen, a ten, a time word and a price word, each in the first step it is said.
    const first = (language: Language, step: string, word: string) =>
      expect(stepNeeds(step, language).some((n) => n.words.includes(word)), `${language} ${step} ${word}`).toBe(true);
    first('nb', 'dates-day', 'tiende');
    first('nb', 'numbers-99', 'tjue');
    first('de', 'time-quarters', 'nach');
    first('es', 'time-hours', 'la');
    first('fr', 'time-quarters', 'moins');
    first('el', 'time-quarters', 'παρά');
    first('th', 'time-hours', 'ตี');
    first('ja', 'dates-day', '日');
    first('pl', 'time-hours', 'trzeci');
    first('ru', 'time-hours', 'час');
  });
});

describe('the days a learner knows', () => {
  const dayLanguages = ['nb', 'de', 'pl', 'ru', 'es', 'fr', 'el', 'th', 'ja'] as const;
  const allWords = (l: Language) => WORD_SETS.flatMap((set) => set.words[l] ?? []).map((w) => w.entry);

  it('are none for a language whose days are not gated, and all of them once every word is known', () => {
    expect(knownDays('en', ['first'])).toEqual([]);
    for (const l of dayLanguages) expect(knownDays(l, allWords(l)), l).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });

  it('are exactly the days whose pieces are in the answer: every piece of every day is said', () => {
    for (const l of dayLanguages) {
      for (let day = 1; day <= 31; day++) {
        const text = said(date(3, day), l);
        // A day is known when every word it is said with is; one word known at a time shows which pieces a day has.
        const pieces = allWords(l).filter((w) => knownDays(l, [w]).includes(day));
        for (const piece of pieces) expect(text, `${l} day ${day}: ${piece}`).toContain(stem4(piece));
      }
    }
  });

  it('are the days of the ordinals known, with the tens for the twenties', () => {
    const ordinals = ORDINAL_DAY_WORDS.nb!;
    expect(knownDays('nb', [])).toEqual([]);
    expect(knownDays('nb', ordinals.slice(0, 10))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(knownDays('nb', [...ordinals.slice(0, 10), 'tjue'])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
    expect(knownDays('nb', ['første', 'tretti'])).toEqual([1, 31]);
    expect(knownDays('nb', ['tjuende', 'trettiende'])).toEqual([20, 30]);
    expect(knownDays('pl', ['pierwszy'])).toEqual([1]);
    expect(knownDays('es', ['primero', 'dos', 'veinte'])).toEqual([1, 2, 20]);
    expect(knownDays('ja', ['十日', '日', '十', '一', '三'])).toEqual([10, 11, 13, 30, 31]);
  });
});

describe('writing the words as notes', () => {
  it('writes each as a note of the deck\'s own type, tagged so Review brings some up', () => {
    const drafts = wordDrafts('nb', ['dates']);
    expect(drafts).toHaveLength(70);
    expect(drafts[1]).toEqual({ fields: { Entry: 'februar', Meaning: 'February', Language: 'norwegian', PartOfSpeech: 'noun', GenerateReverse: 'y' }, tags: ['skill::words'] });
    expect(drafts[12].fields).toMatchObject({ Entry: 'søndag', Meaning: 'Sunday' });
    expect(SKILL_WORD_NOTE_TYPE).toBe('Omnilanguage');
    expect(wordDrafts('en', ['dates'])).toEqual([]);
  });

  it('writes a word two skills need once, with the part of speech it has', () => {
    const entries = wordDrafts('nb', ['numbers', 'money']).map((d) => d.fields.Entry);
    expect(entries.filter((e) => e === 'hundre')).toHaveLength(1);
    expect(entries).toEqual(expect.arrayContaining(['en', 'ti', 'hundre', 'tusen', 'krone']));
    expect(wordDrafts('nb', ['numbers'])[0].fields.PartOfSpeech).toBe('numeral');
    const time = wordDrafts('nb', ['time']).map((d) => [d.fields.Entry, d.fields.PartOfSpeech]);
    expect(time).toEqual(expect.arrayContaining([['halv', 'adjective'], ['kvart', 'noun'], ['tjue', 'numeral'], ['over', 'preposition'], ['på', 'preposition'], ['minutt', 'noun'], ['elleve', 'numeral']]));
    // Each word once however many steps say it: months, weekdays, one to ten, 21 ordinals, 9 teens, 8 tens, hundre, tusen and og.
    expect(new Set(wordDrafts('nb', ['dates']).map((d) => d.fields.Entry)).size).toBe(70);
  });

  it('writes nothing for a group with no words in the language', () => {
    expect(groupWords('time', 'th').map((w) => w.entry)).toEqual(expect.arrayContaining(['ครึ่ง', 'โมง', 'นาที', 'ตี']));
    expect(wordDrafts('nb', ['consonants'])).toEqual([]);
  });
});

describe('what a drill step waits for', () => {
  it('is a few months for the first dates step, and all the weekdays as well after it', () => {
    expect(stepNeeds('dates-day', 'nb').map((n) => [n.label, n.min])).toEqual([['month names', MIN_MONTHS], ['number words', 10], ['day ordinals', MIN_ORDINALS]]);
    expect(stepNeeds('dates-day', 'en')).toEqual([]);
    expect(stepNeeds('dates-weekday', 'nb').map((n) => [n.label, n.min])).toEqual([['month names', MIN_MONTHS], ['weekday names', 7]]);
    expect(stepNeeds('dates-day', 'es').map((n) => n.label)).toEqual(['month names', 'number words', 'of', 'first']);
    expect(stepNeeds('dates-day', 'en')).toEqual([]);
  });

  it('is the number words, half, a quarter, the currency, a hundred and a thousand for the steps that say them', () => {
    const words = (step: string, l: Language) => stepNeeds(step, l).map((n) => n.words.join(' '));
    expect(stepNeeds('numbers-10', 'nb').map((n) => [n.label, n.min])).toEqual([['number words', 10]]);
    expect(words('numbers-999', 'th')).toEqual(['ร้อย']);
    expect(words('money-10000', 'pl')).toEqual(['tysiąc']);
    expect(words('money-1000', 'nb')).toEqual(['hundre', 'tusen', 'og']);
    expect(words('money-100', 'nb')).toEqual([DIGIT_WORDS.nb!.join(' '), 'hundre', 'krone', TEEN_NB.join(' '), TENS_NB.join(' ')]);
    expect(words('time-hours', 'nb')).toEqual([DIGIT_WORDS.nb!.join(' '), 'halv', 'elleve tolv']);
    expect(words('time-quarters', 'pl')).toEqual(['kwadrans', 'po', 'za']);
    expect(words('time-hours', 'pl')).toContain('wpół');
    expect(words('time-hours', 'th')).toEqual(expect.arrayContaining(['ครึ่ง', 'โมง']));
    expect(words('time-quarters', 'th')).toEqual(['นาที']);
    expect(words('time-five', 'nb')).toEqual(['tjue']);
    expect(words('time-five', 'pl')).toEqual(['dwadzieścia']);
    expect(stepNeeds('numbers-99', 'nb').map((n) => n.label)).toEqual(['numbers 11 to 19', 'tens']);
    expect(stepNeeds('numbers-99', 'pl').map((n) => n.label)).toEqual(['numbers 11 to 19', 'tens']);
    // A year says hundred and thousand in Thai and French, thousand but not hundred in Spanish.
    expect(words('dates-year', 'th')).toEqual(expect.arrayContaining(['ร้อย', 'พัน']));
    expect(words('dates-year', 'es')).toEqual(expect.arrayContaining(['mil', 'novecientos']));
    expect(words('dates-year', 'es')).not.toContain('cien');
  });

  it('counts a month known by the known headwords', () => {
    expect(knownMonths('nb', ['januar', 'mai', 'bil'])).toEqual([1, 5]);
    expect(knownMonths('en', ['january'])).toEqual([]);
  });

  it('says what is still missing, or nothing once there is enough', () => {
    const [months, weekdays] = stepNeeds('dates-weekday', 'nb');
    expect(stillNeeded(months, ['januar'])).toBe('2 more month names');
    expect(stillNeeded(months, ['januar', 'februar', 'mars'])).toBeUndefined();
    expect(stillNeeded(weekdays, ['mandag'])).toBe('weekday names');
    expect(stillNeeded(weekdays, WEEKDAY_WORDS.nb!.slice())).toBeUndefined();
    const [hundred] = stepNeeds('numbers-999', 'nb');
    expect(stillNeeded(hundred, ['hund'])).toBe('hundre');
  });
});
