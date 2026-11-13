// What the app says and shows differently per language. Thai counts only deck words as known;
// every other language also counts as many of its most common words as its setting says (and
// Japanese its WaniKani words)
// (docs/read-and-listen/architecture.md, Languages).
import type { CommonCount, Language, Word } from './api';

type LanguageInfo = {
  name: string;
  flag: string; // a flag emoji, to tell the languages apart at a glance (the language isn't the country, so it's only a cue)
  fontSize: number; // Thai sits bigger than Latin text at the same size
  lineHeight: number; // Thai needs room for marks above and below
  highlightLabel: string; // what the highlighted words are, as the key names them
  speech: string; // the phone voice's language for a tapped word, the same as Review reads these decks in
  translitLabel: string; // the gloss popover's button that shows a word's pronunciation
};

const SPACED = { fontSize: 20, lineHeight: 1.5, highlightLabel: 'Might be new to you', translitLabel: 'Show transliteration' };

export const LANGUAGES: Record<Language, LanguageInfo> = {
  th: { name: 'Thai', flag: '🇹🇭', fontSize: 23, lineHeight: 1.75, highlightLabel: 'Not in your deck', speech: 'th-TH', translitLabel: 'Show transliteration' },
  es: { name: 'Spanish', flag: '🇲🇽', ...SPACED, speech: 'es-MX' },
  de: { name: 'German', flag: '🇩🇪', ...SPACED, speech: 'de-DE' },
  fr: { name: 'French', flag: '🇫🇷', ...SPACED, speech: 'fr-FR' },
  ru: { name: 'Russian', flag: '🇷🇺', ...SPACED, speech: 'ru-RU' },
  el: { name: 'Greek', flag: '🇬🇷', ...SPACED, speech: 'el-GR' },
  pl: { name: 'Polish', flag: '🇵🇱', ...SPACED, speech: 'pl-PL' },
  nb: { name: 'Norwegian', flag: '🇳🇴', ...SPACED, speech: 'nb-NO' },
  // Written without spaces, and kanji want room for their strokes; a word's reading is its kana.
  ja: { name: 'Japanese', flag: '🇯🇵', fontSize: 21, lineHeight: 1.7, highlightLabel: 'Might be new to you', speech: 'ja-JP', translitLabel: 'Show reading' },
};

// Thai and Spanish came first; the rest are in alphabetical order.
export const LANGUAGE_ORDER: Language[] = ['th', 'es', 'fr', 'de', 'el', 'ja', 'nb', 'pl', 'ru'];

// The language's name with its flag, for a menu row or a header button.
export function flaggedName(code: Language): string {
  return `${LANGUAGES[code].flag} ${LANGUAGES[code].name}`;
}

// The language with this name, for the language picker.
export function languageNamed(name: string): Language | undefined {
  return LANGUAGE_ORDER.find((code) => LANGUAGES[code].name === name);
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

// For the gloss popover and the marked words list.
export function wordStatus(word: Pick<Word, 'status' | 'deck' | 'wanikani'>): string {
  if (word.status === 'name') return 'A name';
  if (word.status === 'partial') return 'Only inside a longer phrase in your deck';
  if (word.status === 'unknown') return 'Not in your deck';
  if (word.deck) return 'In your deck';
  return word.wanikani ? 'Learned in WaniKani' : 'A common word';
}
