import { describe, expect, it } from 'vitest';
import { chooseTier, fitShape, FIT_TIERS, tierHeight, type FitShape } from '../../src/wanikani/cardFit';
import type { Part, Subject } from '../../src/wanikani/subjects';

const part = (chars: number, meaningChars: number) => ({ chars, meaningChars });
const six = [part(1, 6), part(1, 7), part(1, 6), part(1, 5), part(1, 4), part(1, 7)];

/** A vocabulary word's reading answer, as in the keyboard-up screenshot (市, し). */
const reading: FitShape = { frontChars: 1, details: true, parts: [], meaning: null, readings: [{ label: 7, chars: 1, primary: true }] };
/** A kanji's reading answer with all three reading types. */
const threeReadings: FitShape = {
  frontChars: 1, details: true, parts: [], meaning: null,
  readings: [{ label: 8, chars: 2, primary: true }, { label: 8, chars: 1, primary: false }, { label: 6, chars: 2, primary: false }],
};
/** The largest meaning answer: six parts, other meanings and the learner's synonyms. */
const worst: FitShape = { frontChars: 6, details: true, parts: six, meaning: { primary: 22, others: 20, synonyms: 21 }, readings: [] };

/** A card a typed answer leaves visible: about the card's height less the band and the compact header's chrome. */
const ROOM = { width: 370, height: 276 };
const options = { fontScale: 1, lesson: false, compact: true };

describe('tierHeight', () => {
  it('gets smaller from full to tight to collapsed', () => {
    for (const shape of [reading, threeReadings, worst]) {
      const [full, tight, collapsed] = FIT_TIERS.map((t) => tierHeight(shape, t, ROOM.width, 1));
      expect(full).toBeGreaterThan(tight);
      expect(tight).toBeGreaterThan(collapsed);
    }
  });

  it('is only the front when no answer is showing', () => {
    const front: FitShape = { ...reading, details: false, readings: [] };
    expect(tierHeight(front, 'full', 370, 1)).toBeLessThan(tierHeight(reading, 'full', 370, 1));
  });

  it('grows with the system text size and with a narrower card (more rows of parts)', () => {
    expect(tierHeight(worst, 'tight', 370, 1.5)).toBeGreaterThan(tierHeight(worst, 'tight', 370, 1));
    expect(tierHeight(worst, 'tight', 260, 1)).toBeGreaterThan(tierHeight(worst, 'tight', 370, 1));
  });

  it('puts a kanji\'s readings side by side in the short layouts, stacked in the full one', () => {
    const [full, tight] = FIT_TIERS.map((t) => tierHeight(threeReadings, t, ROOM.width, 1));
    expect(full).toBeGreaterThan(300);
    expect(tight).toBeLessThan(160);
  });
});

describe('chooseTier', () => {
  it('uses the roomy layout when the room is there', () => {
    expect(chooseTier(reading, { width: 370, height: 520 }, options)).toBe('full');
  });

  it('shortens a reading answer with the keyboard up, as in the screenshots', () => {
    expect(chooseTier(reading, { width: 370, height: 231 }, options)).toBe('tight');
    expect(chooseTier(threeReadings, { width: 370, height: 231 }, options)).toBe('tight');
  });

  it('keeps six parts, other meanings and synonyms in the tight layout in the compact card', () => {
    expect(chooseTier(worst, ROOM, options)).toBe('tight');
  });

  it('collapses the front only when tight still does not fit, and never goes below that', () => {
    expect(chooseTier(worst, { width: 370, height: 231 }, options)).toBe('collapsed');
    expect(chooseTier(worst, { width: 370, height: 100 }, options)).toBe('collapsed');
  });

  it('keeps a lesson at the full layout', () => {
    expect(chooseTier(worst, { width: 370, height: 231 }, { ...options, lesson: true })).toBe('full');
  });

  it('guesses before the card has been measured: tight with the keyboard up, full without', () => {
    expect(chooseTier(reading, null, options)).toBe('tight');
    expect(chooseTier(reading, null, { ...options, compact: false })).toBe('full');
  });

  it('moves to a shorter layout as the text size grows', () => {
    const room = { width: 370, height: 268 };
    expect(chooseTier(worst, room, { ...options, fontScale: 1.4 })).toBe('collapsed');
  });
});

describe('fitShape', () => {
  const subject = {
    characters: '〜才', meanings: [{ meaning: 'years old', primary: true, accepted: true }, { meaning: 'age', primary: false, accepted: true }],
    readings: [{ reading: 'さい', primary: true, accepted: true }], type: 'vocabulary',
  } as unknown as Subject;
  const parts: Part[] = [{ id: 1, type: 'kanji', characters: '才', meaning: 'talent' }];

  it('counts only what the question shows', () => {
    const meaning = fitShape(subject, parts, { showMeaning: true, showReading: false, synonyms: ['yrs'] });
    expect(meaning.frontChars).toBe(2);
    expect(meaning.parts).toEqual([{ chars: 1, meaningChars: 6 }]);
    expect(meaning.meaning).toMatchObject({ primary: 9, others: 3 });
    expect(meaning.meaning!.synonyms).toBeGreaterThan(0);
    expect(meaning.readings).toEqual([]);

    const read = fitShape(subject, parts, { showMeaning: false, showReading: true, synonyms: [] });
    expect(read.parts).toEqual([]);
    expect(read.meaning).toBeNull();
    expect(read.readings).toEqual([{ label: 7, chars: 2, primary: true }]);
  });

  it('is front-only before the answer shows', () => {
    expect(fitShape(subject, parts, { showMeaning: false, showReading: false, synonyms: [] }).details).toBe(false);
  });
});
