import { describe, expect, it } from 'vitest';
import { NORWEGIAN_COUNTING as nb } from '../../../src/tools/norwegian/counting';

const find = (meaning: string) => nb.nouns.findIndex((n) => n.meaning === meaning);
const said = (meaning: string, n: number) => nb.say(find(meaning), n).everyday.text;

describe('counting things in Norwegian', () => {
  it('uses the indefinite plural past one, and én or ett for one', () => {
    expect([said('dog', 3), said('book', 2), said('man', 2), said('house', 3), said('child', 21)]).toEqual(['tre hunder', 'to bøker', 'to menn', 'tre hus', 'tjueen barn']);
    expect([said('dog', 1), said('house', 1)]).toEqual(['én hund', 'ett hus']);
  });

  it('says when a noun stays the same in the plural', () => {
    expect(nb.rule(find('house'), 3)).toBe('et hus stays the same in the plural: tre hus.');
    expect(nb.rule(find('book'), 3)).toBe('en bok, plural bøker.');
  });
});
