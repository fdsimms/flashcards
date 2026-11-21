import type { CardKind } from './types';
import { languageKey, languageName } from './voices';

/** The language a note's Meaning is written in. Omnilanguage notes are always glossed in English. */
const MEANING_LANGUAGE = 'English';

/**
 * The line under a native card's front that says which language is shown and which is wanted:
 * forward and audio cards show (or play) the word and ask for the meaning, a reverse card shows the
 * meaning and asks for the word. It tells a homograph apart from English ("у" is not "y") and says
 * what to answer. Undefined when the note's language isn't known, is English itself, or the card is
 * another kind. Display only. Pure, so it's tested.
 */
export function languageCue(kind: CardKind, speechLang: string | undefined): { from: string; to: string } | undefined {
  if (!speechLang) return undefined;
  // languageKey, so Cantonese says Cantonese, not Chinese.
  const code = languageKey(speechLang);
  if (code === 'en') return undefined;
  const word = languageName(code);
  if (kind === 'forward' || kind === 'audio') return { from: word, to: MEANING_LANGUAGE };
  if (kind === 'reverse') return { from: MEANING_LANGUAGE, to: word };
  return undefined;
}
