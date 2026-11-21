import { describe, expect, it } from 'vitest';
import { bestHeard, canListen, joinSegments, hearingText, recognitionLocale, spokenAnswerNote, speakingErrorText } from '../../src/core/speaking';

describe('spokenAnswerNote', () => {
  it('mentions tones only for Thai', () => {
    expect(spokenAnswerNote('th-TH')).toContain('tones');
    expect(spokenAnswerNote('pl-PL')).not.toContain('tones');
    expect(spokenAnswerNote(undefined)).not.toContain('tones');
  });
  it('mentions pitch accent for Japanese', () => {
    expect(spokenAnswerNote('ja-JP')).toContain('pitch accent');
    expect(spokenAnswerNote('th-TH')).not.toContain('pitch accent');
  });
});

describe('recognitionLocale', () => {
  const ios = ['de_DE', 'es_ES', 'es_US', 'nb_NO', 'pl_PL', 'th_TH'];
  it('takes the same locale, written as iOS writes it', () => {
    expect(recognitionLocale('th-TH', ios)).toBe('th-TH');
  });
  it('falls back to the same language', () => {
    expect(recognitionLocale('es-MX', ios)).toBe('es-ES');
    expect(recognitionLocale('no-NO', ios)).toBe('nb-NO');
  });
  it("is undefined for a language iOS can't hear", () => {
    expect(recognitionLocale('el-GR', ios)).toBeUndefined();
    expect(recognitionLocale(undefined, ios)).toBeUndefined();
  });
});

describe('bestHeard', () => {
  it('picks the guess closest to the answer', () => {
    expect(bestHeard(['espera', 'esperar', 'esperas'], 'esperar')).toBe('esperar');
    expect(bestHeard(['Esperar.', 'esperas'], 'esperar')).toBe('Esperar.');
  });
  it('takes the first without an answer, and skips empty guesses', () => {
    expect(bestHeard([' ', 'ไปสยามครับ', 'ไปสยาม'])).toBe('ไปสยามครับ');
    expect(bestHeard([])).toBe('');
  });
  it('picks the guess closest to any answer, such as a Japanese reading', () => {
    expect(bestHeard(['違う', 'たべる'], ['食べる', 'たべる'])).toBe('たべる');
    expect(bestHeard(['違う', '食べる'], ['食べる', 'たべる'])).toBe('食べる');
  });
});

describe('speakingErrorText', () => {
  it('says nothing when stopped on purpose, and what to do otherwise', () => {
    expect(speakingErrorText('aborted')).toBeUndefined();
    expect(speakingErrorText('no-speech')).toMatch(/^Didn't hear anything/);
    expect(speakingErrorText('something new')).toMatch(/Try again/);
  });
});

describe('canListen', () => {
  const base = { on: true, locale: 'th-TH', offline: false, onDevice: false };
  it('hides the microphone offline only for a language heard by Apple\'s servers', () => {
    expect(canListen(base)).toBe(true);
    expect(canListen({ ...base, offline: true })).toBe(false);
    expect(canListen({ ...base, offline: true, onDevice: true })).toBe(true);
    // A build that can't tell keeps it, as before.
    expect(canListen({ ...base, offline: true, onDevice: null })).toBe(true);
  });

  it('needs the setting and a language that can be heard', () => {
    expect(canListen({ ...base, on: false })).toBe(false);
    expect(canListen({ ...base, locale: undefined })).toBe(false);
  });
});

describe('hearingText', () => {
  it('says whether a language can be heard offline', () => {
    expect(hearingText(true, true)).toBe('Works offline too');
    expect(hearingText(true, false)).toBe('Works only when online');
    expect(hearingText(true, null)).toBe('Supported');
    expect(hearingText(false, null)).toBe('Not supported');
    expect(hearingText(null, null)).toBe('');
  });
});

describe('joinSegments', () => {
  it('replaces the segment while it is being revised', () => {
    const a = joinSegments('', '', 'ผม');
    const b = joinSegments(a.done, a.last, 'ผมไม่');
    expect(b.text).toBe('ผมไม่');
  });
  it('keeps what was said before a pause when a new transcript starts', () => {
    const a = joinSegments('', '', 'ไม่เคย');
    const b = joinSegments(a.done, a.last, 'ครับ');
    expect(b.text).toBe('ไม่เคยครับ');
    expect(joinSegments(b.done, b.last, 'ครับผม').text).toBe('ไม่เคยครับผม');
  });
  it('puts a space between segments of a spaced language', () => {
    const a = joinSegments('', '', 'I have never');
    expect(joinSegments(a.done, a.last, 'run before').text).toBe('I have never run before');
  });
  it('ignores an empty result', () => {
    const a = joinSegments('', '', 'ไม่เคย');
    expect(joinSegments(a.done, a.last, '  ').text).toBe('ไม่เคย');
  });
});
