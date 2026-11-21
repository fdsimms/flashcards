/**
 * The Anki preset options Deck options can change (Anki options): daily limits, learning and
 * relearning steps, maximum interval and desired retention. A preset is shared by every deck that
 * uses it, so the screen lists those decks, and says which of them keep a value of their own
 * (Anki's "This deck" limits and per-deck retention, or a today-only limit) that the preset's
 * doesn't reach. Bounds are the ones Anki's own deck options accept.
 */

export interface PresetOptions {
  newPerDay: number;
  reviewsPerDay: number;
  /** Minutes, as Anki keeps them. Empty means none. */
  learnSteps: number[];
  relearnSteps: number[];
  /** Days. */
  maxInterval: number;
  desiredRetention: number;
}

/** The form's text, one string per option, as typed. */
export type PresetForm = Record<keyof PresetOptions, string>;

export const LIMIT_MAX = 9999;
export const MAX_INTERVAL_MAX = 36500;
export const RETENTION_MIN = 0.7;
export const RETENTION_MAX = 0.99;

const UNITS: [string, number][] = [['d', 1440], ['h', 60], ['m', 1]];

/** One step as Anki writes it: whole days, hours or minutes where it divides, else seconds. */
function formatStep(minutes: number): string {
  for (const [unit, size] of UNITS) {
    if (minutes >= size && Number.isInteger(Number((minutes / size).toFixed(4)))) return `${Number((minutes / size).toFixed(4))}${unit}`;
  }
  return `${Math.round(minutes * 60)}s`;
}

export function formatSteps(minutes: number[]): string {
  return minutes.map(formatStep).join(' ');
}

const STEP_ERROR = 'Write each step as a number and a unit (s, m, h or d), with spaces between, e.g. 10m 1d.';

/** Steps typed as Anki takes them ("1m 10m 1d"; a bare number is minutes), in minutes. */
export function parseSteps(text: string): { steps: number[] } | { error: string } {
  const steps: number[] = [];
  for (const part of text.trim().split(/[\s,]+/).filter(Boolean)) {
    const m = /^(\d+(?:\.\d+)?)\s*([smhd]?)$/i.exec(part);
    if (!m) return { error: STEP_ERROR };
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    const minutes = unit === 's' ? n / 60 : unit === 'h' ? n * 60 : unit === 'd' ? n * 1440 : n;
    if (!(minutes > 0)) return { error: 'Each step has to be longer than 0.' };
    steps.push(minutes);
  }
  return { steps };
}

export function presetForm(o: PresetOptions): PresetForm {
  return {
    newPerDay: String(o.newPerDay),
    reviewsPerDay: String(o.reviewsPerDay),
    learnSteps: formatSteps(o.learnSteps),
    relearnSteps: formatSteps(o.relearnSteps),
    maxInterval: String(o.maxInterval),
    desiredRetention: o.desiredRetention.toFixed(2),
  };
}

function wholeNumber(text: string, min: number, max: number, what: string): number | string {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return `Enter ${what} as a whole number.`;
  const n = Number(t);
  if (n < min || n > max) return `Enter a number from ${min} to ${max}.`;
  return n;
}

/** The options a form holds, or what's wrong with each field that can't be used. */
export function parsePresetForm(f: PresetForm): { options: PresetOptions } | { errors: Partial<PresetForm> } {
  const errors: Partial<PresetForm> = {};
  const newPerDay = wholeNumber(f.newPerDay, 0, LIMIT_MAX, 'the limit');
  const reviewsPerDay = wholeNumber(f.reviewsPerDay, 0, LIMIT_MAX, 'the limit');
  const maxInterval = wholeNumber(f.maxInterval, 1, MAX_INTERVAL_MAX, 'the interval');
  if (typeof newPerDay === 'string') errors.newPerDay = newPerDay;
  if (typeof reviewsPerDay === 'string') errors.reviewsPerDay = reviewsPerDay;
  if (typeof maxInterval === 'string') errors.maxInterval = maxInterval;
  const learn = parseSteps(f.learnSteps);
  const relearn = parseSteps(f.relearnSteps);
  if ('error' in learn) errors.learnSteps = learn.error;
  if ('error' in relearn) errors.relearnSteps = relearn.error;
  // "90%" reads the same as 0.90.
  const r = f.desiredRetention.trim();
  const retention = r.endsWith('%') ? Number(r.slice(0, -1)) / 100 : Number(r);
  if (r === '' || !Number.isFinite(retention) || retention < RETENTION_MIN - 1e-9 || retention > RETENTION_MAX + 1e-9) {
    errors.desiredRetention = `Enter a number from ${RETENTION_MIN.toFixed(2)} to ${RETENTION_MAX.toFixed(2)}.`;
  }
  if (Object.keys(errors).length) return { errors };
  return {
    options: {
      newPerDay: newPerDay as number,
      reviewsPerDay: reviewsPerDay as number,
      learnSteps: (learn as { steps: number[] }).steps,
      relearnSteps: (relearn as { steps: number[] }).steps,
      maxInterval: maxInterval as number,
      desiredRetention: Number(retention.toFixed(4)),
    },
  };
}

/** Whether two sets of options are the same, steps compared to the second (as Anki keeps them, in float32). */
export function sameOptions(a: PresetOptions, b: PresetOptions): boolean {
  const steps = (x: number[], y: number[]) => x.length === y.length && x.every((v, i) => Math.abs(v - y[i]) < 1e-3);
  return a.newPerDay === b.newPerDay && a.reviewsPerDay === b.reviewsPerDay && a.maxInterval === b.maxInterval
    && Math.abs(a.desiredRetention - b.desiredRetention) < 1e-4 && steps(a.learnSteps, b.learnSteps) && steps(a.relearnSteps, b.relearnSteps);
}

/** What one deck on the preset sets for itself, which the preset's own value doesn't change. */
export interface DeckOwnValues {
  /** Anki's "This deck" limits and the deck's own desired retention. */
  newPerDay?: number;
  reviewsPerDay?: number;
  desiredRetention?: number;
  /** A today-only limit (Custom Study, or Anki's "Today only") is set for today. */
  newToday?: boolean;
  reviewToday?: boolean;
}

/** The line under a deck in "Applies to", or undefined when the preset's values all reach it. */
export function ownValuesNote(own: DeckOwnValues): string | undefined {
  const kept = [
    own.newPerDay !== undefined ? 'new card limit' : undefined,
    own.reviewsPerDay !== undefined ? 'review limit' : undefined,
    own.desiredRetention !== undefined ? 'desired retention' : undefined,
  ].filter((x): x is string => !!x);
  const today = [own.newToday ? 'new card' : undefined, own.reviewToday ? 'review' : undefined].filter((x): x is string => !!x);
  const lines: string[] = [];
  if (kept.length) {
    const list = kept.length === 1 ? kept[0] : `${kept.slice(0, -1).join(', ')} and ${kept.at(-1)}`;
    lines.push(`Has its own ${list}, set in Anki, so ${kept.length === 1 ? 'the one' : 'the ones'} here ${kept.length === 1 ? "doesn't" : "don't"} change ${kept.length === 1 ? 'it' : 'them'}.`);
  }
  if (today.length) lines.push(`Has a ${today.join(' and ')} limit for today only, so a new limit here starts tomorrow.`);
  return lines.length ? lines.join(' ') : undefined;
}

/** The line at the top of the screen. */
export function presetIntro(presetName: string): string {
  return `These are the options of the Anki preset "${presetName}". A change applies to every deck that uses it, and syncs to your other devices.`;
}
