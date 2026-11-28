import { textKey, type Cram, type CramPhrase } from './cram';

/**
 * A cram's phrases (cram.ts `CramPhrase`): lines to practice for the day that aren't notes. They are
 * typed in Add or suggested (`CramSuggest`), listened to, rehearsed and tried in a round, and a card
 * is made from one only when the learner asks (its menu's Make a card). Nothing here writes a note
 * or grades a card.
 */

/** The most phrases a cram keeps. */
export const MAX_PHRASES = 60;

/** What a phrase is known by: its text, tidied, so the same line added twice is one. */
export const phraseKey = (phrase: Pick<CramPhrase, 'text'>): string => textKey(phrase.text);

const tidy = (p: CramPhrase): CramPhrase => ({
  text: p.text.replace(/\s+/g, ' ').trim(),
  english: p.english.replace(/\s+/g, ' ').trim(),
  ...(p.reading?.trim() ? { reading: p.reading.replace(/\s+/g, ' ').trim() } : {}),
});

/** What adding phrases did: the cram, and how many were added, were already on it, or didn't fit (`MAX_PHRASES`). */
export interface PhraseAddition {
  cram: Cram;
  added: number;
  already: number;
  full: number;
}

/**
 * The cram with `added` on the end of its phrases: one already there (by its text) or with no text or
 * meaning is left out, and none past `MAX_PHRASES` is added. Says what became of each, so a screen never
 * reports one it left out as added.
 */
export function addPhrases(cram: Cram, added: CramPhrase[]): PhraseAddition {
  const have = new Set((cram.phrases ?? []).map(phraseKey));
  const next = [...(cram.phrases ?? [])];
  let already = 0;
  let full = 0;
  for (const phrase of added.map(tidy)) {
    if (!phrase.text || !phrase.english) continue;
    if (have.has(phraseKey(phrase))) { already++; continue; }
    if (next.length >= MAX_PHRASES) { full++; continue; }
    have.add(phraseKey(phrase));
    next.push(phrase);
  }
  return { cram: { ...cram, phrases: next }, added: next.length - (cram.phrases ?? []).length, already, full };
}

/**
 * What a screen says after adding phrases, or undefined when every one was added (the screen's own
 * success says that): "Added 2 phrases. 1 was already on the cram. 3 didn't fit: a cram holds 60 phrases."
 */
export function phrasesNotAddedText({ added, already, full }: Omit<PhraseAddition, 'cram'>): string | undefined {
  if (!already && !full) return undefined;
  const parts = [added ? `Added ${added === 1 ? '1 phrase' : `${added} phrases`}.` : 'Nothing was added.'];
  if (already) parts.push(already === 1 ? '1 was already on the cram.' : `${already} were already on the cram.`);
  if (full) parts.push(`${full === 1 ? "1 didn't" : `${full} didn't`} fit: a cram holds ${MAX_PHRASES} phrases.`);
  return parts.join(' ');
}

/** The cram without the phrase with this text, and without its check mark. */
export function withoutPhrase(cram: Cram, text: string): Cram {
  const key = textKey(text);
  return {
    ...cram,
    phrases: (cram.phrases ?? []).filter((p) => phraseKey(p) !== key),
    usedPhrases: (cram.usedPhrases ?? []).filter((k) => k !== key),
  };
}

/** The cram with the phrase that had text `was` replaced by `next`, keeping its place and its check mark's meaning (a changed text is a new phrase, so unchecked). */
export function withPhraseEdited(cram: Cram, was: string, next: CramPhrase): Cram {
  const key = textKey(was);
  const edited = tidy(next);
  if (!edited.text || !edited.english) return cram;
  const clash = (cram.phrases ?? []).some((p) => phraseKey(p) !== key && phraseKey(p) === phraseKey(edited));
  if (clash) return cram;
  return {
    ...cram,
    phrases: (cram.phrases ?? []).map((p) => (phraseKey(p) === key ? edited : p)),
    usedPhrases: (cram.usedPhrases ?? []).filter((k) => k !== key || phraseKey(edited) === key),
  };
}

/** The cram with a phrase checked off as used, or back. */
export function withPhraseUsed(cram: Cram, text: string, used: boolean): Cram {
  const key = textKey(text);
  const rest = (cram.usedPhrases ?? []).filter((k) => k !== key);
  return { ...cram, usedPhrases: used ? [...rest, key] : rest };
}

export const phraseIsUsed = (cram: Pick<Cram, 'usedPhrases'>, phrase: Pick<CramPhrase, 'text'>): boolean => (cram.usedPhrases ?? []).includes(phraseKey(phrase));

/** A phrase's id in a practice round, which also holds notes' ids: the id can't be a note's, since no note id starts "phrase:". */
export const phraseRoundId = (phrase: Pick<CramPhrase, 'text'>): string => `phrase:${phraseKey(phrase)}`;
export const isPhraseRoundId = (id: string): boolean => id.startsWith('phrase:');
/** The phrase a round id names, or undefined when it was removed after the round began. */
export const phraseOfRoundId = (cram: Pick<Cram, 'phrases'>, id: string): CramPhrase | undefined => (cram.phrases ?? []).find((p) => phraseRoundId(p) === id);
