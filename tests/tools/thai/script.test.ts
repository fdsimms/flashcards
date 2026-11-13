import { describe, expect, it } from 'vitest';
import { SYLLABLES, THAI_SCRIPT, toneOf, toneOfRoman, toneSteps, type Syllable } from '../../../src/tools/thai/script';

const find = (text: string) => SYLLABLES.find((s) => s.text === text)!;

describe('a Thai syllable’s tone', () => {
  it('worked out from the script, matches the tone its romanization carries, for every syllable', () => {
    for (const s of SYLLABLES) expect(toneOf(s), `${s.text} ${s.roman}`).toBe(toneOfRoman(s.roman));
  });

  it('covers every rule: each mark, live and dead, each class, and a ห in front', () => {
    const covered = new Set(SYLLABLES.map((s) => `${s.leadingH ? 'h-' : ''}${s.cls}:${s.mark}:${s.mark === 'none' ? `${s.live}:${s.long}` : ''}`));
    for (const rule of ['mid:none:true:true', 'mid:none:false:false', 'mid:ek:', 'mid:tho:', 'mid:tri:', 'mid:chattawa:',
      'high:none:true:true', 'high:none:false:false', 'high:ek:', 'high:tho:',
      'low:none:true:true', 'low:none:false:false', 'low:none:false:true', 'low:ek:', 'low:tho:', 'h-low:none:true:true']) {
      expect(covered, rule).toContain(rule);
    }
  });

  it('follows the table', () => {
    const s = (over: Partial<Syllable>): Syllable => ({ text: '', roman: '', meaning: '', initial: '', cls: 'mid', mark: 'none', live: true, long: true, ...over });
    expect(toneOf(s({ cls: 'low', mark: 'ek' }))).toBe('falling');
    expect(toneOf(s({ cls: 'low', mark: 'tho' }))).toBe('high');
    expect(toneOf(s({ cls: 'high', live: true }))).toBe('rising');
    expect(toneOf(s({ cls: 'low', live: false, long: false }))).toBe('high');
    expect(toneOf(s({ cls: 'low', live: false, long: true }))).toBe('falling');
    expect(toneOf(s({ cls: 'low', leadingH: true, live: true }))).toBe('rising');
  });

  it('explains how, step by step', () => {
    expect(toneSteps(find('ไก่'))).toEqual(['ก is a middle-class consonant.', '่ mai ek: with a tone mark, the mark and the class decide the tone.', 'So the tone is low.']);
    expect(toneSteps(find('หมา'))[0]).toBe('ม is low class, but ห in front makes it high.');
    expect(toneSteps(find('มาก'))[1]).toContain('a long vowel');
    expect(THAI_SCRIPT.patterns(SYLLABLES.indexOf(find('รัก')))).toEqual(['class:low', 'mark:dead']);
  });
});
