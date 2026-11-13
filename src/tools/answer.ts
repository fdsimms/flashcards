import { foldUndecomposed, foldYo } from '../core/letters';
import type { Phrase } from './phrase';

/**
 * Checking a typed answer in a Practice tool's quiz, for any language: the answer is a phrase with
 * several accepted forms, and it's typed on a phone keyboard in a language the owner is still
 * learning to spell. So the check is lenient about what isn't spelling (spaces, punctuation, case:
 * Thai writes no spaces between words) and says exactly where the spelling went wrong:
 *
 * - exact: it matches an accepted form.
 * - close: it matches one but for marks on the letters (Thai tone and vowel marks and ์, Greek and
 *   Spanish accents, the breve of й, ø, ł typed as o, l and æ, œ as ae, oe). Ё typed as е is exact, as Russian
 *   usually writes it. Shown as a near miss, never as right, so a wrong spelling
 *   isn't reinforced.
 * - different: anything else.
 *
 * Nothing is scheduled or saved (tests/tools/noGrading.test.ts).
 */

export type Verdict = 'exact' | 'close' | 'different';

/** A stretch of text, `marked` when it's where the typed answer and the accepted form differ. */
export interface Segment {
  text: string;
  marked: boolean;
}

export interface Check {
  verdict: Verdict;
  /** The accepted form it was checked against: the one it matches, else the usual one. */
  expected: Phrase;
  /** What was typed, with the letters that aren't in `expected` marked. */
  typed: Segment[];
  /** `expected`, with the letters that weren't typed marked. */
  correct: Segment[];
  /** How many letters differ (a letter with its marks counts as one). */
  differing: number;
}

/** A letter with the marks on it, or one character that isn't part of the spelling (a space, a dot). */
interface Token {
  text: string;
  /** Lowercased; null for what isn't spelling. */
  key: string | null;
}

function tokens(s: string): Token[] {
  const out: Token[] = [];
  for (const ch of s.normalize('NFC')) {
    const last = out[out.length - 1];
    if (/\p{M}/u.test(ch) && last && last.key !== null) {
      last.text += ch;
      last.key += ch.toLocaleLowerCase();
    } else if (/[\p{L}\p{N}\p{M}]/u.test(ch)) {
      // ё folds in the key, not just the spelling, so the diff doesn't mark е against ё either; so
      // do full-width digits and letters (and half-width kana), which a Japanese keyboard types.
      const key = /[\uff00-\uffef]/.test(ch) ? ch.normalize('NFKC') : ch;
      out.push({ text: ch, key: foldYo(key.toLocaleLowerCase()) });
    } else {
      out.push({ text: ch, key: null });
    }
  }
  return out;
}

// Lowercased a letter at a time, a capital Σ is always σ, never the final ς; and ß may be written ss.
const spelling = (ts: Token[]) => ts.map((t) => t.key ?? '').join('').replace(/ς/g, 'σ').replace(/ß/g, 'ss');
/** The spelling without any marks: "มิ" and "มี" both become "ม", "øl" and "ol" both "ol". */
const unmarked = (ts: Token[]) => foldUndecomposed(spelling(ts).normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC'));

const plain = (ts: Token[]): Segment[] => [{ text: ts.map((t) => t.text).join(''), marked: false }];

function segmentsOf(ts: Token[], marked: Set<number>): Segment[] {
  const out: Segment[] = [];
  ts.forEach((t, i) => {
    const m = marked.has(i);
    const last = out[out.length - 1];
    if (last && last.marked === m) last.text += t.text;
    else out.push({ text: t.text, marked: m });
  });
  return out;
}

/** The letters of each that the other doesn't have in the same order (a longest common subsequence), by token index. */
function diff(a: Token[], b: Token[]): [Set<number>, Set<number>] {
  const ai = a.flatMap((t, i) => (t.key === null ? [] : [i]));
  const bi = b.flatMap((t, i) => (t.key === null ? [] : [i]));
  const n = ai.length;
  const m = bi.length;
  const table = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[ai[i]].key === b[bi[j]].key ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const markedA = new Set(ai);
  const markedB = new Set(bi);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[ai[i]].key === b[bi[j]].key) {
      markedA.delete(ai[i]);
      markedB.delete(bi[j]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return [markedA, markedB];
}

/** `typed` against the accepted forms of an answer (the first is the usual one). */
export function checkTyped(typed: string, accepted: Phrase[]): Check {
  if (!accepted.length) throw new RangeError('No accepted forms to check against');
  const t = tokens(typed);
  const forms = accepted.map((phrase) => ({ phrase, tokens: tokens(phrase.text) }));
  if (!spelling(t)) {
    return { verdict: 'different', expected: forms[0].phrase, typed: [], correct: plain(forms[0].tokens), differing: 0 };
  }

  const scored = forms.map((f) => {
    const [markedTyped, markedCorrect] = diff(t, f.tokens);
    return { f, markedTyped, markedCorrect, cost: markedTyped.size + markedCorrect.size };
  });
  const exact = scored.filter((s) => spelling(s.f.tokens) === spelling(t));
  const close = scored.filter((s) => unmarked(s.f.tokens) === unmarked(t));
  // A wrong answer is shown against the usual form, not whichever shortened one happens to be nearest.
  const pool = exact.length ? exact : close.length ? close : [scored[0]];
  const best = pool.reduce((a, b) => (b.cost < a.cost ? b : a));
  const verdict: Verdict = exact.length ? 'exact' : close.length ? 'close' : 'different';
  return {
    verdict,
    expected: best.f.phrase,
    typed: verdict === 'exact' ? plain(t) : segmentsOf(t, best.markedTyped),
    correct: verdict === 'exact' ? plain(best.f.tokens) : segmentsOf(best.f.tokens, best.markedCorrect),
    differing: Math.max(best.markedTyped.size, best.markedCorrect.size),
  };
}
