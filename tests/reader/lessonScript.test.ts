import { describe, expect, it } from 'vitest';
import { heardSoFar, markOf, scriptOf, slowAnswer, speakerLabel, takeAfter, turnAt, type ScriptEntry, type ScriptTurn } from '../../src/reader/lessonScript';

const ASK: ScriptEntry[] = [
  { kind: 'say', voice: 'narrator', text: 'How do you say: A coffee.', english: null, start: 0, end: 1_500 },
  { kind: 'turn', text: 'Un café.', english: 'A coffee.', start: 1_500, end: 5_000, replay: 0 },
  { kind: 'say', voice: 'native', text: 'Un café.', english: 'A coffee.', start: 5_000, end: 6_000 },
];
const REPEAT: ScriptEntry[] = [
  { kind: 'say', voice: 'native', text: "s'il vous plaît", english: null, start: 10_000, end: 11_000 },
  { kind: 'turn', text: "s'il vous plaît", english: null, start: 11_000, end: 14_000, replay: 9_000 },
  { kind: 'say', voice: 'native', text: "L'addition, s'il vous plaît.", english: null, start: 14_000, end: 15_500 },
];
const turn = (entries: ScriptEntry[]) => entries.find((e): e is ScriptTurn => e.kind === 'turn')!;

describe('scriptOf', () => {
  it('has none for a lesson made before transcripts were kept', () => {
    expect(scriptOf({ script: null })).toBeNull();
    expect(scriptOf({})).toBeNull();
  });

  it('keeps well-formed entries in order and drops the rest', () => {
    const raw = [ASK[2], { kind: 'say', voice: 'robot', text: 'x', start: 0, end: 1 }, { kind: 'turn', text: 'x', start: 5, end: 1, replay: 0 }, ASK[0], ASK[1], 'junk'];
    expect(scriptOf({ script: raw })).toEqual(ASK);
  });

  it('never replays from after the turn', () => {
    const [entry] = scriptOf({ script: [{ ...ASK[1], replay: 9_999 }] })!;
    expect(entry.kind === 'turn' && entry.replay).toBe(1_500);
  });
});

describe('heardSoFar', () => {
  it("shows what's started, so an answer stays hidden until it's said", () => {
    expect(heardSoFar(ASK, 2).map((e) => e.kind)).toEqual(['say', 'turn']);
    expect(heardSoFar(ASK, 5)).toEqual(ASK);
  });
});

describe('turnAt', () => {
  it('finds the turn the player is in', () => {
    expect(turnAt(ASK, 3)).toBe(ASK[1]);
    expect(turnAt(ASK, 0.5)).toBeNull();
    expect(turnAt(ASK, 5)).toBeNull();
  });
});

describe('takeAfter', () => {
  it('plays the take once the voice has given the answer to a question', () => {
    expect(takeAfter(ASK, turn(ASK))).toBe(6_000);
  });

  it("plays it as the turn ends after a repeat, the line having been heard before it", () => {
    expect(takeAfter(REPEAT, turn(REPEAT))).toBe(14_000);
  });
});

describe('slowAnswer', () => {
  it('is slow past the lesson\'s own pause', () => {
    expect(slowAnswer(turn(ASK), 3_500)).toBe(false);
    expect(slowAnswer(turn(ASK), 3_501)).toBe(true);
  });
});

describe('markOf', () => {
  it('notes a phrase with its meaning', () => {
    expect(markOf(turn(ASK), 'again')).toEqual({ text: 'Un café.', english: 'A coffee.', reason: 'again' });
  });

  it('leaves out a part being built up, which has no meaning of its own', () => {
    expect(markOf(turn(REPEAT), 'slow')).toBeNull();
  });
});

describe('speakerLabel', () => {
  it('names who says each entry', () => {
    expect(ASK.map(speakerLabel)).toEqual(['Narrator', 'You', 'Voice']);
  });
});
