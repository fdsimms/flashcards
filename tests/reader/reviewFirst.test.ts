import { describe, expect, it } from 'vitest';
import { reviewFirst } from '../../src/reader/reviewFirst';

const rows = [
  { deck: '👅 Languages::🇹🇭 Thai', due: 12 },
  { deck: '👅 Languages::🇵🇱 Polski', due: 1 },
  { deck: '👅 Languages::🇩🇪 Deutsch', due: 0 },
];

describe('the shelf’s suggestion to review first', () => {
  it("says how many of the language's deck's reviews are due, and which deck to open", () => {
    expect(reviewFirst('👅 Languages::🇹🇭 Thai', 'Thai', rows)).toEqual({
      deck: '👅 Languages::🇹🇭 Thai',
      due: 12,
      message: '12 Thai reviews due',
      hint: 'Review them first, and new texts can use those words.',
    });
  });

  it('speaks of one review in the singular', () => {
    expect(reviewFirst('👅 Languages::🇵🇱 Polski', 'Polish', rows)).toMatchObject({ message: '1 Polish review due', hint: 'Review it first, and new texts can use that word.' });
  });

  it('shows nothing with no reviews due, an unknown deck, or no deck yet', () => {
    expect(reviewFirst('👅 Languages::🇩🇪 Deutsch', 'German', rows)).toBeUndefined();
    expect(reviewFirst('Gone', 'Thai', rows)).toBeUndefined();
    expect(reviewFirst(undefined, 'Thai', rows)).toBeUndefined();
  });
});
