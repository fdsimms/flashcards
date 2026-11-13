/**
 * MathJax on a card page, set up as Anki's reviewer sets it up (ts/mathjax/index.ts and
 * ts/reviewer/index.ts, at the sync server's ANKI_VERSION, 26.09.4): `\(...\)` inline and `\[...\]`
 * display (no `$`), escapes, environments and \ref not processed outside math, noerrors and
 * mathtools added, textmacros removed, and the card's `#qa` typeset once it's on the page. MathJax
 * loads only for a side whose HTML has math, as Anki loads it lazily.
 *
 * The one difference is the output: Anki uses MathJax 3.2.2's tex-chtml-full, which loads web fonts
 * from files beside it; Franki uses the same version's tex-svg-full, which draws with SVG paths
 * held in the script, so one file (assets/mathjax/, copied into the documents folder by
 * src/media/mathjax.ts) is all the page needs, with nothing fetched from the network.
 */

/** The bundled MathJax's version (Anki 26.09.4's yarn.lock resolves `mathjax@^3.1.2` to it). */
export const MATHJAX_VERSION = '3.2.2';
/** Where the script goes in the documents folder, which card pages can read: a folder per version. */
export const MATHJAX_DIR = `mathjax-${MATHJAX_VERSION}`;
export const MATHJAX_FILE = 'tex-svg-full.js';

/** window.MathJax before the script loads: Anki's configuration (ts/mathjax/index.ts) less its vendor path. */
export const MATHJAX_CONFIG = {
  tex: {
    // inlineMath is left at MathJax's default, [['\\(', '\\)']], as Anki leaves it.
    displayMath: [['\\[', '\\]']],
    processEscapes: false,
    processEnvironments: false,
    processRefs: false,
    packages: { '[+]': ['noerrors', 'mathtools'], '[-]': ['textmacros'] },
  },
  // Anki's loader.load (`[tex]/noerrors`, `[tex]/mathtools`) is left out: the full build already
  // holds every TeX package, so it loads nothing and only logs "No version information" for each.
  startup: { typeset: false },
};

// ts/reviewer/index.ts mathjaxRegex: a complete \[...\] or \(...\), across lines.
const MATH = /\\\[(.*?)\\\]|\\\((.*?)\\\)/su;

/** Whether a card side's HTML has math, Anki's test for loading MathJax (`_containsMathjax`). */
export function needsMathJax(html: string): boolean {
  return MATH.test(html);
}

const MARKER = 'data-mathjax';

/**
 * The page's MathJax: the configuration, the script from `src`, and the typeset of `#qa` (hidden
 * until then, as Anki's reviewer hides it, so raw TeX doesn't flash). When the script didn't load,
 * the card is shown as it is.
 */
export function mathjaxScripts(src: string): string {
  return `<script>window.MathJax = ${JSON.stringify(MATHJAX_CONFIG)};</script>
<script ${MARKER} src="${src.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></script>
<script>
(function () {
  var qa = document.getElementById('qa');
  function show() { qa.style.opacity = '1'; }
  var startup = window.MathJax && window.MathJax.startup;
  if (!startup || !startup.promise) return show();
  startup.promise
    .then(function () { return MathJax.typesetPromise([qa]); })
    .catch(function (e) { console.error(e); })
    .then(show);
})();
</script>`;
}

/** Whether a page from `cardDocument` loads MathJax, so the script has to be in place first. */
export function pageUsesMathJax(page: string): boolean {
  return page.includes(`<script ${MARKER} src=`);
}
