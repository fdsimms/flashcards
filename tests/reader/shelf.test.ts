import { describe, expect, it } from 'vitest';
import type { ShelfText } from '../../src/reader/api';
import { cardDetail, minutesFor, nextInOrder, playMinutes, playOrder, reasonLabel, stepLength } from '../../src/reader/shelf';

const text = (over: Partial<ShelfText> = {}): ShelfText => ({
  id: 1, title: 'At the stall', topic: 'Food stall', topic_id: 1, liked: false, form: 'dialogue', lines: 8,
  stretch: [], reason: 'new', coverage: 0.95, episode: 0, ...over,
});

describe('the shelf', () => {
  it('says how long a text takes, never under a minute', () => {
    expect(minutesFor(6)).toBe(2);
    expect(minutesFor(12)).toBe(4);
    expect(minutesFor(1)).toBe(1);
    expect(cardDetail(text({ form: 'story', lines: 12 }))).toBe('Story · 12 lines · 4 min');
  });

  it('says why each text is there', () => {
    expect(reasonLabel(text({ reason: 'due', stretch: ['ร่ม', 'ฝน'] }))).toBe('Uses 2 words due today');
    expect(reasonLabel(text({ reason: 'due', stretch: ['ร่ม'] }))).toBe('Uses 1 word due today');
    expect(reasonLabel(text({ reason: 'due' }))).toBe('Written around words due today');
    expect(reasonLabel(text({ reason: 'liked', topic: 'A scary tiger' }))).toBe('Because you liked "A scary tiger"');
    expect(reasonLabel(text({ reason: 'new' }))).toBe('Something new');
    expect(reasonLabel(text({ reason: 'asked' }))).toBe('You asked for this');
    expect(reasonLabel(text({ reason: 'story', episode: 7 }))).toBe('Episode 7');
    // A text written for a topic before the shelf.
    expect(reasonLabel(text({ reason: '', liked: true }))).toBe('Because you liked "Food stall"');
    expect(reasonLabel(text({ reason: '' }))).toBe('Food stall');
  });

  it('plays the story first, then the shelf in order', () => {
    const shelf = { story: null, texts: [text({ id: 3 }), text({ id: 5, lines: 12 })] };
    expect(playOrder(shelf)).toEqual([3, 5]);
    expect(playMinutes(shelf)).toBe(7);
    const withStory = { ...shelf, story: { id: 1, title: '', about: '', read: 0, last_recap: '', next: text({ id: 9 }), writing: false, failed: null } };
    expect(playOrder(withStory)).toEqual([9, 3, 5]);
    expect(nextInOrder([9, 3, 5], 3)).toBe(5);
    expect(nextInOrder([9, 3, 5], 5)).toBeNull();
    expect(nextInOrder([9, 3, 5], 4)).toBeNull();
  });

  it('steps the length and holds it at the ends', () => {
    expect(stepLength(8, 'shorter')).toBe(6);
    expect(stepLength(8, 'longer')).toBe(12);
    expect(stepLength(6, 'shorter')).toBe(6);
    expect(stepLength(12, 'longer')).toBe(12);
    expect(stepLength(8, 'same')).toBe(8);
  });
});
