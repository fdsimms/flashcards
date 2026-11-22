import { useSyncExternalStore } from 'react';
import type { ThemeWord } from '../../core/cramThemes';
import type { CramTheme, Language } from '../../reader/api';

/**
 * The theme ideas last asked for, held in memory for the screens that share them (the list and one
 * theme). Nothing here is saved: the ideas were written for the words as they were, and a theme
 * becomes part of a cram only when Use theme is tapped.
 */

/** What the server last wrote for the cram `cramId`, in `language`, with the words it was written from. */
export interface Suggested {
  cramId: string;
  language: Language;
  words: ThemeWord[];
  themes: CramTheme[];
  /** Each theme's own words, in the theme's order: the ones sent and the deck's others it named (`themeDeckWords`). */
  wordsOf: ThemeWord[][];
  /** What really happened, as the themes were written from it (`Cram.facts`). */
  facts: string;
  /** Every title shown so far, so asking again gives different themes. */
  shown: string[];
  stretch: boolean;
}

interface State { suggested?: Suggested }

let state: State = {};
const listeners = new Set<() => void>();

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const get = () => state;

export function setThemeState(patch: Partial<State>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const useThemeState = (): State => useSyncExternalStore(subscribe, get);
