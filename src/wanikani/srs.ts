/**
 * WaniKani's SRS stages: what they're called, where an answer moves an item, and how long until it
 * comes back. Franki never schedules a WaniKani item itself; this only says on the answer buttons
 * what WaniKani will do, the way the other decks show the next interval.
 */

/** An SRS system's stage intervals, in seconds by stage position (null for Lesson and Burned). */
export interface SrsSystem {
  id: number;
  intervals: (number | null)[];
  passingStage: number;
  burningStage: number;
}

/**
 * WaniKani's two systems (`/spaced_repetition_systems`), used only until the real ones are read:
 * id 1 the standard one, id 2 the accelerated one levels 1 and 2 use. These intervals were written
 * from memory, not checked against the API (its docs weren't reachable), which is why the screen
 * reads the real ones before it shows a button's interval when it can.
 */
export const DEFAULT_SRS: Map<number, SrsSystem> = new Map([
  [1, { id: 1, intervals: [null, 14400, 28800, 82800, 169200, 601200, 1206000, 2588400, 10364400, null], passingStage: 5, burningStage: 9 }],
  [2, { id: 2, intervals: [null, 7200, 14400, 28800, 82800, 601200, 1206000, 2588400, 10364400, null], passingStage: 5, burningStage: 9 }],
]);

const UNIT_SECONDS: Record<string, number> = {
  milliseconds: 0.001, seconds: 1, minutes: 60, hours: 3600, days: 86400, weeks: 604800,
};

/** One system out of `/spaced_repetition_systems`, or null when the body isn't one. */
export function parseSrsSystem(resource: unknown): SrsSystem | null {
  const r = resource as { id?: unknown; data?: { stages?: unknown; passing_stage_position?: unknown; burning_stage_position?: unknown } };
  const id = r?.id;
  const stages = r?.data?.stages;
  if (typeof id !== 'number' || !Array.isArray(stages)) return null;
  const intervals: (number | null)[] = [];
  for (const s of stages as { position?: unknown; interval?: unknown; interval_unit?: unknown }[]) {
    if (typeof s?.position !== 'number') return null;
    const unit = typeof s.interval_unit === 'string' ? UNIT_SECONDS[s.interval_unit] : undefined;
    intervals[s.position] = typeof s.interval === 'number' && unit ? s.interval * unit : null;
  }
  const passing = r.data?.passing_stage_position;
  const burning = r.data?.burning_stage_position;
  return {
    id,
    intervals: Array.from(intervals, (v) => v ?? null),
    passingStage: typeof passing === 'number' ? passing : 5,
    burningStage: typeof burning === 'number' ? burning : 9,
  };
}

/**
 * The stage an answer moves an item to, by WaniKani's published rule: right moves it up one; wrong
 * moves it down by half the wrong answers (rounded up), twice that from Guru up, and never below
 * Apprentice 1.
 */
export function nextStage(stage: number, incorrect: number, system?: SrsSystem): number {
  const passing = system?.passingStage ?? 5;
  const burning = system?.burningStage ?? 9;
  if (incorrect <= 0) return Math.min(stage + 1, burning);
  const adjustment = Math.ceil(incorrect / 2);
  const factor = stage >= passing ? 2 : 1;
  return Math.max(1, stage - adjustment * factor);
}

const NAMES = ['Lesson', 'Apprentice 1', 'Apprentice 2', 'Apprentice 3', 'Apprentice 4', 'Guru 1', 'Guru 2', 'Master', 'Enlightened', 'Burned'];

export function stageName(stage: number): string {
  return NAMES[stage] ?? `Stage ${stage}`;
}

/** The stage without its number (Apprentice, Guru), for a short label over a button. */
export function stageGroup(stage: number): string {
  return stageName(stage).replace(/ \d$/, '');
}

/**
 * A stage's interval as a short span: 4h, 1d, 1w, 1mo, 4mo. WaniKani's intervals sit just under a
 * round span (23 hours, 167 hours) because it rounds the time down to the hour, so this rounds to
 * the nearest one.
 */
export function intervalText(seconds: number | null): string {
  if (seconds === null) return '';
  const hours = seconds / 3600;
  if (hours < 20) return `${Math.max(1, Math.round(hours))}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 28) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}

/** What a button's answer does, for the line over it: "Guru · 1w", or "Burned" when it leaves the reviews. */
export function outcomeText(stage: number, system?: SrsSystem): string {
  const sys = system ?? DEFAULT_SRS.get(1)!;
  const interval = intervalText(sys.intervals[stage] ?? null);
  return interval ? `${stageGroup(stage)} · ${interval}` : stageGroup(stage);
}
