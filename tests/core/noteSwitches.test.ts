import { describe, expect, it } from 'vitest';
import { cardKindsFor } from '../../src/core/cards';
import { CARD_SWITCHES, hasCardSwitches, switchOn, withSwitch } from '../../src/core/noteSwitches';
import type { Note } from '../../src/core/types';

const [front, reverse, audio] = CARD_SWITCHES;
const note = (fields: Record<string, string>): Note => ({ id: 'n', deck: 'Thai', model: 'Omnilanguage', tags: [], fields: { Entry: 'ร่ม', Meaning: 'umbrella', GenerateReverse: '', GenerateAudioCard: '', SuppressFrontCard: '', ...fields } });

describe('the card switches', () => {
  it('read as "this card is made", the front card being on until it is suppressed', () => {
    const fields = { SuppressFrontCard: '', GenerateReverse: 'y', GenerateAudioCard: '' };
    expect([front, reverse, audio].map((s) => switchOn(fields, s))).toEqual([true, true, false]);
    expect(switchOn({ SuppressFrontCard: 'y' }, front)).toBe(false);
    // Anki turns a conditional on for anything at all, so the toggle does too.
    expect(switchOn({ GenerateReverse: 'no' }, reverse)).toBe(true);
    expect(switchOn({}, front)).toBe(true);
  });

  it('writes "y" or nothing, and leaves every other field alone', () => {
    expect(withSwitch({ Entry: 'x', GenerateReverse: '' }, reverse, true)).toEqual({ Entry: 'x', GenerateReverse: 'y' });
    expect(withSwitch({ GenerateReverse: 'no' }, reverse, false)).toEqual({ GenerateReverse: '' });
    expect(withSwitch({ SuppressFrontCard: '' }, front, false)).toEqual({ SuppressFrontCard: 'y' });
    expect(withSwitch({ SuppressFrontCard: 'y' }, front, true)).toEqual({ SuppressFrontCard: '' });
  });

  it('agree with the cards a note really makes, whichever way each is set', () => {
    const cases: Record<string, string>[] = [{}, { GenerateReverse: 'y' }, { GenerateAudioCard: 'y', SuppressFrontCard: 'y' }, { GenerateReverse: 'no', GenerateAudioCard: '0' }];
    for (const fields of cases) {
      const n = note(fields);
      const shown = CARD_SWITCHES.filter((s) => switchOn(n.fields, s)).map((s) => ({ SuppressFrontCard: 'forward', GenerateReverse: 'reverse', GenerateAudioCard: 'audio' })[s.field]);
      expect(shown).toEqual(cardKindsFor(n));
    }
  });

  it('are shown only for a note type that has all three fields', () => {
    expect(hasCardSwitches(['Entry', 'GenerateReverse', 'GenerateAudioCard', 'SuppressFrontCard'])).toBe(true);
    expect(hasCardSwitches(['Front', 'Back'])).toBe(false);
    expect(hasCardSwitches(['GenerateReverse'])).toBe(false);
  });
});
