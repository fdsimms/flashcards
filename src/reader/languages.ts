// What the app says and shows differently per language. Thai counts only deck words as known;
// every other language also counts as many of its most common words as its setting says (and
// Japanese its WaniKani words)
// (docs/read-and-listen/architecture.md, Languages).
import type { CommonCount, GlossLanguage, GlossOnlyLanguage, Language, Word } from './api';

type LanguageInfo = {
  name: string;
  flag: string; // a flag emoji, to tell the languages apart at a glance (the language isn't the country, so it's only a cue)
  fontSize: number; // Thai sits bigger than Latin text at the same size
  lineHeight: number; // Thai needs room for marks above and below
  highlightLabel: string; // what the highlighted words are, as the key names them
  speech: string; // the phone voice's language for a tapped word, the same as Review reads these decks in
};

const SPACED = { fontSize: 20, lineHeight: 1.5, highlightLabel: 'Might be new to you' };

export const LANGUAGES: Record<Language, LanguageInfo> = {
  th: { name: 'Thai', flag: '🇹🇭', fontSize: 23, lineHeight: 1.75, highlightLabel: 'Not in your deck', speech: 'th-TH' },
  es: { name: 'Spanish', flag: '🇲🇽', ...SPACED, speech: 'es-MX' },
  de: { name: 'German', flag: '🇩🇪', ...SPACED, speech: 'de-DE' },
  fr: { name: 'French', flag: '🇫🇷', ...SPACED, speech: 'fr-FR' },
  ru: { name: 'Russian', flag: '🇷🇺', ...SPACED, speech: 'ru-RU' },
  el: { name: 'Greek', flag: '🇬🇷', ...SPACED, speech: 'el-GR' },
  pl: { name: 'Polish', flag: '🇵🇱', ...SPACED, speech: 'pl-PL' },
  nb: { name: 'Norwegian', flag: '🇳🇴', ...SPACED, speech: 'nb-NO' },
  en: { name: 'English', flag: '🇺🇸', ...SPACED, speech: 'en-US' },
  // Written without spaces, and kanji want room for their strokes; a word's reading is its kana.
  ja: { name: 'Japanese', flag: '🇯🇵', fontSize: 21, lineHeight: 1.7, highlightLabel: 'Might be new to you', speech: 'ja-JP' },
};

// Thai and Spanish came first; the rest are in alphabetical order.
export const LANGUAGE_ORDER: Language[] = ['th', 'es', 'fr', 'de', 'el', 'en', 'ja', 'nb', 'pl', 'ru'];

// The language's name with its flag, for a menu row or a header button.
export function flaggedName(code: GlossLanguage): string {
  const info = glossInfo(code);
  return `${info.flag} ${info.name}`;
}

// The language with this name, for the language picker.
export function languageNamed(name: string): Language | undefined {
  return LANGUAGE_ORDER.find((code) => LANGUAGES[code].name === name);
}

// What Toki Pona is shown as. It has no voices, so texts in it are read and never heard, and it
// isn't in `LANGUAGES` or `LANGUAGE_ORDER`, which every voice, Practice and lesson screen walks:
// anything that can show it asks `glossInfo`.
export const GLOSS_ONLY: Record<GlossOnlyLanguage, LanguageInfo> = {
  tok: { name: 'Toki Pona', flag: '🙂', ...SPACED, speech: 'en-US' },
};

/** The look of a language a card's sentence can be glossed in, a gloss-only one included. */
export function glossInfo(code: GlossLanguage): LanguageInfo {
  // An unknown code is kept out at the API (`isKnownLanguage`); this is the backstop for one that
  // slips past, so a name or a flag never throws on a language this build doesn't know.
  return (isGlossOnly(code) ? GLOSS_ONLY[code] : LANGUAGES[code]) ?? { name: String(code), flag: '🌐', ...SPACED, speech: 'en-US' };
}

/**
 * Whether `code`, as the server sent it, is a language this build of the app knows. The server
 * updates itself as soon as a change merges, so it can name a language added after the app on the
 * phone was built, and looking that one up crashed the Read & Listen screen. What reads languages
 * from the server drops the rest (`settingsFromServer`, `shelfFromServer` and the rest in api.ts).
 */
export function isKnownLanguage(code: string): code is GlossLanguage {
  return Object.hasOwn(LANGUAGES, code) || Object.hasOwn(GLOSS_ONLY, code);
}

/** `map` without the languages this build doesn't know (`isKnownLanguage`). */
export function knownLanguagesOf<T>(map: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(map).filter(([code]) => isKnownLanguage(code)));
}

