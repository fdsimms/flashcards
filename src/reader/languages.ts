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
export function flaggedName(code: Language): string {
  return `${LANGUAGES[code].flag} ${LANGUAGES[code].name}`;
}

// The language with this name, for the language picker.
export function languageNamed(name: string): Language | undefined {
  return LANGUAGE_ORDER.find((code) => LANGUAGES[code].name === name);
}

// What a gloss-only language (Toki Pona) is shown as: its sentences are glossed and a word can be
// tapped, so it needs the name and the text's look, but it has no flag, voice or place in a picker
// (it isn't in `LANGUAGES` or `LANGUAGE_ORDER`, which every picker and settings page walks).
export const GLOSS_ONLY: Record<GlossOnlyLanguage, LanguageInfo> = {
  tok: { name: 'Toki Pona', flag: '🙂', ...SPACED, speech: 'en-US' },
};

/** The look of a language a card's sentence can be glossed in, a gloss-only one included. */
export function glossInfo(code: GlossLanguage): LanguageInfo {
  return isGlossOnly(code) ? GLOSS_ONLY[code] : LANGUAGES[code];
}

/** Whether `code` is a language that is only glossed: no texts, no note queue, nothing to add a word to. */
export function isGlossOnly(code: GlossLanguage): code is GlossOnlyLanguage {
  return code in GLOSS_ONLY;
}

/**
 * The server's `decks` (every language's, a gloss-only one's too) as the app keeps them: the text
 * languages' in `decks`, which features walk to find a language, and the rest in `glossOnlyDecks`.
 */
export function splitDecks(all: Record<string, string>): { decks: Record<Language, string>; glossOnlyDecks?: Partial<Record<GlossOnlyLanguage, string>> } {
  const { tok, ...decks } = all;
  return { decks: decks as Record<Language, string>, ...(tok ? { glossOnlyDecks: { tok } } : {}) };
}

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
