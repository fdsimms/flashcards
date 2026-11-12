import type { Language } from '../reader/api';
import { LANGUAGE_ORDER } from '../reader/languages';
import { sayFrenchTime } from './french/time';
import { sayGermanTime } from './german/time';
import { sayGreekTime } from './greek/time';
import { sayNorwegianTime } from './norwegian/time';
import { sayPolishTime } from './polish/time';
import { sayRussianTime } from './russian/time';
import { saySpanishTime } from './spanish/time';
import { sayThaiTime } from './thai/time';
import type { ClockTime, TimeSaying } from './time';

/**
 * Practice tools: small drills outside the decks, listed on the Practice tab, each a screen of its
 * own. A new tool is an entry in `TOOLS`, its logic beside this file (each language's under that
 * language's folder, e.g. thai/), and its screen and icon in `TOOL_SCREENS` (src/ui/tools/), which
 * won't typecheck until it has one. A tool comes in every one of the app's languages
 * (`LANGUAGE_ORDER`, Read & Listen's) unless it doesn't apply to one. Nothing here touches the
 * collection: a tool never grades a card or writes a review.
 */

export type ToolId = 'time';

export interface ToolInfo {
  id: ToolId;
  title: string;
  /** One line under the title in the list. */
  summary: string;
  /** The languages it can be practiced in, in the app's order. */
  languages: Language[];
}

/** Each language Telling the time can say a time in. */
export const TIME_SAYERS: Partial<Record<Language, (t: ClockTime) => TimeSaying>> = {
  th: sayThaiTime,
  es: saySpanishTime,
  fr: sayFrenchTime,
  de: sayGermanTime,
  el: sayGreekTime,
  nb: sayNorwegianTime,
  pl: sayPolishTime,
  ru: sayRussianTime,
};

const withSayer = (sayers: Partial<Record<Language, unknown>>) => LANGUAGE_ORDER.filter((l) => !!sayers[l]);

export const TOOLS: ToolInfo[] = [
  {
    id: 'time',
    title: 'Telling the time',
    summary: 'Say a time out loud, then check it.',
    languages: withSayer(TIME_SAYERS),
  },
];

export function toolById(id: string | undefined): ToolInfo | undefined {
  return TOOLS.find((t) => t.id === id);
}

/** The language a tool opens in: the one last practiced if the tool has it, else its first. */
export function toolLanguage(tool: ToolInfo, last: Language | undefined): Language {
  return last && tool.languages.includes(last) ? last : tool.languages[0];
}
