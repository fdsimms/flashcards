import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { cardStateLine, noteDetail } from '../../src/core/noteDetail';
import type { Card } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const H = 4;
const note = omniNote();
const first = makeCards(note, NOW)[0];
const day = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
const line = (card: Card, now = NOW) => cardStateLine(card, now, H, day);
const review = (due: Date): Card => ({ ...first, sched: { ...first.sched, state: 2, due: due.toISOString() } });

describe('where a card stands, in Browse\'s panel', () => {
  it('says New, Learning, or when a review is due', () => {
    expect(line(first)).toBe('New');
    expect(line({ ...first, sched: { ...first.sched, state: 1 } })).toBe('Learning');
    expect(line({ ...first, sched: { ...first.sched, state: 3 } })).toBe('Learning');
    const later = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 3, 12);
    expect(line(review(later))).toBe(`Due ${day(later)}`);
  });

  it('counts a review as due today for its whole study day, and when overdue', () => {
    expect(line(review(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 5, 12)))).toBe('Due today');
    // 1 AM tomorrow is still today's study day when the day starts at 4.
    const lateNight = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1, 1);
    expect(line(review(lateNight))).toBe('Due today');
    const nextMorning = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1, 5);
    expect(line(review(nextMorning))).toBe(`Due ${day(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1))}`);
  });

  it('says a card is out of study before anything else', () => {
    expect(line({ ...review(NOW), suspended: true })).toBe('Suspended');
    expect(line({ ...first, buriedAt: NOW.toISOString() })).toBe('Buried until tomorrow');
  });
});

describe('a note in Browse\'s panel', () => {
  it('lists every field with something in it, as plain text', () => {
    const detail = noteDetail({ ...note, fields: { Entry: '<b>kot</b>', Meaning: 'cat', Example: '  ', Notes: 'a<br>b' } }, [], undefined, { now: NOW, dayStartsAtHour: H, formatDay: day });
    expect(detail.title).toBe('kot');
    expect(detail.fields.map((f) => f.name)).toEqual(['Entry', 'Meaning', 'Notes']);
    expect(detail.fields[0].value).toBe('kot');
  });

  it('lists the cards the note still makes, each with its type and where it stands', () => {
    const reverse: Card = { ...first, id: `${first.noteId}:reverse`, kind: 'reverse', suspended: true };
    const gone: Card = { ...first, id: `${first.noteId}:audio`, kind: 'audio', retired: true };
    const detail = noteDetail(note, [first, reverse, gone], undefined, { now: NOW, dayStartsAtHour: H, formatDay: day });
    expect(detail.cards).toEqual([
      { id: first.id, type: 'Forward', state: 'New' },
      { id: reverse.id, type: 'Reverse', state: 'Suspended' },
    ]);
  });
});
