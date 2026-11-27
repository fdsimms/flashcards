import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../../src/reader/languages';
import { SOUND_GUIDES } from '../../src/tools/soundGuides';
import type { Language } from '../../src/reader/api';

describe('the sound guides', () => {
  const guides = Object.entries(SOUND_GUIDES) as [Language, NonNullable<(typeof SOUND_GUIDES)[Language]>][];

  it('covers every language that can be started from zero', () => {
    const startable = (Object.keys(LANGUAGES) as Language[]).filter((l) => l !== 'en');
    expect(guides.map(([l]) => l).sort()).toEqual(startable.sort());
  });

  it('gives every row a spelling, a word to hear and a hint, in plain copy', () => {
    for (const [, guide] of guides) {
      expect(guide.rows.length).toBeGreaterThanOrEqual(5);
      for (const row of [...guide.rows.map((r) => r.hint), ...guide.notes]) {
        // User-facing copy: no em dashes, and "e.g." rather than "for example".
        expect(row).not.toMatch(/—|for example/i);
        expect(row.trim()).toBe(row);
      }
      for (const row of guide.rows) {
        expect(row.spelled && row.example && row.hint).toBeTruthy();
        // One word to play, never a phrase or a list.
        expect(row.example).not.toMatch(/[\s,]/);
      }
    }
  });
});
