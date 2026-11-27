import { describe, expect, it } from 'vitest';
import { GENRES, genreChoice, genreLabel, genreOfLabel } from '../../src/reader/genre';

describe('genre', () => {
  it('has a unique label for every genre, Any first', () => {
    expect(GENRES[0].value).toBe('any');
    expect(new Set(GENRES.map((g) => g.label)).size).toBe(GENRES.length);
  });

  it('turns a label back into its genre, and an unknown one into Any', () => {
    for (const g of GENRES) expect(genreOfLabel(genreLabel(g.value))).toBe(g.value);
    expect(genreOfLabel('Western')).toBe('any');
  });

  it('sends nothing for Any', () => {
    expect(genreChoice('any')).toEqual({});
    expect(genreChoice('mystery')).toEqual({ genre: 'mystery' });
  });
});
