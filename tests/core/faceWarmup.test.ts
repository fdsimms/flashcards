import { describe, expect, it } from 'vitest';
import { warmupKey, warmupText, WARMED_WEIGHTS } from '../../src/core/faceWarmup';

describe('face warm-up', () => {
  it('keys a font by the scripts the text needs, so two Thai cards share one warm-up', () => {
    expect(warmupKey('nunito', 'ฟรี free')).toBe('nunito:thai');
    expect(warmupKey('nunito', 'ว่าง')).toBe(warmupKey('nunito', 'ฟรี'));
    expect(warmupKey('nunito', 'free')).toBe('nunito:');
  });

  it('tells fonts and scripts apart', () => {
    expect(warmupKey('nunito', 'ฟรี')).not.toBe(warmupKey('mitr', 'ฟรี'));
    expect(warmupKey('nunito', 'ฟรี')).not.toBe(warmupKey('nunito', 'свободный'));
    expect(warmupKey('nunito', 'свободный')).toBe('nunito:cyrillic');
    expect(warmupKey('nunito', 'ελεύθερος')).toBe('nunito:greek');
    expect(warmupKey('nunito', '自由 ฟรี')).toBe('nunito:thai+japanese');
  });

  it('joins a side\'s blocks and cuts them at a limit', () => {
    expect(warmupText([{ text: 'ฟรี' }, { text: 'free' }])).toBe('ฟรี free');
    expect(warmupText([{ text: 'x'.repeat(500) }])).toHaveLength(120);
    expect(warmupText([])).toBe('');
  });

  it('covers the light and heavy weights a card draws in', () => {
    expect(WARMED_WEIGHTS).toEqual(['400', '500', '600', '700']);
  });
});
