import { describe, expect, it } from 'vitest';
import type { ReaderText, TextLine } from '../../src/reader/api';
import { drillLines, lineText, markLine, MAX_RETURNS, roundLine, roundProgress, roundScore, startRound } from '../../src/reader/lineDrill';

const line = (words: string[], over: Partial<TextLine> = {}): TextLine =>
  ({ speaker: 'A', english: 'English', words: words.map((text) => ({ text })) as TextLine['words'], audio: true, ...over });

const text = {
  lines: [
    line(['¿', 'Me', ' ', 'trae', ' ', 'la', ' ', 'cuenta', '?']),
    line(['Sí', '.']),
    line(['Claro', ',', ' ', 'ahora', ' ', 'mismo', '.'], { audio: false }),
    line(['Muchas', ' ', 'gracias', '.'], { english: '' }),
  ],
} as unknown as ReaderText;

describe('drillLines', () => {
  it('asks lines with their English and two words or more', () => {
    expect(drillLines(text, 'say')).toEqual([0, 2]);
  });
  it('asks only recorded lines by ear', () => {
    expect(drillLines(text, 'hear')).toEqual([0]);
  });
});

describe('lineText', () => {
  it('joins the words as the reader shows them', () => {
    expect(lineText(text.lines[0])).toBe('¿Me trae la cuenta?');
  });
});

describe('a round', () => {
  it('goes through the lines once when each is got', () => {
    let r = startRound([0, 2]);
    expect(roundLine(r)).toBe(0);
    r = markLine(r, true);
    r = markLine(r, true);
    expect(roundLine(r)).toBeUndefined();
    expect(roundScore(r)).toEqual({ right: 2, asked: 2 });
  });

  it('brings a missed line back at the end, counting only its first answer', () => {
    let r = startRound([0, 2]);
    r = markLine(r, false);
    expect(r.queue).toEqual([0, 2, 0]);
    r = markLine(r, true);
    expect(roundLine(r)).toBe(0);
    expect(roundProgress(r)).toEqual({ done: 2, total: 2 });
    r = markLine(r, true);
    expect(roundLine(r)).toBeUndefined();
    expect(roundScore(r)).toEqual({ right: 1, asked: 2 });
  });

  it('stops bringing a line back after MAX_RETURNS', () => {
    let r = startRound([5]);
    for (let i = 0; i <= MAX_RETURNS; i++) r = markLine(r, false);
    expect(roundLine(r)).toBeUndefined();
    expect(r.queue).toEqual(Array(MAX_RETURNS + 1).fill(5));
  });

  it('counts where the round is by distinct lines', () => {
    const r = startRound([0, 2, 4]);
    expect(roundProgress(r)).toEqual({ done: 1, total: 3 });
  });
});
