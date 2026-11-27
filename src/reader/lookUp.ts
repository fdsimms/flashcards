// Look it up (#258): a word tapped on an Anki-template card, or typed, pasted or shared into the Look
// up screen, glossed by Read & Listen's server as a card's sentence is (`/api/glosses`), with a meaning
// asked for one nothing has (`/api/word-meaning`). Pure, so it's tested; the screens are
// src/ui/LookUp.tsx and src/ui/PageLookUp.tsx. Nothing here grades a card or writes a note.
import type { Word } from './api';

/** The most text sent around a tapped word: the server glosses a sentence of up to 1,000 characters. */
export const MAX_CONTEXT = 900;

/** The words of a glossed text worth showing: not spaces or punctuation. */
export const lookedUpWords = (words: readonly Word[]): Word[] => words.filter((w) => w.status !== null);

/** A word with nothing known about it: the server couldn't gloss its text, so its meaning is asked for alone. */
export function bareWord(text: string): Word {
  return { text, status: 'unknown', gloss: null, stretch: false, deck: false, grammar: null };
}

/**
 * The tapped word among its text's glossed words: the one spelled the same (ignoring case), else the
 * one the tap's word is part of, or that's part of it (the server may join or split words the page
 * didn't), else the word alone.
 */
export function wordIn(words: readonly Word[], tapped: string): Word {
  const want = tapped.trim().toLocaleLowerCase();
  const shown = lookedUpWords(words);
  const same = (w: Word) => w.text.toLocaleLowerCase() === want;
  const overlaps = (w: Word) => {
    const t = w.text.toLocaleLowerCase();
    return t.length > 0 && (t.includes(want) || want.includes(t));
  };
  return shown.find(same) ?? shown.find(overlaps) ?? bareWord(tapped.trim());
}

/** The text around a tapped word, cut to `MAX_CONTEXT` characters around it so the server takes it. */
export function contextAround(text: string, word: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= MAX_CONTEXT) return flat;
  const at = Math.max(0, flat.indexOf(word));
  const start = Math.max(0, Math.min(at - MAX_CONTEXT / 2, flat.length - MAX_CONTEXT));
  return flat.slice(start, start + MAX_CONTEXT).trim();
}

/** Where a word stands with the learner, as a line under it. */
export function lookUpStatus(word: Pick<Word, 'status' | 'deck' | 'wanikani'>): string {
  switch (word.status) {
    case 'known':
      return word.deck ? 'In your deck' : word.wanikani ? 'Learned in WaniKani' : 'A common word you know';
    case 'partial':
      return 'Only in a phrase in your deck';
    case 'name':
      return 'A name';
    default:
      return word.deck ? "In your deck, not studied yet" : 'Not in your deck';
  }
}

/** Whether Add to deck is offered: a word the deck doesn't have, and not a name. */
export const canAdd = (word: Pick<Word, 'deck' | 'status'>): boolean => !word.deck && word.status !== 'name';

/** "A form of pieszy", when the word isn't its own dictionary form. */
export function formOf(word: Pick<Word, 'text' | 'lemma'>): string | null {
  const lemma = word.lemma?.trim();
  return lemma && lemma.toLocaleLowerCase() !== word.text.toLocaleLowerCase() ? `A form of ${lemma}` : null;
}
