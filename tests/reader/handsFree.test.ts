import { describe, expect, it } from 'vitest';
import { handsFreeStatus, heardAll, hearing, joinLine, listen, MAX_SILENT, pause, replied, sent, START, withEnglish } from '../../src/reader/handsFree';

describe('the hands-free loop', () => {
  it('listens after their line, shows what it hears, and reviews the line once a pause ends it', () => {
    let s = listen(START);
    expect(s.step).toBe('listening');
    s = hearing(s, 'Poproszę chleb');
    expect(s.line).toBe('Poproszę chleb');
    s = heardAll(s, 'Poproszę chleb i bułkę');
    expect([s.step, s.line]).toEqual(['review', 'Poproszę chleb i bułkę']);
    s = sent(s);
    expect([s.step, s.line]).toEqual(['waiting', '']);
    expect(replied(s).step).toBe('theirs');
  });

  it('puts an English word in brackets and goes on listening for the rest', () => {
    let s = hearing(listen(START), 'Poproszę chleb i');
    s = withEnglish(s, ' a donut ');
    expect([s.step, s.line, s.committed]).toEqual(['listening', 'Poproszę chleb i [a donut]', 'Poproszę chleb i [a donut]']);
    s = hearing(listen(s), 'proszę');
    expect(s.line).toBe('Poproszę chleb i [a donut] proszę');
    // Nothing more said after the English word: what's there is sent.
    expect(heardAll(listen(withEnglish(hearing(listen(START), 'chcę'), 'cake')), '').line).toBe('chcę [cake]');
    expect(withEnglish(listen(START), '  ').line).toBe('');
  });

  it('opens the microphone again after silence, and pauses itself after too many', () => {
    let s = listen(START);
    for (let i = 1; i < MAX_SILENT; i++) {
      s = heardAll(s, '');
      expect([s.step, s.silent]).toEqual(['listening', i]);
    }
    s = heardAll(s, '');
    expect([s.step, s.paused, s.silent]).toEqual(['paused', 'silent', 0]);
    // A line heard resets the count.
    expect(heardAll({ ...listen(START), silent: 1 }, 'tak').silent).toBe(0);
  });

  it('stays paused when their reply comes in while paused', () => {
    const s = pause({ ...START, step: 'waiting' }, 'tapped');
    expect(replied(s).step).toBe('paused');
  });

  it('joins with one space and says where the loop is', () => {
    expect(joinLine(' a ', ' b ')).toBe('a b');
    expect(joinLine('', 'b')).toBe('b');
    expect(handsFreeStatus(START, 'Ania')).toBe('Ania is speaking');
    expect(handsFreeStatus(pause(START, 'silent'), 'Ania')).toMatch(/nothing was heard/);
    for (const step of ['listening', 'review', 'waiting'] as const) expect(handsFreeStatus({ ...START, step }, 'Ania')).not.toMatch(/—/);
  });
});
