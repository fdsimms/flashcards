/**
 * Quick add (src/ui/QuickAdd.tsx): words typed one at a time or pasted as a list, each either sent
 * to Read & Listen's note queue for Claude to fill in, or, for a deck Claude doesn't fill in, saved
 * straight to the deck as a word and its meaning. Pure, so the screen's decisions are tested here.
 */
import { keyboardLanguageFor } from './keyboardLanguage';
import { toKana } from './kana';

/** One word on the list: as typed, and the owner's own meaning, or empty to leave it to Claude. */
export interface QuickWord {
  entry: string;
  meaning: string;
  /** Add it though the deck already has it (the row's "Add anyway"). */
  anyway?: boolean;
}

/**
 * A ready word that could be more than one word (typed the way it sounds), for the note editor to ask
 * which one was meant: what was typed, and the words, the one the note was filled in for first.
 */
export interface WordChoice {
  typed: string;
  words: { entry: string; meaning: string }[];
}

/** A word Claude found for a meaning typed in English ("Don't know the word?"). */
export interface FoundWord {
  entry: string;
  meaning: string;
  /** What tells it apart from the other words found; empty when there's nothing to say. */
  note: string;
}

/** The most words one Quick add sends to the queue; the server refuses more. */
export const MAX_QUEUED = 50;

/** A line as a word and its meaning, after a spaced dash or a tab ("bouder - to sulk"), or null when blank. */
export function splitLine(line: string): QuickWord | null {
  const [first, ...rest] = line.trim().split(/\s+[-–—]\s+|\t+/);
  const entry = first.trim();
  if (!entry) return null;
  return { entry, meaning: rest.join(' - ').trim() };
}

/**
 * A pasted list as words: one per line, blank lines skipped. A line repeating an earlier word is
 * counted in `repeated`, so the screen can say it was left out.
 */
export function parseWordList(text: string): { words: QuickWord[]; repeated: number } {
  const seen = new Set<string>();
  const words: QuickWord[] = [];
  let repeated = 0;
  for (const raw of text.split(/\r?\n/)) {
    const word = splitLine(raw);
    if (!word) continue;
    if (seen.has(word.entry)) { repeated++; continue; }
    seen.add(word.entry);
    words.push(word);
  }
  return { words, repeated };
}

/** The list with `word` added on top; the same word typed again replaces its earlier row. */
export function addWord(list: readonly QuickWord[], word: QuickWord): QuickWord[] {
  return [word, ...list.filter((w) => w.entry !== word.entry)];
}

/**
 * Whether `text` is a word typed in Latin letters for a language written in another script (Russian,
 * Thai, Japanese...): "torgovatsya" for a Russian deck. Digits and punctuation don't count either way.
 */
export function inLatinLetters(text: string, speechTag: string | undefined): boolean {
  const language = keyboardLanguageFor(speechTag);
  if (!language || language === 'en') return false;
  return /\p{Script=Latin}/u.test(text) && !/[^\p{Script=Latin}\p{N}\p{P}\p{Z}\p{S}]/u.test(text);
}

/**
 * What a word typed for a Japanese deck reads as while it's typed, when nothing will spell it later
 * (no Claude): romaji turns into kana, as WaniKani's answer box does. Anything else is left as typed.
 * `final` turns a trailing n into ん, for the word as it's added.
 */
export function asTyped(text: string, speechTag: string | undefined, final = false): string {
  return keyboardLanguageFor(speechTag) === 'ja' && /[A-Za-z]/.test(text) ? toKana(text, final) : text;
}

/**
 * Where a word on the list stands:
 * - `add`: it will be added (queued, or saved to the deck);
 * - `spell`: typed in Latin letters, and Claude will find how it's really written;
 * - `inDeck`: the deck already has it (`inDeck` names where), so it isn't counted unless "Add anyway";
 * - `needsMeaning`: saved without Claude, a word needs its meaning;
 * - `needsScript`: saved without Claude, a word in Latin letters for a language with its own script
 *   would go in as typed, so it's refused with the reason instead.
 */
export type WordState = 'add' | 'spell' | 'inDeck' | 'needsMeaning' | 'needsScript';

export function wordState(word: QuickWord, opts: { filled: boolean; speechTag?: string; inDeck?: string }): WordState {
  const latin = inLatinLetters(word.entry, opts.speechTag);
  if (opts.inDeck && !word.anyway) return 'inDeck';
  if (opts.filled) return latin ? 'spell' : 'add';
  if (latin) return 'needsScript';
  if (!word.meaning) return 'needsMeaning';
  return 'add';
}

/** Whether a word in this state is added when the owner taps Add. */
export const counts = (state: WordState): boolean => state === 'add' || state === 'spell';
