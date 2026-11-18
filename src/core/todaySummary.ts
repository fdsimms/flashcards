import { computeStats, durationText, type Answer } from './stats';

/** How many study days back the deck list reads answers for today's summary. */
export const SUMMARY_LOOKBACK_DAYS = 30;

export interface TodaySummary {
  answered: number;
  takenMs: number;
  newCards: number;
  /** The line the deck list shows, or null when nothing has been answered yet today. */
  text: string | null;
}

/**
 * What's been studied in today's study day, from every device's answers (`answersFrom`), counted by
 * `computeStats` so the deck list and Stats' Today box agree. A card counts as new today when its
 * first answer is today; `answers` has to reach back past today for that, so a learning card
 * answered yesterday isn't counted again (`SUMMARY_LOOKBACK_DAYS`).
 */
export function todaySummary(answers: Answer[], now: Date, dayStartsAtHour: number): TodaySummary {
  const { today } = computeStats({ cards: [], answers, now, dayStartsAtHour, days: 1 });
  const n = (v: number, one: string, many: string) => `${v.toLocaleString()} ${v === 1 ? one : many}`;
  const pace = answerPace(today.answered, today.takenMs);
  const text = today.answered === 0
    ? null
    : `Studied today: ${n(today.answered, 'answer', 'answers')} · ${durationText(today.takenMs)}${pace ? ` (${pace})` : ''} · ${today.newCards.toLocaleString()} new`;
  return { answered: today.answered, takenMs: today.takenMs, newCards: today.newCards, text };
}

/**
 * The pace as "1 per 7 s" (one answer every so many seconds, since a rate in answers per second
 * would read 0.14), or null when no time was recorded. Rounded to whole seconds, at least 1.
 */
export function answerPace(answered: number, takenMs: number): string | null {
  if (answered <= 0 || takenMs <= 0) return null;
  return `1 per ${Math.max(1, Math.round(takenMs / answered / 1000))} s`;
}

/**
 * How far through today the deck list's bar shows: the answers given today against those plus
 * what's still waiting (due and new). Answers count repeats (a card failed and seen again), so it's
 * a sense of progress rather than a share of cards; 1 once nothing is waiting.
 */
export function todayProgress(answered: number, waiting: number): number {
  if (waiting <= 0) return answered > 0 ? 1 : 0;
  return answered / (answered + waiting);
}
