import { describe, expect, it } from 'vitest';
import { knownAmong } from '../../src/tools/knownWords';

describe('knownAmong', () => {
  it('counts a word known when a studied headword is it or has it as a word of its own', () => {
    expect(knownAmong(['februar', 'mars'], ['Februar', 'mars, måned', 'marsipan'])).toEqual([true, true]);
    expect(knownAmong(['mars'], ['marsipan'])).toEqual([false]);
    // Russian ё and Greek tone marks are not told apart; other accents are.
    expect(knownAmong(['четвёртый', 'μία', 'δεκατέσσερα'], ['четвертый', 'Μια', 'δεκατεσσερα'])).toEqual([true, true, true]);
    expect(knownAmong(['być', 'wpół'], ['byc', 'wpol'])).toEqual([false, false]);
    expect(knownAmong(['ร้อย'], ['หนึ่งร้อย', 'แมว'])).toEqual([false]);
  });
});
