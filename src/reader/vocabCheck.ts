// The vocabulary check: 20 questions on a language's most common words, adaptive, that suggest the
// "Common words counted as known" setting (docs/read-and-listen/architecture.md, Languages). The
// questions come from the server's bank (server/reader/src/franki_reader/vocab_check.py), which
// samples the same bands as BANDS here. Pure: nothing here grades or writes a card, and the result
// is only a suggestion the learner accepts or not.
import type { CommonCount } from './api';

export type VocabItem = { word: string; rank: number; meaning: string; wrong: string[] };
export type Reply = 'right' | 'wrong' | 'skipped';
export type Asked = { item: VocabItem; reply: Reply; /** The meaning picked, when the answer was a choice. */ picked?: string };

/** Ranks in the language's common-word list, as the server samples them. Each setting from 250 up lands on a band's edge. */
export const BANDS: readonly { from: number; to: number }[] = [
  { from: 1, to: 100 },
  { from: 101, to: 250 },
  { from: 251, to: 500 },
  { from: 501, to: 1000 },
  { from: 1001, to: 2000 },
  { from: 2001, to: 3000 },
  { from: 3001, to: 5000 },
  { from: 5001, to: 10000 },
];

export const QUESTIONS = 20;
/** Where the questions start: the 251 to 500 band, where a learner two or three Duolingo units in is likely to be. */
export const START_BAND = 2;
/** A setting is suggested while at least this share of the words it counts as known are ones the learner knows. Texts are checked at 95 to 98%, so this leaves them room. */
export const KNOWN_SHARE = 0.9;
/** The settings the quiz can suggest, each ending on a band. Below the first is None. */
export const SUGGESTABLE: readonly CommonCount[] = [250, 500, 1000, 2000, 3000, 5000, 10000];
/** A wrong answer picked from four choices is a guess a quarter of the time, so each wrong answer takes a third of a right one away. */
const GUESS_PENALTY = 1 / 3;

export type Rng = () => number;

export function bandOf(rank: number): number {
  return BANDS.findIndex((b) => rank >= b.from && rank <= b.to);
}

/** "251 to 500", with thousands separators. */
export function bandLabel(band: number): string {
  const { from, to } = BANDS[band];
  return `${from.toLocaleString('en-US')} to ${to.toLocaleString('en-US')}`;
}

/** The band the next question comes from: up one after a right answer, down one after any other, from START_BAND. */
export function nextBand(asked: Asked[]): number {
  let band = START_BAND;
  for (const { reply } of asked) band = Math.min(BANDS.length - 1, Math.max(0, band + (reply === 'right' ? 1 : -1)));
  return band;
}

/**
 * The next question: an unasked word from the next band, else from the closest band that has one.
 * A word not in `seen` (asked in an earlier check) is preferred within a band of the next one, so a
 * retake gets new words while any are left near the learner's level; failing that a seen word is
 * asked rather than a fresh one from a band too far away to say much. Undefined once none are left.
 */
export function nextItem(items: VocabItem[], asked: Asked[], rng: Rng, seen: ReadonlySet<string> = new Set()): VocabItem | undefined {
  const used = new Set(asked.map((a) => a.item.word));
  const left = items.filter((i) => !used.has(i.word) && bandOf(i.rank) >= 0);
  const want = nextBand(asked);
  const away = (i: VocabItem) => Math.abs(bandOf(i.rank) - want);
  const fresh = left.filter((i) => !seen.has(i.word) && away(i) <= 1);
  const pool = fresh.length ? fresh : left;
  const closest = Math.min(...pool.map(away));
  const near = pool.filter((i) => away(i) === closest);
  return near.length ? near[Math.floor(rng() * near.length)] : undefined;
}

