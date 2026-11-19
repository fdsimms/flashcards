import { describe, expect, it } from 'vitest';
import { afterLine, linePosition, lineShown, skipTo, type Handoff } from '../../src/reader/handoff';
import type { Word } from '../../src/reader/api';

const lines = [{ audio: true }, { audio: false }, { audio: true }, { audio: true }];
const base: Handoff = { textId: 1, title: 'Na targu', language: 'pl', lines, current: 0, repeat: 1, played: 1, loop: false, rate: 1 };

describe('Play all carrying on', () => {
  it('goes on to the next line with audio, skipping one with none', () => {
    expect(afterLine(base)).toEqual({ kind: 'line', line: 2 });
  });

  it('stops after the last line', () => {
    expect(afterLine({ ...base, current: 3 })).toEqual({ kind: 'end' });
  });

  it('plays a line again until it has played the chosen number of times', () => {
    expect(afterLine({ ...base, repeat: 3, played: 1 })).toEqual({ kind: 'again' });
    expect(afterLine({ ...base, repeat: 3, played: 3 })).toEqual({ kind: 'line', line: 2 });
  });

  it('goes back to the first line after the last when Loop text was on', () => {
    expect(afterLine({ ...base, current: 3, loop: true })).toEqual({ kind: 'wrap', line: 0 });
    expect(afterLine({ ...base, current: 3, repeat: 2, played: 1, loop: true })).toEqual({ kind: 'again' });
  });

  it('plays a one-line text again as a new line, not as a repeat', () => {
    expect(afterLine({ ...base, lines: [{ audio: true }], current: 0, loop: true })).toEqual({ kind: 'wrap', line: 0 });
  });

  it('skips to the nearest line with audio either way, and nowhere past the ends', () => {
    expect(skipTo({ lines, current: 2 }, -1)).toBe(0);
    expect(skipTo({ lines, current: 2 }, 1)).toBe(3);
    expect(skipTo({ lines, current: 0 }, -1)).toBeNull();
    expect(skipTo({ lines, current: 3 }, 1)).toBeNull();
  });

  it('counts lines among those with audio', () => {
    expect(linePosition({ lines, current: 2 })).toEqual({ n: 2, of: 3 });
  });
});

describe('the line Now Playing shows', () => {
  const word = (text: string) => ({ text, status: null, gloss: null }) as unknown as Word;
  it('puts the playing line back together, with its English', () => {
    const withWords = [{ audio: true, words: [word('Dzień'), word(' '), word('dobry'), word('!')], english: 'Good morning!' }, { audio: true }];
    expect(lineShown({ lines: withWords, current: 0 })).toEqual({ text: 'Dzień dobry!', english: 'Good morning!' });
  });

  it('shows nothing for lines handed over without their words', () => {
    expect(lineShown({ lines, current: 0 })).toBeNull();
  });
});
