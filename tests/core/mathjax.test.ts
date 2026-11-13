import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderCloze } from '../../src/core/cloze';
import { MATHJAX_CONFIG, MATHJAX_VERSION, mathjaxScripts, needsMathJax, pageUsesMathJax } from '../../src/core/mathjax';
import { cardDocument } from '../../src/core/template';

const SRC = 'file:///docs/mathjax-3.2.2/tex-svg-full.js';
const opts = { css: '', ord: 0, dark: false, autoplay: false, mathjax: SRC };

describe('needsMathJax', () => {
  it('finds inline and display math, across lines, as Anki’s reviewer does', () => {
    expect(needsMathJax('Area: \\(\\pi r^2\\)')).toBe(true);
    expect(needsMathJax('\\[\n\\sum_{i=1}^n i\n\\]')).toBe(true);
  });
  it('ignores dollar signs, which Anki doesn’t treat as math, and a delimiter never closed', () => {
    expect(needsMathJax('It costs $5 and $6')).toBe(false);
    expect(needsMathJax('$$x^2$$')).toBe(false);
    expect(needsMathJax('a \\( b')).toBe(false);
    expect(needsMathJax('plain text')).toBe(false);
  });
  it('finds math with a cloze in it, hidden or shown', () => {
    expect(renderCloze('\\(x = {{c1::5}}\\)', 1, 'front')).toBe('\\(x = [...]\\)');
    expect(renderCloze('\\(x = {{c1::5}}\\)', 1, 'back')).toBe('\\(x = 5\\)');
    expect(needsMathJax(renderCloze('\\(x = {{c1::5}}\\)', 1, 'front'))).toBe(true);
    expect(needsMathJax(renderCloze('\\(x = {{c1::5}}\\)', 1, 'back'))).toBe(true);
  });
});

describe('MATHJAX_CONFIG', () => {
  it('is Anki 26.09.4’s: display math in \\[ \\], no escapes, environments or refs, noerrors and mathtools, no textmacros', () => {
    expect(MATHJAX_CONFIG.tex).toEqual({
      displayMath: [['\\[', '\\]']],
      processEscapes: false,
      processEnvironments: false,
      processRefs: false,
      packages: { '[+]': ['noerrors', 'mathtools'], '[-]': ['textmacros'] },
    });
    expect(MATHJAX_CONFIG.startup.typeset).toBe(false);
  });
  it('matches the bundled script’s version', () => {
    const script = readFileSync(new URL('../../assets/mathjax/tex-svg-full.txt', import.meta.url), 'utf8');
    expect(script).toContain(`VERSION="${MATHJAX_VERSION}"`);
  });
});

describe('cardDocument with math', () => {
  it('loads MathJax only on a side with math, and hides the card until it is typeset', () => {
    const page = cardDocument('\\(e^{i\\pi} + 1 = 0\\)', opts);
    expect(pageUsesMathJax(page)).toBe(true);
    expect(page).toContain(`src="${SRC}"`);
    expect(page).toContain('<div id="qa" style="width:100%;opacity:0">');
    expect(page).toContain('MathJax.typesetPromise([qa])');
    expect(page.indexOf('window.MathJax = ')).toBeLessThan(page.indexOf(`src="${SRC}"`));

    const plain = cardDocument('No math, just $5', opts);
    expect(pageUsesMathJax(plain)).toBe(false);
    expect(plain).not.toContain('MathJax');
    expect(plain).toContain('<div id="qa" style="width:100%">');
  });
  it('leaves math as written when no script is given', () => {
    const page = cardDocument('\\(x\\)', { ...opts, mathjax: undefined });
    expect(pageUsesMathJax(page)).toBe(false);
    expect(page).toContain('\\(x\\)');
  });
  it('escapes the script’s URI', () => {
    expect(mathjaxScripts('file:///a"b&c.js')).toContain('src="file:///a&quot;b&amp;c.js"');
  });
});
