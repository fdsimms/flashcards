import { describe, expect, it } from 'vitest';
import { pickVoice, speechLanguage, ttsFilter, ttsTags, withoutTts } from '../../src/core/tts';
import vectors from '../fixtures/anki/tts-vectors.json';

/** Outputs recorded from the real `anki` 26.09.4 package (tests/fixtures/anki/make-tts-vectors.py). */
describe("reading Anki's tts tags", () => {
  it.each(vectors)('$html', ({ html, tags, rendered }) => {
    const ours = ttsTags(html, (tag, i) => (tag ? `<play ${i}>` : '<error>'));
    expect(ours.tags).toEqual(tags.filter((t) => !('sound' in t)));
    // Where Anki put an error, Franki does; everywhere else, a play button.
    expect(ours.html.includes('<error>')).toBe(rendered.includes('Error in directive'));
  });

  it("writes the tts filter as Anki's directive", () => {
    expect(ttsFilter('en_US voices=Bob,Jane', 'foo')).toBe('[anki:tts lang=en_US voices=Bob,Jane]foo[/anki:tts]');
  });

  it('takes the tags out of FrontSide, so the back reads only its own', () => {
    expect(withoutTts('a [anki:tts lang=en_US]x[/anki:tts] b')).toBe('a  b');
  });
});

describe("choosing the phone's voice", () => {
  const voices = [
    { identifier: 'com.apple.voice.compact.th-TH.Kanya', name: 'Kanya', language: 'th-TH' },
    { identifier: 'com.apple.voice.compact.en-US.Samantha', name: 'Samantha', language: 'en-US' },
    { identifier: 'com.apple.voice.premium.en-GB.Daniel', name: 'Daniel', language: 'en-GB' },
  ];
  const tag = (lang: string, v: string[]) => ({ text: 'x', lang, voices: v, speed: 1 });

  it("writes Anki's language codes as iOS does", () => {
    expect(speechLanguage('th_TH')).toBe('th-TH');
    expect(speechLanguage('pl')).toBe('pl');
  });

  it("finds Anki's Apple_ voice names in the tag's language, the first one the phone has", () => {
    expect(pickVoice(voices, tag('th_TH', ['Apple_Narisa', 'Apple_Kanya']))).toBe('com.apple.voice.compact.th-TH.Kanya');
    expect(pickVoice(voices, tag('en_US', ['Daniel']))).toBeUndefined(); // British, not American
    expect(pickVoice(voices, tag('en', ['Apple_Daniel']))).toBe('com.apple.voice.premium.en-GB.Daniel');
    expect(pickVoice(voices, tag('en_US', []))).toBeUndefined(); // iOS picks for the language
  });
});
