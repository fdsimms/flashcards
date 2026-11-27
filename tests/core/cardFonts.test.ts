import { describe, expect, it } from 'vitest';
import { cardFontCss, pageFont } from '../../src/core/cardFonts';
import { cardDocument } from '../../src/core/template';

const BASE = 'file:///docs/card-fonts-1/';

describe('cardFontCss', () => {
  it('declares each weight and sets the card body in it, with the system font as the fallback', () => {
    const css = cardFontCss('nunito', BASE);
    expect(css).toContain('font-weight: 400; src: url("file:///docs/card-fonts-1/Nunito_400Regular.ttf")');
    expect(css).toContain('Nunito_600SemiBold.ttf');
    expect(css).toContain('Nunito_700Bold.ttf');
    expect(css).toContain('body.card { font-family: "Franki Nunito", -apple-system');
  });
  it('writes nothing for the system font', () => {
    expect(cardFontCss('system', BASE)).toBe('');
  });
});

describe('pageFont', () => {
  it('reads back the font a page was built with', () => {
    expect(pageFont(`<style>${cardFontCss('lora', BASE)}</style>`)).toBe('lora');
    expect(pageFont('<style>body {}</style>')).toBeUndefined();
    expect(pageFont('/*card-font:comicsans*/')).toBeUndefined();
  });
});

describe('cardDocument with a font', () => {
  const opts = { css: '.card { font-family: arial; }', ord: 0, dark: false, autoplay: false };
  it('puts the font rule after the deck CSS, so it outranks the deck plain .card', () => {
    const html = cardDocument('<div>увидеть</div>', { ...opts, font: { id: 'inter', base: BASE } });
    expect(html.indexOf('.card { font-family: arial; }')).toBeLessThan(html.indexOf('body.card { font-family: "Franki Inter"'));
  });
  it('leaves the deck alone without a font or with the system font', () => {
    expect(cardDocument('<div>x</div>', opts)).not.toContain('card-font');
    expect(cardDocument('<div>x</div>', { ...opts, font: { id: 'system', base: BASE } })).not.toContain('card-font');
  });
});

describe('cardDocument at a text size', () => {
  const opts = { css: '.card { font-size: 18px; }', ord: 0, dark: false, autoplay: false };
  it('zooms the card content by the scale, after the deck CSS', () => {
    const html = cardDocument('<div>x</div>', { ...opts, scale: 1.2 });
    expect(html).toContain('#qa { zoom: 1.2; }');
    expect(html.indexOf('.card { font-size: 18px; }')).toBeLessThan(html.indexOf('#qa { zoom'));
  });
  it('adds nothing at the default size', () => {
    expect(cardDocument('<div>x</div>', { ...opts, scale: 1 })).not.toContain('zoom');
    expect(cardDocument('<div>x</div>', opts)).not.toContain('zoom');
  });
});

describe('cardDocument in Japanese', () => {
  const opts = { css: '', ord: 0, dark: false, autoplay: false };
  it("marks a side with kana as Japanese, with Japanese's face after the system font", () => {
    const html = cardDocument('<div>約束を破る</div>', opts);
    expect(html).toContain('<html lang="ja">');
    expect(html).toContain('font-family: -apple-system, system-ui, "Hiragino Sans", sans-serif;');
  });
  it('leaves kanji alone, which may be Chinese, and every other language', () => {
    for (const side of ['<div>学习</div>', '<div>увидеть</div>']) {
      const html = cardDocument(side, opts);
      expect(html).toContain('<html><head>');
      expect(html).not.toContain('Hiragino');
    }
  });
});
