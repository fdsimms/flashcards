import { describe, expect, it } from 'vitest';
import type { Language } from '../../src/reader/api';
import { drillAnswer, type DrillQuestion } from '../../src/tools/skills';
import {
  DIGIT_WORDS, groupWords, knownAmong, knownDays, knownMonths, MIN_MONTHS, MIN_ORDINALS, MONTH_MEANINGS, MONTH_WORDS, ORDINAL_DAY_WORDS, SKILL_WORD_NOTE_TYPE, stepNeeds, stillNeeded, TEEN_WORDS, TENS_WORDS, WEEKDAY_MEANINGS, WEEKDAY_WORDS, wordDrafts,
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
      const quarter = groupWords('time', l).find((w) => w.meaning === 'quarter');
      if (quarter) expect(said(time(3, 15), l) + said(time(3, 45), l), `${l} quarter`).toContain(stem(quarter.entry));
      const currency = groupWords('money', l).find((w) => w.meaning !== 'hundred' && w.meaning !== 'thousand');
      expect(currency, `${l} currency`).toBeDefined();
      expect(said({ kind: 'money', amount: 1500 }, l), `${l} currency`).toContain(stem(currency!.entry));
    }
  });
});

describe('the Norwegian words the drills say', () => {
  it('are in the answer: each ordinal, teen and ten, and the small words of a time and a price', () => {
    const nb = (q: DrillQuestion) => said(q, 'nb');
    ORDINAL_DAY_WORDS.nb!.forEach((w, i) => {
      const day = i < 19 ? i + 1 : i === 19 ? 20 : 30;
      expect(nb(date(3, day)), `ordinal ${day}`).toContain(w);
    });
    TEEN_WORDS.nb!.forEach((w, i) => expect(nb(number(11 + i)), `teen ${11 + i}`).toContain(w));
    TENS_WORDS.nb!.forEach((w, i) => expect(nb(number(20 + i * 10)), `ten ${20 + i * 10}`).toContain(w));
    expect(nb(number(105))).toContain(' og ');
    expect(nb(number(2000))).toContain('tusen');
    const time = (hour: number, minute: number): DrillQuestion => ({ kind: 'time', time: { hour, minute } });
    expect(nb(time(3, 15))).toContain('over');
    expect(nb(time(3, 45))).toContain('på');
    expect(nb(time(3, 20))).toContain('tjue');
    expect(nb(time(3, 7))).toContain('minutter');
    expect(nb({ kind: 'money', amount: 120_700 })).toContain(' og ');
    // A year says hundre and og before 2000, tusen after.
    expect(nb({ kind: 'date', date: { year: 1985, month: 3, day: 4 }, parts: { weekday: false, year: true } })).toContain('hundreog');
    expect(nb({ kind: 'date', date: { year: 2026, month: 3, day: 4 }, parts: { weekday: false, year: true } })).toContain('tusenog');
  });
});

