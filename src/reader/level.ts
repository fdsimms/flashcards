// Your level (docs/read-and-listen/architecture.md, "Your level"): what the language's level page
// and its card on the language's settings say, from the server's figures (`GET /api/level`,
// server/reader level.py). Pure, so it's tested. Nothing here grades a card.
import type { Level } from './api';

type LevelDay = Level['history'][number];

/** How far back the change and the chart look. */
export const CHANGE_DAYS = 28;
export const CHART_DAYS = 84;
/** A trend shorter than this says nothing yet: a few days' change is mostly noise. */
const MIN_TREND_DAYS = 7;

const count = (n: number) => n.toLocaleString('en-US');

/** "1,240 of the 2,000 most common words". */
export const levelHeadline = (l: Pick<Level, 'known_top' | 'top'>): string => `${count(l.known_top)} of the ${count(l.top)} most common words`;

/** The share of everyday speech the known words make up, as a whole percent; null without frequencies. */
export const speechPercent = (l: Pick<Level, 'speech'>): number | null => (l.speech == null ? null : Math.round(l.speech * 100));

/** A band's label: "Top 500", "501–1,000". */
export const bandLabel = (b: { start: number; end: number }): string => (b.start === 1 ? `Top ${count(b.end)}` : `${count(b.start)}–${count(b.end)}`);

/** A band's share known, 0 to 1. */
export const bandShare = (b: { start: number; end: number; known: number }): number => b.known / (b.end - b.start + 1);

const dayNumber = (day: string): number => {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

/**
 * How much the headline figure moved: from the latest figure kept on or before `CHANGE_DAYS` before
 * the newest, or from the oldest when the trend is younger than that. Null while there's less than
 * `MIN_TREND_DAYS` of it.
 */
export function levelChange(history: readonly LevelDay[]): { words: number; days: number } | null {
  const last = history[history.length - 1];
  if (!last) return null;
  const end = dayNumber(last.day);
  const older = history.filter((d) => end - dayNumber(d.day) >= CHANGE_DAYS);
  const from = older[older.length - 1] ?? history[0];
  const days = end - dayNumber(from.day);
  if (days < MIN_TREND_DAYS) return null;
  return { words: last.known_top - from.known_top, days };
}

// Two weeks or more in whole weeks (a gap in the trend makes the span 30 days, not four weeks), less in days.
const span = (days: number): string => (days >= 14 ? `${Math.round(days / 7)} weeks` : `${days} days`);

/** The change in a sentence: "Up 96 words in 4 weeks." */
export function changeLine(change: { words: number; days: number } | null): string | null {
  if (!change) return null;
  const { words, days } = change;
  if (words === 0) return `No change in ${span(days)}.`;
  const n = Math.abs(words);
  return `${words > 0 ? 'Up' : 'Down'} ${count(n)} ${n === 1 ? 'word' : 'words'} in ${span(days)}.`;
}

/** The card's second line: the share of speech, then the change. */
export function levelSummary(l: Level): string {
  const pct = speechPercent(l);
  return [pct == null ? null : `About ${pct}% of everyday speech.`, changeLine(levelChange(l.history))].filter(Boolean).join(' ');
}

/** The chart's points: the last `CHART_DAYS` of figures, each as days before the newest and its headline figure. */
export function chartPoints(history: readonly LevelDay[]): { daysAgo: number; known: number }[] {
  const last = history[history.length - 1];
  if (!last) return [];
  const end = dayNumber(last.day);
  return history
    .map((d) => ({ daysAgo: end - dayNumber(d.day), known: d.known_top }))
    .filter((p) => p.daysAgo <= CHART_DAYS);
}
