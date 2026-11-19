import { describe, expect, it } from 'vitest';
import {
  activityStep, idleExpired, IDLE_END_MS, kindLabel, lineDetail, parseAction, type Listening, type Sent,
} from '../../src/reader/listeningActivity';

const lesson: Listening = { kind: 'lesson', title: 'Der erste Kuchen', detail: '', looping: false };
const sent = (over: Partial<Sent> = {}): Sent => ({ listening: lesson, playing: true, position: 10, duration: 200, at: 1_000_000, ...over });

describe('activityStep', () => {
  it('starts one when nothing was sent', () => {
    expect(activityStep(null, lesson, { playing: true, position: 0, duration: 200 }, 0)).toBe('start');
  });

  it('starts a new one for a different title or kind', () => {
    const snap = { playing: true, position: 10, duration: 200 };
    expect(activityStep(sent(), { ...lesson, title: 'Another' }, snap, 1_000_000)).toBe('start');
    expect(activityStep(sent(), { ...lesson, kind: 'text' }, snap, 1_000_000)).toBe('start');
  });

  it('updates when playing starts or stops, or the line changes', () => {
    expect(activityStep(sent(), lesson, { playing: false, position: 10, duration: 200 }, 1_000_000)).toBe('update');
    expect(activityStep(sent(), { ...lesson, detail: 'Line 2 of 12' }, { playing: true, position: 10, duration: 200 }, 1_000_000)).toBe('update');
  });

  it('updates when Loop is turned on or off', () => {
    const snap = { playing: true, position: 10, duration: 200 };
    expect(activityStep(sent(), { ...lesson, looping: true }, snap, 1_000_000)).toBe('update');
    expect(activityStep(sent({ listening: { ...lesson, looping: true } }), lesson, snap, 1_000_000)).toBe('update');
  });

  it('leaves it alone while playing runs on as expected', () => {
    expect(activityStep(sent(), lesson, { playing: true, position: 40, duration: 200 }, 1_030_000)).toBeNull();
    expect(activityStep(sent(), lesson, { playing: true, position: 41.5, duration: 200 }, 1_030_000)).toBeNull();
  });

  it('updates on a skip or seek, forward or back', () => {
    expect(activityStep(sent(), lesson, { playing: true, position: 55, duration: 200 }, 1_030_000)).toBe('update');
    expect(activityStep(sent(), lesson, { playing: true, position: 5, duration: 200 }, 1_030_000)).toBe('update');
  });

  it('does not expect a paused position to move', () => {
    const paused = sent({ playing: false });
    expect(activityStep(paused, lesson, { playing: false, position: 10, duration: 200 }, 1_600_000)).toBeNull();
    expect(activityStep(paused, lesson, { playing: false, position: 30, duration: 200 }, 1_600_000)).toBe('update');
  });

  it('updates when the length settles on something else, but not for a rounding change', () => {
    expect(activityStep(sent(), lesson, { playing: true, position: 10, duration: 230 }, 1_000_000)).toBe('update');
    expect(activityStep(sent(), lesson, { playing: true, position: 10, duration: 200.4 }, 1_000_000)).toBeNull();
  });
});

describe('idleExpired', () => {
  it('is false while playing and before the time is up', () => {
    expect(idleExpired(null, 5_000_000)).toBe(false);
    expect(idleExpired(1_000, 1_000 + IDLE_END_MS - 1)).toBe(false);
  });
  it('is true once it has been paused that long', () => {
    expect(idleExpired(1_000, 1_000 + IDLE_END_MS)).toBe(true);
  });
});

describe('labels and actions', () => {
  it('names the kinds and lines', () => {
    expect(kindLabel('lesson')).toBe('Audio lesson');
    expect(kindLabel('text')).toBe('Read & Listen');
    expect(lineDetail({ n: 4, of: 12 })).toBe('Line 4 of 12');
  });
  it('reads only the three buttons', () => {
    expect(parseAction('toggle')).toBe('toggle');
    expect(parseAction('previous')).toBe('previous');
    expect(parseAction('next')).toBe('next');
    expect(parseAction('startOver')).toBe('startOver');
    expect(parseAction('loop')).toBe('loop');
    expect(parseAction('stop')).toBeNull();
    expect(parseAction(undefined)).toBeNull();
  });
});
