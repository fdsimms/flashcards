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
  const text = today.answered === 0
    ? null
    : `Studied today: ${n(today.answered, 'answer', 'answers')} · ${durationText(today.takenMs)} · ${today.newCards.toLocaleString()} new`;
  return { answered: today.answered, takenMs: today.takenMs, newCards: today.newCards, text };
}
