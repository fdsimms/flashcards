import { describe, expect, it } from 'vitest';
import { bestHeard, canListen, hearingText, recognitionLocale, spokenAnswerNote, speakingErrorText } from '../../src/core/speaking';

describe('spokenAnswerNote', () => {
  it('mentions tones only for Thai', () => {
    expect(spokenAnswerNote('th-TH')).toContain('tones');
    expect(spokenAnswerNote('pl-PL')).not.toContain('tones');
    expect(spokenAnswerNote(undefined)).not.toContain('tones');
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
    expect(hearingText(true, true)).toBe('Can be heard, also offline');
    expect(hearingText(true, false)).toBe('Can be heard when online');
    expect(hearingText(true, null)).toBe('Can be heard');
    expect(hearingText(false, null)).toBe("Can't be heard");
    expect(hearingText(null, null)).toBe('');
  });
});
