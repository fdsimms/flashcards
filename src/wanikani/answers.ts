import { hasJapanese, isKana, toHiragana, toKana } from './kana';
import type { Subject } from './subjects';

/**
 * Checking a typed answer the way WaniKani's own review page does, as far as it publishes its
 * rules: a meaning may have a small typo (more for a longer word), a reading must be exact, a
 * blacklisted meaning is wrong however close, and the user's own synonyms count. Typing the wrong
 * kind of answer (kana for a meaning, or a kanji's other reading) asks again rather than marking
 * it wrong, as WaniKani's shake does.
 */

export type Verdict =
  | { result: 'correct'; close?: boolean }
  | { result: 'wrong' }
  /** Not graded: shown as a message, and the same question stays up. */
  | { result: 'retry'; message: string };

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

export function checkMeaning(subject: Subject, synonyms: string[], typed: string): Verdict {
  const answer = normalizeMeaning(typed);
  if (!answer) return { result: 'retry', message: 'Type the meaning.' };
  if (hasJapanese(typed)) return { result: 'retry', message: 'That looks like the reading. Type the meaning in English.' };
  // Blacklisted extras, and meanings WaniKani lists but won't take, are wrong even when close to a right one.
  const blacklist = [
    ...subject.auxiliaryMeanings.filter((m) => m.type === 'blacklist').map((m) => m.meaning),
    ...subject.meanings.filter((m) => !m.accepted).map((m) => m.meaning),
  ].map(normalizeMeaning);
  if (blacklist.includes(answer)) return { result: 'wrong' };
  const accepted = [
    ...subject.meanings.filter((m) => m.accepted).map((m) => m.meaning),
    ...subject.auxiliaryMeanings.filter((m) => m.type === 'whitelist').map((m) => m.meaning),
    ...synonyms,
  ].map(normalizeMeaning).filter(Boolean);
  if (accepted.includes(answer)) return { result: 'correct' };
  const close = accepted.some((m) => levenshtein(answer, m) <= typoAllowance(m.length));
  return close ? { result: 'correct', close: true } : { result: 'wrong' };
}

export function checkReading(subject: Subject, typed: string): Verdict {
  const answer = toHiragana(toKana(typed.trim(), true)).replace(/\s/g, '');
  if (!answer) return { result: 'retry', message: 'Type the reading.' };
  if (!isKana(answer)) return { result: 'retry', message: 'Type the reading in kana. Romaji turns into kana as you type.' };
  const norm = (r: string) => toHiragana(r).replace(/\s/g, '');
  if (subject.readings.some((r) => r.accepted && norm(r.reading) === answer)) return { result: 'correct' };
  // A kanji's reading WaniKani isn't asking for (its kun'yomi when it teaches the on'yomi) gets another try.
  const other = subject.readings.find((r) => !r.accepted && norm(r.reading) === answer);
  if (other && subject.type === 'kanji') {
    const wanted = subject.readings.find((r) => r.accepted)?.type;
    const name = wanted === 'onyomi' ? "on'yomi" : wanted === 'kunyomi' ? "kun'yomi" : 'other reading';
    return { result: 'retry', message: `That's one of its readings, but WaniKani wants the ${name}.` };
  }
  return { result: 'wrong' };
}