/** Whether `code` is a language with no voices (Toki Pona): its texts are read, not heard, and no lesson or Practice tool covers it. */
export function isGlossOnly(code: GlossLanguage): code is GlossOnlyLanguage {
  return Object.hasOwn(GLOSS_ONLY, code);
}

/**
 * The server's `decks` (every language's, one without voices too) as the app keeps them: the spoken
 * languages' in `decks`, which features walk to find a language, and the rest in `glossOnlyDecks`.
 */
export function splitDecks(all: Record<string, string>): { decks: Record<Language, string>; glossOnlyDecks?: Partial<Record<GlossOnlyLanguage, string>> } {
  const { tok, ...decks } = all;
  return { decks: decks as Record<Language, string>, ...(tok ? { glossOnlyDecks: { tok } } : {}) };
}

/** `language` if it has voices, which is what Practice, lessons and the rest of the app's tools cover; undefined for Toki Pona. */
export function spokenLanguage(language: GlossLanguage | undefined): Language | undefined {
  return language && !isGlossOnly(language) ? language : undefined;
}

/** The deck of any language the server names, a gloss-only one's included, or undefined when settings don't carry it. */
export function deckOf(settings: { decks?: Partial<Record<Language, string>>; glossOnlyDecks?: Partial<Record<GlossOnlyLanguage, string>> } | null | undefined, language: GlossLanguage): string | undefined {
  return isGlossOnly(language) ? settings?.glossOnlyDecks?.[language] : settings?.decks?.[language];
}

/** Every language a text can be in, in the order a picker lists them: the app's languages, then Toki Pona (read, never heard). */
export const TEXT_LANGUAGE_ORDER: GlossLanguage[] = [...LANGUAGE_ORDER, 'tok'];

export const COMMON_COUNTS: CommonCount[] = [0, 250, 500, 1000, 2000, 3000, 5000, 10000];

// How a common-words count is shown, and back.
export function commonLabel(count: CommonCount): string {
  return count === 0 ? 'None' : count.toLocaleString('en-US');
}
export function commonNamed(label: string): CommonCount | undefined {
  return COMMON_COUNTS.find((count) => commonLabel(count) === label);
}

/**
 * A word's meaning as the gloss popover and the marked words list show it: its gloss, else, for a
 * compound known from its parts, the parts' meanings labeled as parts, since what they say together
 * is often not what the word means (เข้าใจ is "understand", not "enter + heart").
 */
export function meaningOf(word: Pick<Word, 'gloss' | 'parts'>): string {
  if (word.gloss) return word.gloss;
  if (word.parts) return `Parts: ${word.parts}`;
  return 'No meaning available';
}

/**
 * Whether a tapped word has no meaning to show and is worth looking up: a real word (not a name, a
 * space or punctuation) with no gloss and no parts. The popover asks the server for one then, when
 * its screen knows the line the word is in (`meaningLookup`).
 */
export function needsMeaning(word: Pick<Word, 'status' | 'gloss' | 'parts'>): boolean {
  return word.status !== null && word.status !== 'name' && !word.gloss && !word.parts;
}

// The popover leaves this line out when the frequency meter already says the word is common.
export const COMMON_WORD_STATUS = 'A common word';

/** Whether the word's note is in the deck: the popover shows an icon for it, the marked words list says it. */
export function inDeck(word: Pick<Word, 'status' | 'deck'>): boolean {
  return !!word.deck && word.status !== 'name' && word.status !== 'partial' && word.status !== 'unknown';
}

// For the marked words list, and the gloss popover where `inDeck` has no icon to say it.
export function wordStatus(word: Pick<Word, 'status' | 'deck' | 'wanikani'>): string {
  if (word.status === 'name') return 'A name';
  if (word.status === 'partial') return 'Only inside a longer phrase in your deck';
  if (word.status === 'unknown') return 'Not in your deck';
  if (inDeck(word)) return 'In your deck';
  return word.wanikani ? 'Learned in WaniKani' : COMMON_WORD_STATUS;
}

/**
 * Where a word's IPA is from, for the tooltip on the gloss popover's IPA: Wiktionary's, or written by AI,
 * which can be wrong (stress most of all), so it says so. None when the word has no IPA.
 */
export function ipaNote(word: Pick<Word, 'ipa' | 'ipa_source'>): string | null {
  if (!word.ipa) return null;
  if (word.ipa_source === 'ai') return 'IPA written by AI, may be wrong';
  return word.ipa_source === 'rules' ? 'IPA from the kana reading, approximate' : 'IPA from Wiktionary';
}