describe('the days a learner knows', () => {
  const ordinals = ORDINAL_DAY_WORDS.nb!;

  it('are the days whose ordinal, and tens for the twenties and thirty-first, are known', () => {
    expect(knownDays('nb', [])).toEqual([]);
    expect(knownDays('nb', ordinals.slice(0, 10))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // tjue is what makes the twenties: with it, 21 to 29 come from the first nine ordinals.
    expect(knownDays('nb', [...ordinals.slice(0, 10), 'tjue'])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
    expect(knownDays('nb', [...ordinals, 'tjue', 'tretti'])).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    expect(knownDays('nb', ['første', 'tretti'])).toEqual([1, 31]);
    expect(knownDays('nb', ['tjuende', 'trettiende'])).toEqual([20, 30]);
  });

  it('are every day for a language whose days are not gated', () => {
    expect(knownDays('pl', ['pierwszy'])).toEqual([]);
  });

  it('are exactly the ones the drill says in pieces: every piece is in the answer', () => {
    for (let day = 1; day <= 31; day++) {
      const text = said(date(3, day), 'nb');
      const known = knownDays('nb', ['første']);
      expect(known.includes(day)).toBe(day === 1);
      expect(text, `day ${day}`).toContain(day === 20 ? 'tjuende' : day === 30 ? 'trettiende' : day < 20 ? ordinals[day - 1] : `${day < 30 ? 'tjue' : 'tretti'}${ordinals[(day % 10) - 1]}`);
    }
  });
});

describe('writing the words as notes', () => {
  it('writes each as a note of the deck\'s own type, tagged so Review brings some up', () => {
    const drafts = wordDrafts('nb', ['dates']);
    expect(drafts).toHaveLength(60);
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
    expect(time.slice(0, 2)).toEqual([['halv', 'adjective'], ['kvart', 'noun']]);
    expect(time).toEqual(expect.arrayContaining([['tjue', 'numeral'], ['over', 'preposition'], ['på', 'preposition'], ['minutt', 'noun'], ['elleve', 'numeral']]));
    // Each word once however many steps say it: months, weekdays, 21 ordinals, 9 teens, 8 tens, hundre, tusen and og.
    expect(new Set(wordDrafts('nb', ['dates']).map((d) => d.fields.Entry)).size).toBe(60);
  });

  it('writes nothing for a group with no words in the language', () => {
    expect(groupWords('time', 'th').map((w) => w.entry)).toEqual(['ครึ่ง', 'โมง']);
    expect(wordDrafts('nb', ['consonants'])).toEqual([]);
  });
});

describe('what a drill step waits for', () => {
  it('is a few months for the first dates step, and all the weekdays as well after it', () => {
    expect(stepNeeds('dates-day', 'nb').map((n) => [n.label, n.min])).toEqual([['month names', MIN_MONTHS], ['day ordinals', MIN_ORDINALS]]);
    expect(stepNeeds('dates-day', 'pl').map((n) => [n.label, n.min])).toEqual([['month names', MIN_MONTHS]]);
    expect(stepNeeds('dates-weekday', 'nb').map((n) => [n.label, n.min])).toEqual([['month names', MIN_MONTHS], ['weekday names', 7]]);
    expect(stepNeeds('dates-day', 'en')).toEqual([]);
  });

  it('is the number words, half, a quarter, the currency, a hundred and a thousand for the steps that say them', () => {
    expect(stepNeeds('numbers-10', 'nb').map((n) => [n.label, n.min])).toEqual([['number words', 10]]);
    expect(stepNeeds('numbers-999', 'th').map((n) => n.words)).toEqual([['ร้อย']]);
    expect(stepNeeds('money-10000', 'pl').map((n) => n.words)).toEqual([['tysiąc']]);
    expect(stepNeeds('money-1000', 'nb').map((n) => n.words)).toEqual([['hundre'], ['og']]);
    expect(stepNeeds('money-100', 'nb').map((n) => n.words[0])).toEqual(['krone', 'elleve', 'tjue']);
    expect(stepNeeds('time-hours', 'nb').map((n) => n.words)).toEqual([['halv']]);
    expect(stepNeeds('time-quarters', 'pl').map((n) => n.words)).toEqual([['kwadrans']]);
    expect(stepNeeds('time-hours', 'pl').map((n) => n.words)).toEqual([['wpół']]);
    expect(stepNeeds('time-hours', 'th').map((n) => n.words)).toEqual([['ครึ่ง'], ['โมง']]);
    expect(stepNeeds('time-quarters', 'th')).toEqual([]);
    expect(stepNeeds('time-five', 'nb').map((n) => n.words)).toEqual([['tjue']]);
    expect(stepNeeds('time-five', 'pl')).toEqual([]);
    expect(stepNeeds('numbers-99', 'nb').map((n) => n.label)).toEqual(['numbers 11 to 19', 'tens']);
    expect(stepNeeds('numbers-99', 'pl')).toEqual([]);
  });

  it('counts a word known when a studied headword is it or has it as a word of its own', () => {
    expect(knownAmong(['februar', 'mars'], ['Februar', 'mars, måned', 'marsipan'])).toEqual([true, true]);
    expect(knownAmong(['mars'], ['marsipan'])).toEqual([false]);
    expect(knownAmong(['ร้อย'], ['หนึ่งร้อย', 'แมว'])).toEqual([false]);
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
