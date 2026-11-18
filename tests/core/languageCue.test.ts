import { describe, expect, it } from 'vitest';
import { languageCue } from '../../src/core/languageCue';

describe('the language cue', () => {
  it('names the word\'s language, then English, on a forward card', () => {
    expect(languageCue('forward', 'ru-RU')).toEqual({ from: 'Russian', to: 'English' });
  });

  it('says the same for an audio card, which plays the word and asks for the meaning', () => {
    expect(languageCue('audio', 'pl-PL')).toEqual({ from: 'Polish', to: 'English' });
  });

  it('turns around on a reverse card, which shows the meaning and asks for the word', () => {
    expect(languageCue('reverse', 'de-DE')).toEqual({ from: 'English', to: 'German' });
  });

  it('shows nothing when the language is unknown or English, or for another card kind', () => {
    expect(languageCue('forward', undefined)).toBeUndefined();
    expect(languageCue('forward', 'en-US')).toBeUndefined();
    expect(languageCue('t1', 'ru-RU')).toBeUndefined();
  });
});
