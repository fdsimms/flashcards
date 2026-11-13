import { describe, expect, it } from 'vitest';
import { compareAnswer, decodeEntities, opcodes, stripExpected } from '../../src/core/typeAnswer';
import vectors from '../fixtures/anki/typeanswer-vectors.json';

/** Outputs recorded from the real `anki` 26.09.4 package (tests/fixtures/anki/make-typeanswer-vectors.py). */
describe("comparing a typed answer as Anki does", () => {
  it.each(vectors.compare)('$expected / $typed (combining $combining)', ({ expected, typed, combining, html }) => {
    expect(compareAnswer(expected, typed, combining)).toBe(html);
  });

  it("matches Python difflib's opcodes", () => {
    // difflib.SequenceMatcher(None, 'qabxcd', 'abycdf').get_opcodes()
    expect(opcodes([...'qabxcd'], [...'abycdf'])).toEqual([
      ['delete', 0, 1, 0, 0], ['equal', 1, 3, 0, 2], ['replace', 3, 4, 2, 3], ['equal', 4, 6, 3, 5], ['insert', 6, 6, 5, 6],
    ]);
    expect(opcodes([], [])).toEqual([]);
  });

  it('strips what Anki strips and decodes entities, or leaves them all when one is invalid', () => {
    expect(stripExpected('<div>a</div><div>b</div>')).toBe('a b');
    expect(decodeEntities('&amp;&#233;&#x41;&nbsp;')).toBe('&éA ');
    expect(decodeEntities('a & b &amp;')).toBe('a & b &amp;');
  });
});
