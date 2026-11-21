import { hasJapanese, isKana, toHiragana, toKana } from '../core/kana';
import type { Subject } from './subjects';

/**
 * Checking a typed answer the way WaniKani's own review page does, as far as it publishes its
 * rules: a meaning may have a small typo (more for a longer word), a reading must be exact, a
 * blacklisted meaning is wrong however close, and the user's own synonyms count. Typing the wrong
 * kind of answer (kana or romaji reading for a meaning, or a kanji's other reading) asks again rather than marking
 * it wrong, as WaniKani's shake does. When that other kind is the right answer to the item's other
 * question (its reading typed for the meaning, or its meaning typed for the reading), the retry says
 * which (`credit`), so the screen can count that question as answered if it is still waiting.
 */

export type Verdict =
  | { result: 'correct'; close?: boolean }
  | { result: 'wrong' }
  /** Not graded: shown as a message, and the same question stays up. */
  | { result: 'retry'; message: string; credit?: 'meaning' | 'reading' };

/** Lowercase, punctuation out, single spaces: "Grown-up" and "grown up" are the same answer. */
export function normalizeMeaning(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/**
 * How many typos a meaning of this length may have: none up to 3 letters, then more as it grows.
 * The steps are those of WaniKani's former review script, from memory; not checked against the
 * current site.
 */
export function typoAllowance(length: number): number {
  if (length <= 3) return 0;
  if (length <= 5) return 1;
  if (length <= 7) return 2;
  return 2 + Math.floor(length / 7);
}

/** Lowercased meanings WaniKani lists but won't take, and extras it blacklists: wrong however close. */
function isBlacklisted(subject: Subject, answer: string): boolean {
  return [
    ...subject.auxiliaryMeanings.filter((m) => m.type === 'blacklist').map((m) => m.meaning),
    ...subject.meanings.filter((m) => !m.accepted).map((m) => m.meaning),
  ].map(normalizeMeaning).includes(answer);
}

function acceptedMeanings(subject: Subject, synonyms: string[]): string[] {
  return [
    ...subject.meanings.filter((m) => m.accepted).map((m) => m.meaning),
    ...subject.auxiliaryMeanings.filter((m) => m.type === 'whitelist').map((m) => m.meaning),
    ...synonyms,
  ].map(normalizeMeaning).filter(Boolean);
}

/** Whether the text, in kana or romaji, is one of the subject's readings (accepted or not). */
function readingIs(subject: Subject, typed: string): boolean {
  const answer = toHiragana(toKana(typed.trim(), true)).replace(/\s/g, '');
  return isKana(answer) && subject.readings.some((r) => toHiragana(r.reading).replace(/\s/g, '') === answer);
}

export function checkMeaning(subject: Subject, synonyms: string[], typed: string): Verdict {
  const answer = normalizeMeaning(typed);
  if (!answer) return { result: 'retry', message: 'Type the meaning.' };
  const sameReading = readingIs(subject, typed);
  if (hasJapanese(typed)) return { result: 'retry', message: 'That looks like the reading. Type the meaning in English.', ...(sameReading && { credit: 'reading' as const }) };
  // Blacklisted extras, and meanings WaniKani lists but won't take, are wrong even when close to a right one.
  if (isBlacklisted(subject, answer)) return { result: 'wrong' };
  const accepted = acceptedMeanings(subject, synonyms);
  if (accepted.includes(answer)) return { result: 'correct' };
  // The reading typed in romaji ("fuyu" for 冬) is the wrong kind of answer, not a wrong meaning: ask again.
  if (sameReading) return { result: 'retry', message: 'That looks like the reading. Type the meaning in English.', credit: 'reading' };
  const close = accepted.some((m) => closeEnough(answer, m));
  return close ? { result: 'correct', close: true } : { result: 'wrong' };
}

/**
 * A typo away from a meaning. With as many words as the meaning, each word gets its own word's
 * allowance as well: measured over the whole, "to eat" (6 letters, 2 typos) took "to sit", "to cut"
 * and "to get", and "two things" took "six things", each a different word with the short one wrong.
 */
function closeEnough(answer: string, meaning: string): boolean {
  if (levenshtein(answer, meaning) > typoAllowance(meaning.length)) return false;
  const typed = answer.split(' ');
  const words = meaning.split(' ');
  if (typed.length !== words.length) {
    // Split differently ("grown up" for "grownup"), so words can't be paired: a typed exact-only
    // word has to be in the meaning too.
    return typed.every((t) => !EXACT_WORDS.has(t) || words.includes(t));
  }
  // A typed word that is itself another of these words is a different answer, not a typo; a typo
  // of one ("rigth" for Right) is still a typo.
  return words.every((w, i) => typed[i] === w || (!EXACT_WORDS.has(typed[i]) && levenshtein(typed[i], w) <= typoAllowance(w.length)));
}

/**
 * Words a typo allowance would turn into another real word: "fire" passed for Five, "monday" for
 * Sunday, "mouth" for Month, "hour" for Four. Where one of these is typed in place of a different
 * word, it's wrong rather than close.
 */
const EXACT_WORDS = new Set([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
  'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'hour', 'for', 'fire', 'right', 'weight', 'month', 'mouth', 'line', 'tin', 'man', 'men', 'woman', 'women',
]);

export function checkReading(subject: Subject, typed: string, synonyms: string[] = []): Verdict {
  const answer = toHiragana(toKana(typed.trim(), true)).replace(/\s/g, '');
  if (!answer) return { result: 'retry', message: 'Type the reading.' };
  if (!isKana(answer)) {
    const meaning = normalizeMeaning(typed);
    const isMeaning = !!meaning && !isBlacklisted(subject, meaning) && acceptedMeanings(subject, synonyms).includes(meaning);
    return { result: 'retry', message: 'Type the reading in kana. Romaji turns into kana as you type.', ...(isMeaning && { credit: 'meaning' as const }) };
  }
  const norm = (r: string) => toHiragana(r).replace(/\s/g, '');
  if (subject.readings.some((r) => r.accepted && norm(r.reading) === answer)) return { result: 'correct' };
  // A kanji's reading WaniKani isn't asking for (its kun'yomi when it teaches the on'yomi) gets another try.
  const other = subject.readings.find((r) => !r.accepted && norm(r.reading) === answer);
  if (other && subject.type === 'kanji') {
    const readingName = (t: string | undefined) => (t === 'onyomi' ? "on'yomi" : t === 'kunyomi' ? "kun'yomi" : null);
    const wanted = readingName(subject.readings.find((r) => r.accepted)?.type);
    const given = readingName(other.type);
    if (wanted && given) return { result: 'retry', message: `That's the ${given} reading. Enter the ${wanted} reading.` };
    return { result: 'retry', message: wanted ? `Enter the ${wanted} reading.` : "That's not the reading WaniKani wants here. Try another." };
  }
  return { result: 'wrong' };
}
