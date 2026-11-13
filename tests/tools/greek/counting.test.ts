import { describe, expect, it } from 'vitest';
import { GREEK_COUNTING as el } from '../../../src/tools/greek/counting';

const find = (meaning: string) => el.nouns.findIndex((n) => n.meaning === meaning);
const said = (meaning: string, n: number) => el.say(find(meaning), n).everyday.text;

describe('counting things in Greek', () => {
  it('makes one, three and four agree with the noun, in the plural past one', () => {
    expect([said('coffee', 1), said('cat', 1), said('book', 1)]).toEqual(['ένας καφές', 'μία γάτα', 'ένα βιβλίο']);
    expect([said('cat', 3), said('book', 3), said('coffee', 4), said('house', 4)]).toEqual(['τρεις γάτες', 'τρία βιβλία', 'τέσσερις καφέδες', 'τέσσερα σπίτια']);
    expect([said('coffee', 21), said('cat', 13), said('book', 100)]).toEqual(['είκοσι ένας καφέδες', 'δεκατρείς γάτες', 'εκατό βιβλία']);
  });

  it('shows the noun with its article, and explains agreement after a miss', () => {
    expect(el.nouns[find('cat')].cue.text).toBe('η γάτα');
    expect(el.rule(find('book'), 3)).toContain('τρία βιβλία');
    expect(el.rule(find('book'), 5)).toBe('The plural of βιβλίο is βιβλία.');
  });
});
