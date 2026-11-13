import { describe, expect, it } from 'vitest';
import { checkTyped } from '../../src/tools/answer';
import { sayJapaneseDate } from '../../src/tools/japanese/date';
import { sayPolishDate } from '../../src/tools/polish/date';
import { sayThaiDate } from '../../src/tools/thai/date';
import { acceptedForms, addDays, dateOptions, DATE_MODES, nextQuizDraw, quizCalendarStart, quizDate, sameDate } from '../../src/tools/dateQuiz';

/** A repeatable stand-in for Math.random. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('the ways to answer a date', () => {
  it('lists them in the order the screen offers them', () => {
    expect(DATE_MODES).toEqual(['say', 'pick', 'type', 'tap']);
  });
});

describe('the accepted forms of a date', () => {
  it('starts with the usual one, has no repeats, and never takes the digits as written', () => {
    const saying = sayThaiDate({ year: 2044, month: 6, day: 27 }, { weekday: true, year: true });
    const forms = acceptedForms(saying);
    expect(forms[0].text).toBe('วันจันทร์ที่ยี่สิบเจ็ด มิถุนายน พ.ศ. สองพันห้าร้อยแปดสิบเจ็ด');
    expect(new Set(forms.map((f) => f.text)).size).toBe(forms.length);
    expect(forms.some((f) => /\d/.test(f.text))).toBe(false);
    expect(checkTyped(saying.written.text, forms).verdict).toBe('different');
  });

  it('checks the ordinal: the day in digits with the month in words is not right', () => {
    const forms = acceptedForms(sayPolishDate({ year: 2026, month: 11, day: 12 }, { weekday: false, year: false }));
    expect(checkTyped('dwunasty listopada', forms).verdict).toBe('exact');
    expect(checkTyped('dwunastego listopada', forms).verdict).toBe('exact');
    expect(checkTyped('12 listopada', forms).verdict).toBe('different');
  });

  it('takes a Japanese date only in kana, its reading, noting the kanji it is written in', () => {
    const forms = acceptedForms(sayJapaneseDate({ year: 2026, month: 4, day: 1 }, { weekday: false, year: false }));
    expect(forms).toEqual([{ text: 'しがつついたち', note: '四月一日' }]);
    expect(checkTyped('しがつ ついたち', forms).verdict).toBe('exact');
    expect(checkTyped('しがつ いちにち', forms).verdict).toBe('different');
    // What いちにち becomes through the IME, and the digits: neither checks the reading.
    expect(checkTyped('四月一日', forms).verdict).toBe('different');
    expect(checkTyped('4月1日', forms).verdict).toBe('different');
  });

  it("takes each of Japanese's other ways in kana too, with its note", () => {
    const forms = acceptedForms(sayJapaneseDate({ year: 2026, month: 11, day: 13 }, { weekday: true, year: true }));
    expect(forms.map((f) => f.text)).toEqual([
      'にせんにじゅうろくねんじゅういちがつじゅうさんにちきんようび',
      'にせんにじゅうろくねんじゅういちがつじゅうさんにちきんよう',
      'れいわはちねんじゅういちがつじゅうさんにちきんようび',
    ]);
    expect(forms[2].note).toBe('令和八年十一月十三日金曜日 · The year of the era (令和)');
    expect(checkTyped('2026年11月13日（金）', forms).verdict).toBe('different');
  });
});

describe('adding days', () => {
  it('crosses months and years in both directions', () => {
    expect(addDays({ year: 2026, month: 11, day: 30 }, 1)).toEqual({ year: 2026, month: 12, day: 1 });
    expect(addDays({ year: 2026, month: 12, day: 31 }, 2)).toEqual({ year: 2027, month: 1, day: 2 });
    expect(addDays({ year: 2028, month: 3, day: 1 }, -1)).toEqual({ year: 2028, month: 2, day: 29 });
    expect(addDays({ year: 2027, month: 1, day: 1 }, -3)).toEqual({ year: 2026, month: 12, day: 29 });
    expect(addDays({ year: 2026, month: 11, day: 12 }, 0)).toEqual({ year: 2026, month: 11, day: 12 });
  });
});

describe('the phrases offered for a date', () => {
  const june27 = { year: 2044, month: 6, day: 27 };
  const parts = { weekday: true, year: true };

  it('offers four different phrases, one of them the date`s own', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { options, correct } = dateOptions(june27, parts, sayThaiDate, seeded(seed));
      expect(options).toHaveLength(4);
      expect(new Set(options.map((o) => o.phrase.text)).size).toBe(4);
      expect(options[correct].phrase.text).toBe(sayThaiDate(june27, parts).everyday.text);
      expect(sameDate(options[correct].date, june27)).toBe(true);
    }
  });

  it('keeps each wrong phrase tied to the date it says', () => {
    const { options, correct } = dateOptions(june27, parts, sayThaiDate, seeded(7));
    options.forEach((o, i) => {
      expect(o.phrase.text).toBe(sayThaiDate(o.date, parts).everyday.text);
      if (i !== correct) expect(sameDate(o.date, june27)).toBe(false);
    });
  });

  it('offers a wrong year only when the year is said', () => {
    const withoutYear = { weekday: false, year: false };
    for (let seed = 1; seed <= 40; seed++) {
      const { options } = dateOptions(june27, withoutYear, sayThaiDate, seeded(seed));
      expect(options.every((o) => o.date.year === 2044 || o.date.month !== 6 || o.date.day !== 27 || true)).toBe(true);
      expect(options.filter((o) => o.date.year !== 2044)).toEqual([]);
    }
    const years = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) dateOptions(june27, parts, sayThaiDate, seeded(seed)).options.forEach((o) => years.add(o.date.year));
    expect(years.size).toBeGreaterThan(1);
  });

  it('works at the edges of a month and a year', () => {
    for (const d of [{ year: 2026, month: 1, day: 1 }, { year: 2026, month: 12, day: 31 }, { year: 2028, month: 2, day: 29 }]) {
      const { options } = dateOptions(d, parts, sayThaiDate, seeded(3));
      expect(new Set(options.map((o) => o.phrase.text)).size).toBe(4);
    }
  });
});

describe('the date a question asks about', () => {
  const drawn = { year: 1987, month: 3, day: 12 };
  const today = { year: 2026, month: 11, day: 13 };
  const yearOff = { weekday: true, year: false };
  const yearOn = { weekday: true, year: true };

  it('is the drawn date for every question but tapping it with the year unsaid', () => {
    for (const mode of ['say', 'pick', 'type'] as const) {
      expect(quizDate(drawn, mode, yearOff, today)).toBe(drawn);
      expect(quizDate(drawn, mode, yearOn, today)).toBe(drawn);
    }
    expect(quizDate(drawn, 'tap', yearOn, today)).toBe(drawn);
  });

  it('moves to the year the calendar opens on when it is tapped with the year unsaid', () => {
    expect(quizDate(drawn, 'tap', yearOff, today)).toEqual({ year: 2026, month: 3, day: 12 });
  });

  it('falls back to February 28 outside a leap year', () => {
    expect(quizDate({ year: 2028, month: 2, day: 29 }, 'tap', yearOff, today)).toEqual({ year: 2026, month: 2, day: 28 });
    expect(quizDate({ year: 2028, month: 2, day: 29 }, 'tap', yearOff, { year: 2032, month: 1, day: 1 })).toEqual({ year: 2032, month: 2, day: 29 });
  });
});

describe('the month the calendar opens on to tap the date', () => {
  const today = { year: 2026, month: 11, day: 13 };

  it("opens on this month in the asked date's year when the year is said", () => {
    expect(quizCalendarStart({ year: 1987, month: 3, day: 12 }, { weekday: false, year: true }, today)).toEqual({ year: 1987, month: 11, day: 1 });
  });

  it('opens on this month when the year is unsaid, the year the question is in', () => {
    const start = quizCalendarStart({ year: 2026, month: 3, day: 12 }, { weekday: true, year: false }, today);
    expect(start).toEqual({ year: 2026, month: 11, day: 1 });
    expect(start.year).toBe(quizDate({ year: 1987, month: 3, day: 12 }, 'tap', { weekday: true, year: false }, today).year);
  });
});

describe('the next date drawn', () => {
  const today = { year: 2026, month: 11, day: 13 };
  // A random source that returns these values in turn.
  const sequence = (dates: number[]) => { let i = 0; return () => dates[i++ % dates.length]; };

  it('draws again when a new date would ask the same day and month, tapped with the year unsaid', () => {
    // 0 draws 1 January 1950, which asks the same 1 January as 1987's; 0.123 draws a day in 1962.
    const drawn = { year: 1987, month: 1, day: 1 };
    const parts = { weekday: true, year: false };
    const next = nextQuizDraw(drawn, 'tap', parts, today, sequence([0, 0.123]));
    expect(next.year).not.toBe(1950);
    expect(sameDate(quizDate(next, 'tap', parts, today), quizDate(drawn, 'tap', parts, today))).toBe(false);
  });

  it('takes the first new draw otherwise', () => {
    const drawn = { year: 1987, month: 3, day: 12 };
    const next = nextQuizDraw(drawn, 'say', { weekday: true, year: true }, today, sequence([0.5]));
    expect(sameDate(next, drawn)).toBe(false);
  });
});
