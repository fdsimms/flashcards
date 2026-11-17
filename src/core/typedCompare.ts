import { toHiragana, toKana } from './kana';
import { stripMarks } from './letters';
import { opcodes } from './typeAnswer';

/**
 * What was typed against what was expected, for screens that draw the comparison natively: Type it
 * on a reverse card in Review, and Say it back and Write what you hear in Read & Listen. Anki's own
 * {{type:}} comparison (typeAnswer.ts) builds HTML for a template card; this gives parts a screen
 * can color, and says in plain words how close it was.
 *
 * Compared a letter at a time, where a letter is a base character with the marks that sit on it
 * (Thai's tone marks and vowels above or below, a combining accent), so a wrong tone mark marks the
 * whole syllable piece it sits on rather than an invisible mark of its own. Case is ignored. Nothing
 * here grades anything: the learner rates, or marks Missed it or Got it, themselves.
 */

export type DiffKind = 'same' | 'extra' | 'missing';

export interface DiffPart {
  text: string;
  kind: DiffKind;
}

export interface TypedComparison {
  /** What was typed: `same` where it matches, `extra` where it doesn't. */
  typed: DiffPart[];
  /** What was expected: `same` where it was matched, `missing` where it wasn't. */
  expected: DiffPart[];
  /** Every letter, space and punctuation mark matches (ignoring case). */
  exact: boolean;
  /** The letters and digits match, ignoring case, spacing and punctuation. */
  sameWords: boolean;
  /** The letters match once accents and other marks are taken off as well. */
  sameLetters: boolean;
  /** How many letters and digits are wrong: the larger of those missed and those typed in their place or added. */
  off: number;
  /** Right, but written in katakana where it's hiragana, or the other way round. */
  otherKana?: boolean;
}

/** A base character with the marks after it. */
function letters(s: string): string[] {
  const out: string[] = [];
  for (const ch of Array.from(s.normalize('NFC'))) {
    if (/^\p{M}/u.test(ch) && out.length) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

const isWordy = (cluster: string) => /[\p{L}\p{N}]/u.test(cluster);
const bare = (s: string) => stripMarks(s.normalize('NFKD'));
/** The letters and digits only, lower case: for sameWords (with marks) and sameLetters (without). */
const wordsOf = (s: string) => Array.from(folded(s)).filter((ch) => /[\p{L}\p{N}\p{M}]/u.test(ch)).join('');

/** Joins neighboring parts of the same kind, so a screen draws one span per run. */
function push(parts: DiffPart[], text: string, kind: DiffKind) {
  if (!text) return;
  const last = parts[parts.length - 1];
  if (last && last.kind === kind) last.text += text;
  else parts.push({ text, kind });
}

/**
 * Spelling variants every other answer check accepts (tools/answer.ts, forms.ts): ß written ss, and
 * a final ς written σ. Folded only to ask whether that is the sole difference.
 */
const folded = (s: string) => s.normalize('NFC').toLocaleLowerCase().replace(/ς/g, 'σ').replace(/ß/g, 'ss');

export function compareTyped(expected: string, typedRaw: string): TypedComparison {
  const want = expected.trim();
  const typedText = typedRaw.trim();
  if (typedText && folded(typedText) === folded(want)) {
    // Straße typed as Strasse: right, and shown as it was expected.
    return { typed: [{ text: typedText, kind: 'same' }], expected: [{ text: want, kind: 'same' }], exact: true, sameWords: true, sameLetters: true, off: 0 };
  }
  if (typedText && toHiragana(folded(typedText)) === toHiragana(folded(want))) {
    // ラーメン typed as らーめん: the same sounds, in the other kana.
    return { typed: [{ text: typedText, kind: 'same' }], expected: [{ text: want, kind: 'same' }], exact: false, sameWords: true, sameLetters: true, off: 0, otherKana: true };
  }
  const e = letters(want);
  const t = letters(typedText);
  const key = (cluster: string) => cluster.toLocaleLowerCase();
  const typed: DiffPart[] = [];
  const shown: DiffPart[] = [];
  let missed = 0;
  let extra = 0;
  for (const [tag, a1, a2, b1, b2] of opcodes(t.map(key), e.map(key))) {
    if (tag === 'equal') {
      push(typed, t.slice(a1, a2).join(''), 'same');
      push(shown, e.slice(b1, b2).join(''), 'same');
      continue;
    }
    push(typed, t.slice(a1, a2).join(''), 'extra');
    push(shown, e.slice(b1, b2).join(''), 'missing');
    missed += e.slice(b1, b2).filter(isWordy).length;
    extra += t.slice(a1, a2).filter(isWordy).length;
  }
  const sameWords = !!typedText && wordsOf(typedText) === wordsOf(want);
  return {
    typed,
    expected: shown,
    exact: !!typedText && t.length === e.length && t.every((ch, i) => key(ch) === key(e[i])),
    sameWords,
    sameLetters: !!typedText && bare(wordsOf(typedText)) === bare(wordsOf(want)),
    off: sameWords ? 0 : Math.max(missed, extra),
  };
}

/** How close a comparison is, best first: exact, then the same words, the same letters, fewest off. */
const closeness = (c: TypedComparison) => [c.exact ? 0 : 1, c.sameWords ? 0 : 1, c.sameLetters ? 0 : 1, c.off];

/**
 * What was typed against every right answer, keeping the closest: Type it on a Japanese card
 * accepts the word (食べる) or its reading (たべる). In Japanese, romaji typed on an English keyboard
 * is read as the kana it spells ("taberu" is たべる), as WaniKani's answer box reads it (kana.ts).
 */
export function compareTypedAnswer(answers: readonly string[], typedRaw: string, speechLang?: string): TypedComparison {
  const typed = speechLang?.startsWith('ja') && /[a-z]/i.test(typedRaw) ? toKana(typedRaw.trim(), true) : typedRaw;
  const tried = answers.filter((a) => a.trim()).map((a) => compareTyped(a, typed));
  if (!tried.length) return compareTyped('', typed);
  return tried.reduce((best, c) => {
    const [a, b] = [closeness(c), closeness(best)];
    const i = a.findIndex((n, k) => n !== b[k]);
    return i >= 0 && a[i] < b[i] ? c : best;
  });
}

/** One line on how close it was: "Exactly right.", "3 letters off.", and so on. */
export function comparisonLine(c: TypedComparison): string {
  if (c.exact) return 'Exactly right.';
  if (c.otherKana) return 'Right, but written in the other kana.';
  if (c.sameWords) return 'Right, apart from spacing or punctuation.';
  if (c.sameLetters) return `Right letters, but ${c.off === 1 ? 'one has' : `${c.off} have`} the wrong accent or mark.`;
  if (!c.typed.length) return 'Nothing typed.';
  return `${c.off} ${c.off === 1 ? 'letter' : 'letters'} off.`;
}
