import { describe, expect, it } from 'vitest';
import { compareTyped, comparisonLine } from '../../src/core/typedCompare';

describe('compareTyped', () => {
  it('is exact whatever the case', () => {
    const c = compareTyped('Esperar', 'esperar');
    expect(c.exact).toBe(true);
    expect(comparisonLine(c)).toBe('Exactly right.');
    expect(c.typed).toEqual([{ text: 'esperar', kind: 'same' }]);
  });

  it('marks a letter typed twice', () => {
    const c = compareTyped('esperar', 'esperrar');
    expect(c.typed).toEqual([{ text: 'esper', kind: 'same' }, { text: 'r', kind: 'extra' }, { text: 'ar', kind: 'same' }]);
    expect(c.expected).toEqual([{ text: 'esperar', kind: 'same' }]);
    expect(c.off).toBe(1);
    expect(comparisonLine(c)).toBe('1 letter off.');
  });

  it('ignores punctuation and spacing for sameWords, and says so', () => {
    const c = compareTyped('¿Me trae la cuenta, por favor?', 'me trae la cuenta por favor');
    expect(c.exact).toBe(false);
    expect(c.sameWords).toBe(true);
    expect(c.off).toBe(0);
    expect(comparisonLine(c)).toBe('Right, apart from spacing or punctuation.');
    expect(c.expected.filter((p) => p.kind === 'missing').map((p) => p.text)).toEqual(['¿', ',', '?']);
  });

  it('counts letters missing their accent or tail', () => {
    const c = compareTyped('Poproszę rachunek i jeszcze jedną kawę.', 'Poprosze rachunek i jeszcze jedna kawe.');
    expect(c.sameWords).toBe(false);
    expect(c.sameLetters).toBe(true);
    expect(c.off).toBe(3);
    expect(c.expected.filter((p) => p.kind === 'missing').map((p) => p.text)).toEqual(['ę', 'ą', 'ę']);
    expect(comparisonLine(c)).toBe('Right letters, but 3 have the wrong accent or mark.');
  });

  it('marks a Thai syllable piece whole when its tone mark is wrong', () => {
    // ใกล้ (near, with mai tho) typed as ไกล (far): different vowel, and the tone mark is missing.
    const c = compareTyped('ใกล้', 'ใกล');
    expect(c.expected).toEqual([{ text: 'ใก', kind: 'same' }, { text: 'ล้', kind: 'missing' }]);
    expect(c.typed).toEqual([{ text: 'ใก', kind: 'same' }, { text: 'ล', kind: 'extra' }]);
    expect(c.off).toBe(1);
  });

  it('says when nothing was typed', () => {
    const c = compareTyped('esperar', '  ');
    expect(c.exact).toBe(false);
    expect(c.expected).toEqual([{ text: 'esperar', kind: 'missing' }]);
    expect(comparisonLine(c)).toBe('Nothing typed.');
  });

  it('counts a wrong word', () => {
    const c = compareTyped('¿Me trae la cuenta?', '¿Me traes la cuenta?');
    expect(c.off).toBe(1);
    expect(c.typed.find((p) => p.kind === 'extra')?.text).toBe('s');
  });
});

describe('compareTyped spelling variants', () => {
  it('accepts ss for ß and σ for a final ς, as the other answer checks do', () => {
    expect(compareTyped('Straße', 'Strasse')).toMatchObject({ exact: true, off: 0 });
    expect(compareTyped('οδός', 'οδόσ')).toMatchObject({ exact: true, off: 0 });
    // Missing the accent as well: that is what's reported, not a wrong letter.
    expect(comparisonLine(compareTyped('οδός', 'οδοσ'))).toMatch(/wrong accent/);
    expect(comparisonLine(compareTyped('Straße', 'strasse'))).toBe('Exactly right.');
  });
  it('still marks a real difference', () => {
    expect(compareTyped('Straße', 'Strase').exact).toBe(false);
  });
});
