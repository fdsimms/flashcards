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
