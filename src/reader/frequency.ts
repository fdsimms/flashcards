// How common a word is, for the word popup: its place in the language's list of 10,000 most common
// words (server/reader's frequency.py), as a band, a meter and the place itself. Display only: it
// never makes a word known or touches a card.

import type { Word } from './api';

/** How many words the server's list holds; a word past it has no place. */
export const FREQUENCY_LIST_SIZE = 10000;

export const BAR_COUNT = 4;

export type WordFrequency = {
  /** Very common, Common, Uncommon or Rare. */
  band: string;
  /** How many of the meter's BAR_COUNT bars are filled. */
  bars: number;
  /** The place, or where the list ends: "#6,412" or "Beyond the top 10,000". */
  place: string;
  /** The same in a sentence, for a screen reader. */
  spoken: string;
};

const BANDS: { upTo: number; band: string; bars: number }[] = [
  { upTo: 1000, band: 'Very common', bars: 4 },
  { upTo: 3000, band: 'Common', bars: 3 },
  { upTo: FREQUENCY_LIST_SIZE, band: 'Uncommon', bars: 2 },
];

function thousands(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * null when there's nothing to say: a name, a space or punctuation, or a server older than the
 * rank (`rank` missing). A rank of null is a word past the end of the list.
 */
export function wordFrequency(word: Pick<Word, 'status' | 'rank'>): WordFrequency | null {
  if (word.rank === undefined || word.status === null || word.status === 'name') return null;
  if (word.rank === null) {
    const place = `Beyond the top ${thousands(FREQUENCY_LIST_SIZE)}`;
    return { band: 'Rare', bars: 1, place, spoken: `Rare. ${place} most common words` };
  }
  const found = BANDS.find((b) => word.rank! <= b.upTo)!;
  return { band: found.band, bars: found.bars, place: `#${thousands(word.rank)}`, spoken: `${found.band}. Number ${thousands(word.rank)} among the most common words` };
}
