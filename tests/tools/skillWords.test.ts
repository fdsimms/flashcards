import { describe, expect, it } from 'vitest';
import { DATE_SAYERS } from '../../src/tools/tools';
import { drillAnswer } from '../../src/tools/skills';
import {
  dateNeeds, dateWordDrafts, knownAmong, knownMonths, MIN_MONTHS, MONTH_MEANINGS, MONTH_WORDS, SKILL_WORD_NOTE_TYPE, stillNeeded, WEEKDAY_MEANINGS, WEEKDAY_WORDS,
} from '../../src/tools/skillWords';
import type { Language } from '../../src/reader/api';

const LANGUAGES = Object.keys(DATE_SAYERS) as Language[];

describe('the word lists', () => {
  it('give twelve months and seven weekdays for every language that has date drills', () => {
    expect(LANGUAGES.length).toBeGreaterThan(0);
    for (const l of LANGUAGES) {
      expect(MONTH_WORDS[l], l).toHaveLength(12);
      expect(WEEKDAY_WORDS[l], l).toHaveLength(7);
      expect(new Set(MONTH_WORDS[l]).size, l).toBe(12);
      expect(new Set(WEEKDAY_WORDS[l]).size, l).toBe(7);
    }
    expect(MONTH_MEANINGS[1]).toBe('February');
    expect(WEEKDAY_MEANINGS[0]).toBe('Sunday');
  });

  it('are the words the drill answers say, where the language says the month as listed', () => {
    for (const l of ['nb', 'es', 'fr', 'de'] as const) {
      for (let m = 1; m <= 12; m++) {
        const answer = drillAnswer({ kind: 'date', date: { year: 2026, month: m, day: 20 }, parts: { weekday: false, year: false } }, l)!;
        const said = [answer.everyday, ...answer.also, ...(answer.last ? [answer.last.phrase] : [])].map((p) => p.text.toLowerCase()).join(' | ');
        expect(said, `${l} ${m}`).toContain(MONTH_WORDS[l]![m - 1].toLowerCase());
      }
    }
  });

  it('write each as a note of the deck\'s own type, tagged so Review brings some up', () => {
    const drafts = dateWordDrafts('nb');
    expect(drafts).toHaveLength(19);
    expect(drafts[1]).toEqual({ fields: { Entry: 'februar', Meaning: 'February', Language: 'norwegian', PartOfSpeech: 'noun', GenerateReverse: 'y' }, tags: ['skill::words'] });
    expect(drafts[12].fields).toMatchObject({ Entry: 'søndag', Meaning: 'Sunday' });
    expect(SKILL_WORD_NOTE_TYPE).toBe('Omnilanguage');
    expect(dateWordDrafts('en')).toEqual([]);
  });
});

describe('what a dates step waits for', () => {
  it('is a few months for the first step, and all the weekdays as well after it', () => {
    expect(dateNeeds('dates-day', 'nb').map((n) => [n.label, n.min])).toEqual([['month names', MIN_MONTHS]]);
    expect(dateNeeds('dates-weekday', 'nb').map((n) => [n.label, n.min])).toEqual([['month names', MIN_MONTHS], ['weekday names', 7]]);
    expect(dateNeeds('time-hours', 'nb')).toEqual([]);
    expect(dateNeeds('dates-day', 'en')).toEqual([]);
  });

  it('counts a month known when a studied headword is it or has it as a word of its own', () => {
    expect(knownAmong(['februar', 'mars'], ['Februar', 'mars, måned', 'marsipan'])).toEqual([true, true]);
    expect(knownAmong(['mars'], ['marsipan'])).toEqual([false]);
    expect(knownMonths('nb', ['januar', 'mai', 'bil'])).toEqual([1, 5]);
    expect(knownMonths('en', ['january'])).toEqual([]);
  });

  it('says what is still missing, or nothing once there is enough', () => {
    const [months, weekdays] = dateNeeds('dates-weekday', 'nb');
    expect(stillNeeded(months, ['januar'])).toBe('2 more month names');
    expect(stillNeeded(months, ['januar', 'februar', 'mars'])).toBeUndefined();
    expect(stillNeeded(weekdays, ['mandag'])).toBe('weekday names');
    expect(stillNeeded(weekdays, WEEKDAY_WORDS.nb!.slice())).toBeUndefined();
  });
});
