import { describe, expect, it } from 'vitest';
import { splitAtMeaning } from '../../src/tools/sentenceWord';

describe('where a word is in its English sentence', () => {
  it('splits around the meaning, keeping the case written', () => {
    expect(splitAtMeaning('The Cat is sleeping on the sofa.', 'cat')).toEqual(['The ', 'Cat', ' is sleeping on the sofa.']);
    expect(splitAtMeaning("I'm going to the market.", 'market')).toEqual(["I'm going to the ", 'market', '.']);
  });

  it('finds one of several senses', () => {
    expect(splitAtMeaning('She has no time today.', 'hour, time')).toEqual(['She has no ', 'time', ' today.']);
    expect(splitAtMeaning('A cat sat.', 'cat; tomcat')).toEqual(['A ', 'cat', ' sat.']);
  });

  it('matches a whole word only', () => {
    expect(splitAtMeaning('The category is new.', 'cat')).toBeNull();
    expect(splitAtMeaning('A scatter of leaves.', 'cat')).toBeNull();
  });

  it('is null when the meaning is not in the sentence', () => {
    expect(splitAtMeaning('He calls his mother.', 'to call')).toBeNull();
    expect(splitAtMeaning('Anything.', '')).toBeNull();
  });

  it('takes a meaning with punctuation literally', () => {
    expect(splitAtMeaning('What is (a) cat?', '(a) cat')).toEqual(['What is ', '(a) cat', '?']);
  });
});
