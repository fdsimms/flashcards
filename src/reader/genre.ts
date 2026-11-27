/**
 * The kind of text asked for on the New dialogue or story sheet (server `genre.py`): a mystery, a
 * comedy, a news report. It shapes the plot and tone only. The words still come from the deck.
 * 'any' sends nothing, so the server writes what it always did.
 */
export type Genre = 'any' | 'everyday' | 'comedy' | 'mystery' | 'romance' | 'adventure' | 'scifi' | 'fantasy' | 'horror' | 'drama' | 'news';

export const GENRES: { value: Genre; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'everyday', label: 'Everyday life' },
  { value: 'comedy', label: 'Comedy' },
  { value: 'mystery', label: 'Mystery' },
  { value: 'romance', label: 'Romance' },
  { value: 'adventure', label: 'Adventure' },
  { value: 'scifi', label: 'Sci-fi' },
  { value: 'fantasy', label: 'Fantasy' },
  { value: 'horror', label: 'Horror' },
  { value: 'drama', label: 'Drama' },
  { value: 'news', label: 'News report' },
];

export const genreLabel = (genre: Genre): string => GENRES.find((g) => g.value === genre)!.label;

/** The genre whose label a `Select` row reports back. */
export const genreOfLabel = (label: string): Genre => GENRES.find((g) => g.label === label)?.value ?? 'any';

/** The part of a write request that carries a genre: nothing for Any, so an older server is never sent a field it doesn't know. */
export function genreChoice(genre: Genre): { genre?: Genre } {
  return genre === 'any' ? {} : { genre };
}
