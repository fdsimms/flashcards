import { useSyncExternalStore } from 'react';
import type { ThemeWord } from '../../core/cramThemes';
import type { CramTheme, Language } from '../../reader/api';

/**
 * The theme ideas last asked for and the theme picked, held in memory for the screens that share
 * them (the list, one theme, the cram's sheet). Nothing here is saved: the ideas were written for the
 * words as they were, and a picked theme becomes part of a cram only when the cram is saved.
 */

/** What the server last wrote for `language`, with the words it was written from. */
export interface Suggested {
  language: Language;
  words: ThemeWord[];
  themes: CramTheme[];
  /** Every title shown so far, so asking again gives different themes. */
  shown: string[];
  stretch: boolean;
}

/** The theme picked, its story as the owner left it. The cram's sheet makes a cram from it. */
export interface Chosen {
  language: Language;
  theme: CramTheme;
  words: ThemeWord[];
}

interface State { suggested?: Suggested; chosen?: Chosen }

let state: State = {};
const listeners = new Set<() => void>();

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const get = () => state;

export function setThemeState(patch: Partial<State>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const useThemeState = (): State => useSyncExternalStore(subscribe, get);
