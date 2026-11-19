/**
 * What the listening Live Activity (lock screen and Dynamic Island, while an audio lesson or a Read &
 * Listen text plays) shows, and when it needs telling something new. Pure; the native side is
 * modules/listening-activity and the wiring is src/ui/listeningActivity.ts.
 *
 * The activity draws its progress bar on its own clock while playing, so it is only updated when
 * something it can't work out itself changes: playing starting or stopping, the line, the length of
 * what's playing, or a jump in the position (a skip, a seek).
 */

export type ListeningKind = 'lesson' | 'text';

/** What's playing, as the activity names it. */
export interface Listening {
  kind: ListeningKind;
  title: string;
  /** "Line 4 of 12" for a text, "" for a lesson. */
  detail: string;
}

/** The player's state now, in seconds. */
export interface Snapshot {
  playing: boolean;
  position: number;
  duration: number;
}

/** What the activity was last told. */
export interface Sent extends Snapshot {
  listening: Listening;
  /** When it was told, in ms. */
  at: number;
}

export type ActivityStep = 'start' | 'update' | null;

/** A position further than this from where playing would have put it is a skip or a seek. */
export const JUMP_SECONDS = 2;
/** A length that moved by less than this isn't news (the player settles on it as the file loads). */
const LENGTH_SECONDS = 1;
/** A paused activity is ended after this long, so it doesn't sit on the lock screen for hours. */
export const IDLE_END_MS = 10 * 60 * 1000;

export type ListeningAction = 'previous' | 'toggle' | 'next';

/** The button a tap on the activity names, or null for anything else. */
export function parseAction(value: unknown): ListeningAction | null {
  return value === 'previous' || value === 'toggle' || value === 'next' ? value : null;
}

/** The activity's name for what kind of thing is playing. */
export function kindLabel(kind: ListeningKind): string {
  return kind === 'lesson' ? 'Audio lesson' : 'Read & Listen';
}

/** "Line n of m" for a text's activity. */
export function lineDetail(line: { n: number; of: number }): string {
  return `Line ${line.n} of ${line.of}`;
}

function sameListening(a: Listening, b: Listening): boolean {
  return a.kind === b.kind && a.title === b.title;
}

/**
 * What to do with the activity given what it was last told: start one (nothing yet, or a different
 * title), update it, or leave it. `now` is in ms.
 */
export function activityStep(last: Sent | null, listening: Listening, snapshot: Snapshot, now: number): ActivityStep {
  if (!last || !sameListening(last.listening, listening)) return 'start';
  if (last.listening.detail !== listening.detail) return 'update';
  if (last.playing !== snapshot.playing) return 'update';
  if (Math.abs(last.duration - snapshot.duration) > LENGTH_SECONDS) return 'update';
  const expected = last.position + (last.playing ? (now - last.at) / 1000 : 0);
  return Math.abs(snapshot.position - expected) > JUMP_SECONDS ? 'update' : null;
}

/** Whether a paused activity has been paused long enough to end. */
export function idleExpired(pausedSince: number | null, now: number): boolean {
  return pausedSince !== null && now - pausedSince >= IDLE_END_MS;
}
