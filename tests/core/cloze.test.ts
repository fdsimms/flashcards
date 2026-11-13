import { describe, expect, it } from 'vitest';
import { clozeForTyping, clozeNumbers, clozeOnly, encodeAttribute, renderCloze } from '../../src/core/cloze';
import vectors from '../fixtures/anki/template-vectors.json';
import typeAnswerVectors from '../fixtures/anki/typeanswer-vectors.json';

/** Outputs recorded from the real `anki` 26.09.4 package (tests/fixtures/anki/make-template-vectors.py). */
describe('clozes as Anki reads them', () => {
  it.each(vectors.cloze)('$text', ({ text, cards, typing }) => {
    for (const [ord, card] of Object.entries(cards)) {
      if ('empty' in card) continue; // the card Anki adds to a note with no cloze, to show an error on
      const n = Number(ord) + 1;
      expect(renderCloze(text, n, 'front')).toBe(card.front);
      expect(renderCloze(text, n, 'back')).toBe(card.back);
      expect(clozeOnly(text, n, 'front')).toBe(card.frontOnly);
      expect(clozeOnly(text, n, 'back')).toBe(card.backOnly);
    }
    for (const [n, expected] of Object.entries(typing)) expect(clozeForTyping(text, Number(n))).toBe(expected);
  });

  it("extracts a cloze's text for typing as Anki does", () => {
    for (const v of typeAnswerVectors.cloze) expect(clozeForTyping(v.text, v.ord)).toBe(v.expected);
  });

  it('nests: the outer cloze hides everything inside it, an inner one hides only itself', () => {
    const text = '{{c1::Paris {{c2::France}}}}';
    expect(clozeNumbers(text)).toEqual([1, 2]);
    expect(renderCloze(text, 1, 'front')).toMatch(/^<span class="cloze" data-cloze="[^"]*" data-ordinal="1">\[\.\.\.\]<\/span>$/);
    expect(renderCloze(text, 2, 'front')).toBe('<span class="cloze-inactive" data-ordinal="1">Paris <span class="cloze" data-cloze="France" data-ordinal="2">[...]</span></span>');
    expect(clozeForTyping(text, 1)).toBe('Paris France');
  });

  it('counts cloze numbers at any depth, leaving out 0 and an unclosed cloze', () => {
    expect(clozeNumbers('{{c2::te{{c1::s}}}}t{{')).toEqual([1, 2]);
    expect(clozeNumbers('{{c0::te}}s{{c2::t}}s')).toEqual([2]);
    expect(clozeNumbers('{{c1,3::both}}')).toEqual([1, 3]);
    expect(clozeNumbers('{{c1::unclosed {{c2::two}}')).toEqual([]);
  });

  it("encodes an attribute as htmlescape's encode_attribute does", () => {
    expect(encodeAttribute(`a b&<>"'/é\nŁ`)).toBe('a&#x20;b&amp;&lt;&gt;&quot;&#x27;&#x2F;&#xE9;&#x0A;Ł');
  });
});
