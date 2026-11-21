import { describe, expect, it } from 'vitest';
import { compareTyped, compareTypedAnswer, comparisonLine } from '../../src/core/typedCompare';

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

describe('Japanese answers', () => {
  it('counts a missing voicing mark as a wrong letter, not a wrong accent', () => {
    const c = compareTyped('かいがん', 'かいかん');
    expect(c.sameLetters).toBe(false);
    expect(comparisonLine(c)).toBe('1 letter off.');
  });
  it('takes katakana for hiragana as right, and says so', () => {
    const c = compareTyped('らーめん', 'ラーメン');
    expect(c).toMatchObject({ exact: false, sameWords: true, otherKana: true, off: 0 });
    expect(comparisonLine(c)).toBe('Right, but written in the other kana.');
  });
  it('takes the word or its reading, and keeps the closer', () => {
    expect(compareTypedAnswer(['食べる', 'たべる'], '食べる').exact).toBe(true);
    expect(compareTypedAnswer(['食べる', 'たべる'], 'たべる').exact).toBe(true);
    expect(compareTypedAnswer(['食べる', 'たべる'], 'たべた').off).toBe(1);
  });
  it('reads romaji as kana in Japanese only', () => {
    expect(compareTypedAnswer(['食べる', 'たべる'], 'taberu', 'ja-JP').exact).toBe(true);
    expect(compareTypedAnswer(['いっしょ'], 'issho', 'ja-JP').exact).toBe(true);
    expect(compareTypedAnswer(['taberu'], 'taberu', 'es-MX').exact).toBe(true);
  });
  it('compares one answer as compareTyped does', () => {
    expect(compareTypedAnswer(['esperar'], 'espera')).toEqual(compareTyped('esperar', 'espera'));
  });
});

describe('spellings the other answer checks take as the same', () => {
  it('takes е typed for ё as exact', () => {
    expect(compareTyped('ёлка', 'елка').exact).toBe(true);
    expect(compareTypedAnswer(['ёлка'], 'елка').exact).toBe(true);
  });

  it('takes l for ł and o for ø as a missing mark, not other letters', () => {
    const c = compareTyped('łódź', 'lodz');
    expect(c.exact).toBe(false);
    expect(c.sameLetters).toBe(true);
    expect(compareTyped('øl', 'ol').sameLetters).toBe(true);
  });
});

describe('Thai typed in another order', () => {
  it('is exactly right when the marks were typed in an order that draws the same', () => {
    // ที่ with the tone mark typed before the vowel; น้ำ with ำ typed as ํ and า, either side of the tone.
    expect(compareTyped('ที่', 'ท่ี').exact).toBe(true);
    expect(compareTyped('น้ำ', 'นํ้า').exact).toBe(true);
    expect(compareTyped('น้ำ', 'น้ํา').exact).toBe(true);
  });

  it('says a vowel or tone mark is different, not an accent', () => {
    expect(comparisonLine(compareTyped('กิน', 'กน'))).toBe('Right consonants, but a vowel or tone mark is different.');
    expect(comparisonLine(compareTyped('บ้าน', 'บาน'))).toBe('Right consonants, but a vowel or tone mark is different.');
    expect(comparisonLine(compareTyped('café', 'cafe'))).toBe('Right letters, but one has the wrong accent or mark.');
  });
});
