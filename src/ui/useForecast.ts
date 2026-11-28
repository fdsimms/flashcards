import { useEffect, useRef, useState } from 'react';
import { studyDayStart } from '../core/day';
import type { DeckLimits } from '../core/deckTree';
import { forecastSteps, type Forecast, type ForecastInput } from '../core/forecast';
import { ankiToday } from '../core/order';
import { studiedToday } from '../core/queue';
import type { Card, DeckParams, Note } from '../core/types';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { loadHeld } from './lookalikeHold';
import { loadVacation } from './vacationPrefs';

/**
 * What the forecast needs besides the cards Stats already has: the collection's settings, each
 * deck's own limits and gates, what was studied so far today (so today's limit has only what is
 * left), and vacation mode. Read the way the deck list reads them (AppContext's `refresh`), so the
 * forecast's limits are the ones the deck list opens with.
 */
export type ForecastBase = Pick<ForecastInput, 'notes' | 'cards' | 'params' | 'collection' | 'studied' | 'settings' | 'vacation' | 'held' | 'now'>;

export function useForecastBase(repo: Repo & AnkiLink, data: { notes: Note[]; cards: Card[]; params: Map<string, DeckParams>; now: Date } | undefined): ForecastBase | undefined {
  const [loaded, setLoaded] = useState<{ source: unknown; base: ForecastBase }>();
  useEffect(() => {
    if (!data) return;
    let live = true;
    loadForecastBase(repo, data)
      .then((base) => { if (live) setLoaded({ source: data, base }); })
      .catch(() => undefined); // Without these the bars stay what is scheduled, which is still true.
    return () => { live = false; };
  }, [repo, data]);
  if (!data || !loaded || loaded.source !== data) return undefined;
  return loaded.base;
}

/**
 * Reads what the forecast needs besides the notes and cards (Stats', or the daily goal's,
 * src/ui/dailyGoals.ts), the way the deck list reads it, so the forecast's limits are the ones the
 * deck list opens with.
 */
export async function loadForecastBase(repo: Repo & AnkiLink, data: { notes: Note[]; cards: Card[]; params: Map<string, DeckParams>; now: Date }): Promise<ForecastBase> {
  const collection = await repo.collectionSettings();
  const dayStart = studyDayStart(data.now, collection.dayStartsAtHour);
  const [reviews, revlog, settings, vacation] = await Promise.all([repo.listReviews(dayStart), repo.ankiReviewLog(dayStart), repo.listDeckSettings(), loadVacation()]);
  const ankiDay = ankiToday(data.now, collection.dayStartsAtHour, collection.collectionCreated, collection.creationOffset);
  const ankiCounters = ankiDay === undefined ? undefined : await repo.ankiDeckStudied(ankiDay);
  const studied = studiedToday({ notes: data.notes, cards: data.cards, reviews, revlog, now: data.now, dayStartsAtHour: collection.dayStartsAtHour, ankiCounters: ankiCounters?.length ? ankiCounters : undefined });
  // Today's lookalike holds, as the deck list reads them, so today's count is the one the deck opens with.
  // Not Quiet mode: it ends within hours, and a forecast of what's due follows the schedule, not where you are.
  const held = await loadHeld(repo, { notes: data.notes, cards: data.cards, settings, now: data.now, dayStartsAtHour: collection.dayStartsAtHour, quiet: false });
  return { notes: data.notes, cards: data.cards, params: data.params, now: data.now, collection, studied, settings, vacation, held };
}

/** How long the what-if inputs sit still before the forecast is run again, so a run of taps on a stepper is one run. */
const SETTLE_MS = 350;

/**
 * Runs the forecast a day at a time, handing the thread back between days (src/core/forecast.ts),
 * so the screen keeps scrolling while it works. The last result stays on screen until the next one
 * is ready, unless it was for other decks (`key`). `limits` is a what-if; without it, the forecast
 * for the decks' own limits.
 */
export function useForecastRun(base: ForecastBase | undefined, run: { key: string; roots: string[]; passRate: number; days: number; limits?: Map<string, Partial<DeckLimits>>; enabled?: boolean }): { forecast: Forecast | undefined; busy: boolean } {
  const [result, setResult] = useState<{ key: string; forecast: Forecast }>();
  const [busy, setBusy] = useState(false);
  const first = useRef(true);
  const { key, roots, passRate, days, limits, enabled = true } = run;
  useEffect(() => {
    if (!base || !enabled) { setBusy(false); return; }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setBusy(true);
    const start = () => {
      const steps = forecastSteps({ ...base, roots, passRate, days, limits });
      const tick = () => {
        if (!live) return;
        const step = steps.next();
        if (step.done) { setResult({ key, forecast: step.value }); setBusy(false); return; }
        timer = setTimeout(tick, 0);
      };
      tick();
    };
    // The first run waits only for the screen to draw; a changed what-if waits for the taps to settle.
    timer = setTimeout(start, first.current ? 0 : SETTLE_MS);
    first.current = false;
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [base, key, roots, passRate, days, limits, enabled]);
  return { forecast: result?.key === key ? result.forecast : undefined, busy };
}
