import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { needsSound, parseQuiet, quietActive, quietEndsText, quietEnd, quietHeldIds, quietHolds, startQuiet } from '../../src/core/quietMode';
import { NOW, omniNote } from '../support/fixtures';

const H = 4;
const cards = makeCards({ ...omniNote({ GenerateReverse: 'y', GenerateAudioCard: 'y' }), id: 'w' }, NOW);

describe('quietEnd', () => {
  it('ends an hour or three hours from now', () => {
    expect(quietEnd('hour', NOW, H)).toEqual(new Date(2026, 10, 11, 13, 0));
    expect(quietEnd('three-hours', NOW, H)).toEqual(new Date(2026, 10, 11, 15, 0));
  });
  it('ends "until tomorrow" at the next study day, not midnight', () => {
    expect(quietEnd('tomorrow', NOW, H)).toEqual(new Date(2026, 10, 12, 4, 0));
    // At 1 AM it is still the previous study day, so it ends that same morning's 4 AM.
    expect(quietEnd('tomorrow', new Date(2026, 10, 12, 1, 0), H)).toEqual(new Date(2026, 10, 12, 4, 0));
  });
  it('has no end when it stays on until turned off', () => {
    expect(quietEnd('manual', NOW, H)).toBeUndefined();
    expect(startQuiet('manual', NOW, H)).toEqual({ choice: 'manual' });
  });
});

describe('quietActive', () => {
  it('is off with no setting, on until its end, and off after it', () => {
    expect(quietActive(null, NOW)).toBe(false);
    const prefs = startQuiet('hour', NOW, H);
    expect(quietActive(prefs, new Date(2026, 10, 11, 12, 59))).toBe(true);
    expect(quietActive(prefs, new Date(2026, 10, 11, 13, 0))).toBe(false);
  });
  it('stays on with no end until it is turned off', () => {
    expect(quietActive({ choice: 'manual' }, new Date(2030, 0, 1))).toBe(true);
  });
});

describe('what is set aside', () => {
  it('holds only the listening cards, only while it is on', () => {
    expect([...quietHeldIds(cards, true)]).toEqual(['w:audio']);
    expect(quietHeldIds(cards, false).size).toBe(0);
    expect(quietHeldIds(undefined, true).size).toBe(0);
    expect(cards.map((c) => quietHolds(c, true))).toEqual(cards.map((c) => c.kind === 'audio'));
  });
});

describe('parseQuiet', () => {
  it('reads what was saved and treats anything else as off', () => {
    const prefs = startQuiet('three-hours', NOW, H);
    expect(parseQuiet(JSON.stringify(prefs))).toEqual(prefs);
    expect(parseQuiet(null)).toBeNull();
    expect(parseQuiet('nope')).toBeNull();
    expect(parseQuiet('{"choice":"forever"}')).toBeNull();
    expect(parseQuiet('{"choice":"hour","until":"not a date"}')).toBeNull();
  });
});

describe('quietEndsText', () => {
  it('says how long is left', () => {
    expect(quietEndsText(startQuiet('three-hours', NOW, H), new Date(2026, 10, 11, 13, 0))).toBe('for 2 more hours');
    expect(quietEndsText(startQuiet('hour', NOW, H), new Date(2026, 10, 11, 12, 30))).toBe('for 30 more minutes');
    expect(quietEndsText(startQuiet('hour', NOW, H), new Date(2026, 10, 11, 12, 59))).toBe('for 1 more minute');
    expect(quietEndsText(startQuiet('tomorrow', NOW, H), NOW)).toBe('until tomorrow');
    expect(quietEndsText({ choice: 'manual' }, NOW)).toBe('until you turn it off');
  });
});

describe('needsSound', () => {
  it('names the Practice tools that are nothing without sound', () => {
    expect(needsSound('hearing')).toBe(true);
    expect(needsSound('numbers')).toBe(false);
    expect(needsSound('read')).toBe(false);
  });
});
