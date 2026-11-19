// Carry on when I stop talking (docs/read-and-listen/architecture.md, Audio lessons): while a lesson
// waits at a turn, the microphone's level says when the learner has said something and gone quiet.
// Only the level is read, never the words, so it works the same in every language and nothing is
// sent anywhere. The quiet is measured first, so a car's road noise counts as quiet. Pure, so it's
// tested; useLessonTurns feeds it the recorder's level.

/** The first part of a turn is taken as the room's quiet. */
export const CALIBRATE_MS = 300;
/** Louder than the quiet by this much is speech. */
export const SPEECH_DB = 12;
/** Back within this much of the quiet counts as stopped. */
export const QUIET_DB = 6;
/** Speech has to last this long to count, so a cough or a bump isn't an answer. */
export const MIN_SPEECH_MS = 350;
/** Quiet for this long after speech means the answer is done. */
export const DONE_QUIET_MS = 900;
/** The quietest the room is taken to be: below it, the meter's own floor. */
export const FLOOR_DB = -60;

export type VoiceState = {
  startedAt: number;
  /** The room's quiet, once measured. */
  floor: number | null;
  calibrating: number[];
  spokeMs: number;
  lastAt: number;
  /** When the level last fell back to quiet after speech, or null while it's loud. */
  quietSince: number | null;
};

export function startVoice(now: number): VoiceState {
  return { startedAt: now, floor: null, calibrating: [], spokeMs: 0, lastAt: now, quietSince: null };
}

/** One reading of the microphone's level (dBFS). `done` once the learner has spoken and gone quiet. */
export function voiceTick(state: VoiceState, reading: { db: number; now: number }): { state: VoiceState; done: boolean } {
  const db = Math.max(FLOOR_DB, Number.isFinite(reading.db) ? reading.db : FLOOR_DB);
  const step = Math.max(0, reading.now - state.lastAt);
  if (state.floor === null) {
    const calibrating = [...state.calibrating, db];
    if (reading.now - state.startedAt < CALIBRATE_MS) return { state: { ...state, calibrating, lastAt: reading.now }, done: false };
    // The quieter half of what was heard: someone who starts talking at once doesn't set the quiet.
    const sorted = [...calibrating].sort((a, b) => a - b);
    const floor = sorted[Math.floor((sorted.length - 1) / 2)];
    return { state: { ...state, floor, calibrating: [], lastAt: reading.now }, done: false };
  }
  const loud = db >= state.floor + SPEECH_DB;
  const quiet = db <= state.floor + QUIET_DB;
  const spokeMs = loud ? state.spokeMs + step : state.spokeMs;
  let quietSince = state.quietSince;
  if (loud) quietSince = null;
  else if (quiet && spokeMs >= MIN_SPEECH_MS && quietSince === null) quietSince = reading.now;
  const done = quietSince !== null && reading.now - quietSince >= DONE_QUIET_MS;
  return { state: { ...state, spokeMs, quietSince, lastAt: reading.now }, done };
}
