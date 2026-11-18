import { describe, expect, it } from 'vitest';
import { CALIBRATE_MS, DONE_QUIET_MS, MIN_SPEECH_MS, startVoice, voiceTick, type VoiceState } from '../../src/reader/voiceEnd';

/** Feeds levels every 50 ms from `from`, returning the state and when it was done (or null). */
function feed(state: VoiceState, levels: number[], from: number): { state: VoiceState; doneAt: number | null; at: number } {
  let at = from;
  for (const db of levels) {
    at += 50;
    const step = voiceTick(state, { db, now: at });
    state = step.state;
    if (step.done) return { state, doneAt: at, at };
  }
  return { state, doneAt: null, at };
}
const times = (n: number, db: number) => Array<number>(n).fill(db);

describe('voiceTick', () => {
  it('is done after speech and then quiet', () => {
    const quiet = feed(startVoice(0), times(CALIBRATE_MS / 50 + 1, -55), 0);
    expect(quiet.state.floor).toBe(-55);
    const spoke = feed(quiet.state, times(20, -30), quiet.at);
    expect(spoke.doneAt).toBeNull();
    const after = feed(spoke.state, times(30, -54), spoke.at);
    expect(after.doneAt).toBe(spoke.at + DONE_QUIET_MS + 50);
  });

  it('waits as long as nothing is said', () => {
    expect(feed(startVoice(0), times(400, -55), 0).doneAt).toBeNull();
  });

  it("doesn't take a cough for an answer", () => {
    const quiet = feed(startVoice(0), times(8, -55), 0);
    const cough = feed(quiet.state, times(MIN_SPEECH_MS / 50 - 2, -25), quiet.at);
    expect(feed(cough.state, times(60, -55), cough.at).doneAt).toBeNull();
  });

  it('measures the quiet first, so road noise counts as quiet', () => {
    const road = feed(startVoice(0), times(8, -32), 0);
    expect(road.state.floor).toBe(-32);
    // Under the noise's level plus the margin, it isn't speech.
    expect(feed(road.state, times(40, -25), road.at).state.spokeMs).toBe(0);
    const spoke = feed(road.state, times(20, -15), road.at);
    expect(feed(spoke.state, times(30, -31), spoke.at).doneAt).not.toBeNull();
  });

  it('a pause in the middle of an answer does not end it', () => {
    const quiet = feed(startVoice(0), times(8, -55), 0);
    const first = feed(quiet.state, times(10, -30), quiet.at);
    const gap = feed(first.state, times(DONE_QUIET_MS / 50 - 4, -55), first.at);
    expect(gap.doneAt).toBeNull();
    const second = feed(gap.state, times(10, -30), gap.at);
    expect(second.state.quietSince).toBeNull();
  });

  it('reads a missing level as the quietest', () => {
    const quiet = feed(startVoice(0), times(8, Number.NaN), 0);
    expect(quiet.state.floor).toBe(-60);
  });
});
