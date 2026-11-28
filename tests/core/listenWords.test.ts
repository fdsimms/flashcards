import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listenMinutes, listenSummary, pickListenWords, startedSince } from '../../src/core/listenWords';
import { newSchedState } from '../../src/core/scheduler';
import type { Card, Note, ReviewLogEntry, SchedState } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const DAY_START = 4;
const PL = '👅 Languages::🥟 Polski';

function word(id: string, entry: string, meaning: string, over: Record<string, string> = {}, deck = PL, tags: string[] = []): Note {
  return { ...omniNote({ Entry: entry, Meaning: meaning, Language: 'polish', ...over }), id, deck, tags };
}
function card(noteId: string, sched: Partial<SchedState> = {}, over: Partial<Card> = {}): Card {
  return { id: `${noteId}:forward`, noteId, kind: 'forward', suspended: false, retired: false, sched: { ...newSchedState(NOW), ...sched }, ...over };
}
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000);
const dueOn = (days: number): Partial<SchedState> => ({ state: 2, due: at(days).toISOString(), lastReview: at(-10).toISOString(), scheduledDays: 10 });
const learnt = (days: number): Partial<SchedState> => ({ state: 2, due: at(5).toISOString(), lastReview: at(days).toISOString(), scheduledDays: 5 });
const pick = (notes: Note[], cards: Card[], started = new Set<string>(), count = 30) =>
  pickListenWords({ notes, cards, started, deck: PL, now: NOW, dayStartsAtHour: DAY_START, count });

describe('Your words', () => {
  it('takes words due today first, soonest due first, then words started lately, newest first', () => {
    const notes = [word('a', 'kot', 'cat'), word('b', 'pies', 'dog'), word('c', 'dom', 'house'), word('d', 'las', 'forest'), word('e', 'stół', 'table')];
    const cards = [card('a', dueOn(0)), card('b', dueOn(-3)), card('c', learnt(-2)), card('d', learnt(-1)), card('e', dueOn(4))];
    const got = pick(notes, cards, new Set(['c:forward', 'd:forward']));
    expect(got.map((w) => [w.text, w.why])).toEqual([['pies', 'due'], ['kot', 'due'], ['las', 'recent'], ['dom', 'recent']]);
    expect(listenSummary(got)).toBe('2 due today and 2 started in the last two weeks');
    expect(pick(notes, cards, new Set(['c:forward']), 1).map((w) => w.text)).toEqual(['pies']);
  });

  it('leaves out other decks, skill cards, suspended cards, new cards and words without a meaning', () => {
    const notes = [
      word('a', 'kot', 'cat', {}, '👅 Languages::🌮 Español'),
      word('b', 'pies', 'dog', {}, PL, ['skill']),
      word('c', 'dom', 'house'),
      word('d', 'las', ''),
      word('e', 'nowy', 'new'),
      word('f', 'rzeka', 'river', {}, `${PL}::Rzeczowniki`),
    ];
    const cards = [card('a', dueOn(0)), card('b', dueOn(0)), card('c', dueOn(0), { suspended: true }), card('d', dueOn(0)), card('e'), card('f', dueOn(0))];
    expect(pick(notes, cards).map((w) => w.text)).toEqual(['rzeka']);
  });

  it('carries the first example and its translation, as plain text', () => {
    const notes = [word('a', 'kot', '<b>cat</b>', { Context: 'Mam <i>kota</i>.', ContextTranslation: 'I have a cat.' })];
    expect(pick(notes, [card('a', dueOn(0))])).toEqual([
      { noteId: 'a', text: 'kot', english: 'cat', example: 'Mam kota.', exampleEnglish: 'I have a cat.', why: 'due' },
    ]);
    expect(listenMinutes(pick(notes, [card('a', dueOn(0))]))).toBe(1);
  });

  it('counts a card as started lately from its first answer in the review log', () => {
    const log = (cardId: string, state: number, days: number): ReviewLogEntry => ({ cardId, rating: 3, reviewedAt: at(days).toISOString(), state, due: '', stability: 1, difficulty: 5 });
    const started = startedSince([log('a', 0, -3), log('b', 2, -1), log('c', 0, -20)], at(-14));
    expect([...started]).toEqual(['a']);
  });

  it('imports nothing that schedules or writes a card', () => {
    const imports = readFileSync(join(__dirname, '..', '..', 'src/core/listenWords.ts'), 'utf8').split('\n').filter((l) => l.startsWith('import'));
    expect(imports.filter((l) => /scheduler|session|writeback|noteService|noteWrites|\/db\//.test(l))).toEqual([]);
  });
});