/** The words saved from earlier checks, ignoring anything that isn't a list of words. */
export function parseSeen(raw: string | null): string[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((w): w is string => typeof w === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The words to remember after a check: the ones asked now added to those already seen, kept to words
 * still in the bank. Once every word in the bank has been seen the list starts over, so a retake
 * is never left with only seen words forever.
 */
export function rememberSeen(seen: readonly string[], asked: Asked[], items: VocabItem[]): string[] {
  const inBank = new Set(items.map((i) => i.word));
  const all = new Set([...seen, ...asked.map((a) => a.item.word)].filter((w) => inBank.has(w)));
  return all.size >= inBank.size ? [] : [...all];
}

/** The right meaning and the three wrong ones, in a random order. */
export function choicesFor(item: VocabItem, rng: Rng): string[] {
  const all = [item.meaning, ...item.wrong];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}

export type BandResult = { band: number; asked: number; right: number; known: number };

/** Each band that got a question: how many, how many right, and the share likely known once guessing is allowed for. */
export function bandResults(asked: Asked[]): BandResult[] {
  const out: BandResult[] = [];
  BANDS.forEach((_, band) => {
    const here = asked.filter((a) => bandOf(a.item.rank) === band);
    if (!here.length) return;
    const right = here.filter((a) => a.reply === 'right').length;
    const wrong = here.filter((a) => a.reply === 'wrong').length;
    out.push({ band, asked: here.length, right, known: Math.min(1, Math.max(0, (right - wrong * GUESS_PENALTY) / here.length)) });
  });
  return out;
}

export type Estimate = { bands: BandResult[]; suggested: CommonCount };

/**
 * How fast the chance of knowing a word falls with its rank, in natural-log units: it goes from 90%
 * to 10% over a span of about ln(rank) 2.6 at 0.6, a factor of 13 in rank.
 */
const SLOPE = 0.6;
/** Of the words the learner doesn't know, the share they answer by guessing (the rest are skipped with "I don't know"). */
const GUESS_RATE = 0.5;
const MU_FROM = Math.log(20);
const MU_TO = Math.log(100000);
const MU_STEP = 0.02;

/** The chance a word of this rank is known, for a learner whose 50% point is at ln(rank) `mu`. */
function knownAt(rank: number, mu: number): number {
  return 1 / (1 + Math.exp((Math.log(rank) - mu) / SLOPE));
}

/** How likely one reply is, if the learner's 50% point is at `mu`: a right answer is knowing the word or guessing it from four, a wrong one a missed guess, a skip an unknown word not guessed. */
function replyLikelihood(a: Asked, mu: number): number {
  const known = knownAt(a.item.rank, mu);
  const unknown = 1 - known;
  if (a.reply === 'right') return known + (unknown * GUESS_RATE) / 4;
  if (a.reply === 'wrong') return (unknown * GUESS_RATE * 3) / 4;
  return unknown * (1 - GUESS_RATE);
}

/** The 50% point (in ln rank) that makes all the answers most likely, over a grid. Ties go to the lowest. */
function fitMu(asked: Asked[]): number {
  let best = MU_FROM;
  let bestLog = -Infinity;
  for (let mu = MU_FROM; mu <= MU_TO; mu += MU_STEP) {
    let log = 0;
    for (const a of asked) log += Math.log(Math.max(replyLikelihood(a, mu), 1e-12));
    if (log > bestLog + 1e-9) { bestLog = log; best = mu; }
  }
  return best;
}

/**
 * The largest setting at which at least KNOWN_SHARE of the words it counts as known are likely
 * known, or None (0) when even the first 250 fall short. One curve of "chance of knowing a word at
 * this rank" is fitted to every answer at once (a fixed slope, so only where it crosses 50% is
 * fitted), rather than scoring each band by itself: a band of four questions is too noisy to carry
 * the result alone, and one miss in it used to outweigh nine right answers in the band above.
 * Nothing above the highest asked band is suggested, since no answer says how well those words are known.
 */
export function estimate(asked: Asked[]): Estimate {
  const bands = bandResults(asked);
  if (!bands.length) return { bands, suggested: 0 };
  const highest = bands[bands.length - 1].band;
  const mu = fitMu(asked);
  let suggested: CommonCount = 0;
  let sum = 0;
  let rank = 0;
  for (const count of SUGGESTABLE) {
    if (bandOf(count) > highest) break;
    for (rank++; rank <= count; rank++) sum += knownAt(rank, mu);
    rank = count;
    if (sum / count >= KNOWN_SHARE) suggested = count;
  }
  return { bands, suggested };
}

export type Missed = { item: VocabItem; band: number; picked?: string };

/** The words answered wrong or skipped, in the order asked, each with its band and the meaning picked (none for a skip). */
export function missedWords(asked: Asked[]): Missed[] {
  return asked
    .filter((a) => a.reply !== 'right')
    .map((a) => ({ item: a.item, band: bandOf(a.item.rank), picked: a.reply === 'wrong' ? a.picked : undefined }));
}
