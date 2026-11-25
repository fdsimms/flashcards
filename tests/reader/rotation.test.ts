import { describe, expect, it } from 'vitest';
import type { GrammarAnswer } from '../../src/core/grammarDrills';
import type { GrammarRotation } from '../../src/reader/api';
import { ANSWER_BATCH, allSent, answersToSend, rotationCopy, sentThroughAfter, shortName, undoneLine } from '../../src/reader/rotation';

const answer = (at: string, pointId = 'th.ever'): GrammarAnswer => ({ pointId, drillId: 'd', kind: 'gap', correct: true, answeredAt: at });

const swap = (over: Partial<GrammarRotation> = {}): GrammarRotation => ({
  id: 1,
  language: 'th',
  graduated: { id: 'th.ever', name: 'เคย (have ever)' },
  started: { id: 'th.future', name: 'จะ (will)' },
  texts: 8,
  days: 4,
  drill_right: 9,
  drill_asked: 10,
  at: '2026-11-25T09:00:00',
  ...over,
});

describe('sending practice answers', () => {
  const all = [answer('2026-11-20T10:00:02'), answer('2026-11-20T10:00:00'), answer('2026-11-20T10:00:01')];

  it('sends every answer, oldest first, when none has been sent', () => {
    expect(answersToSend(all, null).map((a) => a.answeredAt)).toEqual([
      '2026-11-20T10:00:00', '2026-11-20T10:00:01', '2026-11-20T10:00:02',
    ]);
  });

  it('sends from the last one sent on, that one again included', () => {
    expect(answersToSend(all, '2026-11-20T10:00:01').map((a) => a.answeredAt)).toEqual(['2026-11-20T10:00:01', '2026-11-20T10:00:02']);
  });

  it('moves the mark to the latest answer sent, and keeps it when nothing went', () => {
    expect(sentThroughAfter(all, null)).toBe('2026-11-20T10:00:02');
    expect(sentThroughAfter([], '2026-11-20T10:00:01')).toBe('2026-11-20T10:00:01');
  });

  it('sends a long backlog in batches until nothing new is left', () => {
    const many = Array.from({ length: ANSWER_BATCH + 3 }, (_, i) => answer(new Date(Date.UTC(2026, 10, 1, 0, 0, i)).toISOString()));
    let mark: string | null = null;
    let rounds = 0;
    while (!allSent(many, mark) && rounds < 5) {
      const batch = answersToSend(many, mark);
      expect(batch.length).toBeLessThanOrEqual(ANSWER_BATCH);
      mark = sentThroughAfter(batch, mark);
      rounds++;
    }
    expect(rounds).toBe(2);
    expect(mark).toBe(many[many.length - 1].answeredAt);
  });
});

describe('the rotation notice', () => {
  it('names what is practiced now and why the last point moved on', () => {
    expect(rotationCopy(swap())).toEqual({
      title: 'Now practicing จะ (will)',
      body: 'เคย (have ever) moved to Know it after 8 texts and 9 of your last 10 practice questions right.',
      open: 'See จะ',
    });
  });

  it('gives the days instead when there were too few practice answers to name', () => {
    expect(rotationCopy(swap({ texts: 12, days: 5, drill_right: 2, drill_asked: 2 }))?.body).toBe(
      'เคย (have ever) moved to Know it after 12 texts over 5 days.',
    );
  });

  it('says so when no point was left to start', () => {
    expect(rotationCopy(swap({ started: null }))).toEqual({
      title: 'เคย (have ever) is learned',
      body: 'เคย (have ever) moved to Know it after 8 texts and 9 of your last 10 practice questions right. Every Thai point in the list is practiced or known.',
      open: null,
    });
  });

  it('shows nothing for a point this app does not know', () => {
    expect(rotationCopy(swap({ graduated: null }))).toBeNull();
  });

  it('says which point is practiced again after Undo', () => {
    expect(undoneLine(swap())).toBe('Practicing เคย again.');
    expect(shortName('Preterite')).toBe('Preterite');
  });
});
