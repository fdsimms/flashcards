// The vocabulary check: 20 questions on a language's most common words, adaptive, that suggest the
// "Common words counted as known" setting (docs/read-and-listen/architecture.md, Languages). The
// questions come from the server's bank (server/reader/src/franki_reader/vocab_check.py), which
// samples the same bands as BANDS here. Pure: nothing here grades or writes a card, and the result
// is only a suggestion the learner accepts or not.
import type { CommonCount } from './api';

export type VocabItem = { word: string; rank: number; meaning: string; wrong: string[] };
export type Reply = 'right' | 'wrong' | 'skipped';
export type Asked = { item: VocabItem; reply: Reply };

/** Ranks in the language's common-word list, as the server samples them. Each setting from 250 up lands on a band's edge. */
export const BANDS: readonly { from: number; to: number }[] = [
  { from: 1, to: 100 },
  { from: 101, to: 250 },
  { from: 251, to: 500 },
  { from: 501, to: 1000 },
  { from: 1001, to: 2000 },
  { from: 2001, to: 3000 },
  { from: 3001, to: 5000 },
];

export const QUESTIONS = 20;
/** Where the questions start: the 251 to 500 band, where a learner two or three Duolingo units in is likely to be. */
export const START_BAND = 2;
/** A setting is suggested while at least this share of the words it counts as known are ones the learner knows. Texts are checked at 95 to 98%, so this leaves them room. */
export const KNOWN_SHARE = 0.9;
/** The settings the quiz can suggest, each ending on a band. Below the first is None. */
export const SUGGESTABLE: readonly CommonCount[] = [250, 500, 1000, 2000, 3000, 5000];
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

/** The next question: an unasked word from the next band, else from the closest band that has one. Undefined once none are left. */
export function nextItem(items: VocabItem[], asked: Asked[], rng: Rng): VocabItem | undefined {
  const used = new Set(asked.map((a) => a.item.word));
  const left = items.filter((i) => !used.has(i.word) && bandOf(i.rank) >= 0);
  const want = nextBand(asked);
  const closest = Math.min(...left.map((i) => Math.abs(bandOf(i.rank) - want)));
  const near = left.filter((i) => Math.abs(bandOf(i.rank) - want) === closest);
  return near.length ? near[Math.floor(rng() * near.length)] : undefined;
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
 * The largest setting at which at least KNOWN_SHARE of the words it counts as known are likely
 * known, or None (0) when even the first 250 fall short. A band never asked takes its neighbors'
 * share: the one below the lowest asked is taken as known (commoner words are known at least as
 * well), one between two asked bands the average of them. Nothing above the highest asked band is
 * suggested, since no answer says how well those words are known.
 */
export function estimate(asked: Asked[]): Estimate {
  const bands = bandResults(asked);
  if (!bands.length) return { bands, suggested: 0 };
  const share = new Map(bands.map((b) => [b.band, b.known]));
  const lowest = bands[0].band;
  const highest = bands[bands.length - 1].band;
  const known = (band: number): number => {
    const direct = share.get(band);
    if (direct !== undefined) return direct;
    if (band < lowest) return 1;
    let below = band - 1;
    while (!share.has(below)) below--;
    let above = band + 1;
    while (!share.has(above)) above++;
    return ((share.get(below) ?? 0) + (share.get(above) ?? 0)) / 2;
  };
  let suggested: CommonCount = 0;
  for (const count of SUGGESTABLE) {
    const covered = BANDS.map((b, i) => ({ ...b, i })).filter((b) => b.to <= count);
    if (!covered.length || covered[covered.length - 1].i > highest) break;
    const words = covered.reduce((n, b) => n + known(b.i) * (b.to - b.from + 1), 0);
    if (words / count >= KNOWN_SHARE) suggested = count;
  }
  return { bands, suggested };
}
