import { describe, expect, it } from 'vitest';
import { GERMAN_COUNTING as de } from '../../../src/tools/german/counting';

const find = (meaning: string) => de.nouns.findIndex((n) => n.meaning === meaning);
const said = (meaning: string, n: number) => de.say(find(meaning), n).everyday.text;

describe('counting things in German', () => {
  it('uses the plural past one, and ein or eine for one', () => {
    expect([said('dog', 3), said('book', 2), said('apple', 4), said('car', 21)]).toEqual(['drei Hunde', 'zwei Bücher', 'vier Äpfel', 'einundzwanzig Autos']);
    expect([said('dog', 1), said('cat', 1), said('book', 1)]).toEqual(['ein Hund', 'eine Katze', 'ein Buch']);
  });

  it('offers wrong plurals and the wrong ein, and gives the plural after a miss', () => {
    expect(de.wrong(find('dog'), 3).map((p) => p.text)).toContain('drei Hunden');
    expect(de.wrong(find('cat'), 1).map((p) => p.text)).toContain('ein Katze');
    expect(de.rule(find('book'), 2)).toBe('das Buch, plural die Bücher.');
  });
});
