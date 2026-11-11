import { describe, expect, it } from 'vitest';
import { ANSWER_BUTTON_CHOICES, parseAnswerButtons, ratingsShown } from '../../src/core/answerButtons';

describe('answer buttons', () => {
  it('shows the ratings each choice names, Again always', () => {
    expect(ratingsShown('all')).toEqual([1, 2, 3, 4]);
    expect(ratingsShown('againGoodEasy')).toEqual([1, 3, 4]);
    expect(ratingsShown('againGood')).toEqual([1, 3]);
    for (const c of ANSWER_BUTTON_CHOICES) expect(ratingsShown(c.value)[0]).toBe(1);
  });

  it('reads a missing or unknown setting as all four', () => {
    expect(parseAnswerButtons(null)).toBe('all');
    expect(parseAnswerButtons('three')).toBe('all');
    expect(parseAnswerButtons('againGood')).toBe('againGood');
  });
});
