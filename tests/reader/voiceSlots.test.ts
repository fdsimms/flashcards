import { describe, expect, it } from 'vitest';
import type { AzureVoice, Speakers } from '../../src/reader/api';
import { hasVoiceSlots, isVoiceSlot, sampleLine, sharesVoice, slotInfo, voicesForSlot, voicesSummary } from '../../src/reader/voiceSlots';

const THAI: Speakers = { male: 'th-TH-NiwatNeural', male2: 'th-TH-NiwatNeural', female: 'th-TH-PremwadeeNeural', female2: 'th-TH-AcharaNeural' };

const v = (voice: string, gender?: string): AzureVoice => ({ voice, locale: 'th-TH', name: voice, gender });

describe('voicesForSlot', () => {
  const all = [v('a', 'Male'), v('b', 'Female'), v('c', 'Female'), v('d', 'Male'), v('e')];

  it('lists only the voices of the slot’s gender', () => {
    expect(voicesForSlot(all, 'male').map((x) => x.voice)).toEqual(['a', 'd']);
    expect(voicesForSlot(all, 'male2').map((x) => x.voice)).toEqual(['a', 'd']);
    expect(voicesForSlot(all, 'female').map((x) => x.voice)).toEqual(['b', 'c']);
    expect(voicesForSlot(all, 'female2').map((x) => x.voice)).toEqual(['b', 'c']);
  });

  it('leaves out a voice with no gender, rather than offer it for either', () => {
    expect(voicesForSlot([v('e')], 'male')).toEqual([]);
    expect(voicesForSlot([v('e')], 'female')).toEqual([]);
  });
});

describe('hasVoiceSlots', () => {
  it('is true for voices by gender and false for a server that still sends A and B', () => {
    expect(hasVoiceSlots(THAI)).toBe(true);
    expect(hasVoiceSlots({ A: 'x', B: 'y' } as unknown as Speakers)).toBe(false);
    expect(hasVoiceSlots(undefined)).toBe(false);
  });
});

describe('voicesSummary', () => {
  it('names the man’s and the woman’s voice', () => {
    expect(voicesSummary(THAI)).toBe('Niwat and Premwadee');
  });
  it('says nothing for voices it can’t read', () => {
    expect(voicesSummary(undefined)).toBeUndefined();
    expect(voicesSummary({ A: 'x', B: 'y' } as unknown as Speakers)).toBeUndefined();
  });
});

describe('sharesVoice', () => {
  it('is true while a gender’s second voice is its first', () => {
    expect(sharesVoice(THAI)).toBe(true);
    expect(sharesVoice({ ...THAI, male2: 'th-TH-KritNeural' })).toBe(false);
    expect(sharesVoice({ male: 'a', male2: 'b', female: 'c', female2: 'c' })).toBe(true);
  });
});

describe('slots', () => {
  it('has a plain label and a gender for each', () => {
    expect(slotInfo('male2')).toEqual({ slot: 'male2', gender: 'male', label: 'Second man' });
    expect(slotInfo('female')).toEqual({ slot: 'female', gender: 'female', label: 'Woman' });
  });
  it('tells a slot from any other route parameter', () => {
    expect(isVoiceSlot('female2')).toBe(true);
    expect(isVoiceSlot('A')).toBe(false);
    expect(isVoiceSlot(undefined)).toBe(false);
  });
});

describe('sampleLine', () => {
  it('uses the woman’s ending in Thai and the same line for a man', () => {
    expect(sampleLine('th', 'male')).toContain('ครับ');
    expect(sampleLine('th', 'female')).toContain('ค่ะ');
    expect(sampleLine('th', 'female')).not.toContain('ครับ');
  });
  it('is the same line for either gender elsewhere', () => {
    expect(sampleLine('de', 'male')).toBe(sampleLine('de', 'female'));
  });
});
