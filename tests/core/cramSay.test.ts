import { describe, expect, it } from 'vitest';
import { canAskMore, factsFromSummary, hasAnswer, linesRequest, missingWords, questionRequest, saidFromText, saidFromTurns, SAY_QUESTIONS, SAY_SAID_MAX, SAY_TURNS_MAX, sayChips, type SayTurn } from '../../src/core/cramSay';
import { THEME_FACTS_CHARS } from '../../src/core/cramThemes';

const q = (text: string): SayTurn => ({ asker: 'claude', text });
const a = (text: string): SayTurn => ({ asker: 'you', text });

describe('questionRequest', () => {
  it('tidies the topic and turns, drops empty ones and keeps the latest within what the server takes', () => {
    const many = Array.from({ length: SAY_TURNS_MAX + 4 }, (_, i) => (i % 2 ? a(`answer ${i}`) : q(`question ${i}`)));
    const r = questionRequest('th', '  The 5k   race ', [q('  '), ...many]);
    expect(r.topic).toBe('The 5k race');
    expect(r.turns).toHaveLength(SAY_TURNS_MAX);
    expect(r.turns?.[SAY_TURNS_MAX - 1]?.text).toBe(`answer ${SAY_TURNS_MAX + 3}`);
  });
});

describe('the chat', () => {
  it('offers another question until the limit, and only after the last one is answered', () => {
    expect(canAskMore([])).toBe(false);
    expect(canAskMore([q('One?')])).toBe(false);
    expect(canAskMore([q('One?'), a('Yes')])).toBe(true);
    const full = Array.from({ length: SAY_QUESTIONS }, (_, i) => [q(`Q${i}?`), a('Yes')]).flat();
    expect(canAskMore(full)).toBe(false);
  });

  it('needs an answer with something in it before there is anything to turn into lines', () => {
    expect(hasAnswer([q('One?')])).toBe(false);
    expect(hasAnswer([q('One?'), a('   ')])).toBe(false);
    expect(hasAnswer([q('One?'), a('Fine')])).toBe(true);
  });

  it('writes each answer under its question and keeps the newest when it is too long', () => {
    expect(saidFromTurns([q('How did it go?'), a('  Pretty   good '), q('The hill?'), a('Steep')])).toBe('Asked: How did it go? Said: Pretty good\nAsked: The hill? Said: Steep');
    expect(saidFromTurns([a('No question first')])).toBe('No question first');
    const long = saidFromTurns([q('Q?'), a('x'.repeat(SAY_SAID_MAX + 50))]);
    expect(long).toHaveLength(SAY_SAID_MAX);
  });
});

describe('free write', () => {
  it('collapses spaces and stays within what the server takes', () => {
    expect(saidFromText('  Ran   the\n5k ')).toBe('Ran the 5k');
    expect(saidFromText('x'.repeat(SAY_SAID_MAX + 5))).toHaveLength(SAY_SAID_MAX);
  });
});

describe('linesRequest', () => {
  const words = [{ noteId: 'n1', text: 'วิ่ง', english: 'to run', kind: 'cram' as const }];
  it('sends the words, and the particle only for Thai', () => {
    const th = linesRequest('th', 'The 5k', 'I ran', words, undefined, 'khrap');
    expect(th.words).toEqual([{ id: 'n1', text: 'วิ่ง', english: 'to run', kind: 'cram' }]);
    expect(th.particle).toBe('khrap');
    expect(linesRequest('fr', 'The 5k', 'I ran', words, undefined, 'khrap').particle).toBeUndefined();
  });
  it('sends a register only when one was chosen', () => {
    expect(linesRequest('fr', '', 'I ran', words).register).toBeUndefined();
    expect(linesRequest('fr', '', 'I ran', words, 'formal').register).toBe('formal');
  });
});

describe('factsFromSummary', () => {
  it('keeps a short summary and cuts a long one at a word', () => {
    expect(factsFromSummary(' I ran   the 5k. ')).toBe('I ran the 5k.');
    const long = factsFromSummary('word '.repeat(100));
    expect(long.length).toBeLessThanOrEqual(THEME_FACTS_CHARS);
    expect(long.endsWith('word')).toBe(true);
  });
});

describe('missing words', () => {
  const line = (missing: { word: string; english: string }[], known = 0) => ({ english: 'x', text: 'y', known, missing });
  it('lists each word with a meaning once', () => {
    const lines = [line([{ word: 'ชัน', english: 'steep' }, { word: 'เนิน', english: '' }]), line([{ word: 'ชัน', english: 'steep' }])];
    expect(missingWords(lines)).toEqual([{ word: 'ชัน', english: 'steep' }]);
  });
  it('says what a line holds in its chips', () => {
    expect(sayChips(line([], 1))).toEqual({ known: '1 word you know' });
    expect(sayChips(line([{ word: 'a', english: 'b' }], 3))).toEqual({ known: '3 words you know', missing: '1 to learn' });
    expect(sayChips(line([]))).toEqual({});
  });
});
