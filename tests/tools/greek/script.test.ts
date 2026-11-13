import { describe, expect, it } from 'vitest';
import { GREEK_SCRIPT as el } from '../../../src/tools/greek/script';

const find = (shown: string) => el.words.findIndex((w) => w.shown === shown);

describe('reading Greek aloud', () => {
  it('romanizes the answer as it sounds', () => {
    expect(el.words[find('μπίρα')].answer).toEqual({ text: 'μπίρα', roman: 'bíra' });
  });

  it('explains the letters that don’t read as they look, most surprising first', () => {
    expect(el.rule(find('μπίρα'))).toBe('μπ sounds like b (mb inside a word).');
    expect(el.rule(find('ήλιος'))).toBe('η and υ both sound like i.');
    expect(el.rule(find('ουρανός'))).toBe('ου sounds like the u in "too".');
    expect(el.rule(find('ευχαριστώ'))).toContain('αυ and ευ');
    expect(el.patterns(find('ντομάτα'))).toEqual(['letters:nt']);
    expect(el.rule(find('νερό'))).toBeUndefined();
  });
});
