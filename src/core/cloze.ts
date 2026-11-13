/**
 * Cloze deletions, as Anki reads them (rslib cloze.rs, at the sync server's ANKI_VERSION,
 * 26.09.4): `{{c1::text}}`, `{{c1::text::hint}}`, one cloze on several cards (`{{c1,2::text}}`),
 * and clozes inside clozes (`{{c1::Paris {{c2::France}}}}`, since Anki 2.1.56). Outputs are
 * checked against Anki's own (tests/fixtures/anki/template-vectors.json, from
 * make-template-vectors.py).
 *
 * The {{cloze:}} filter also strips the HTML between MathJax's delimiters, and renders an image
 * occlusion cloze ("image-occlusion:rect:left=...") as an empty div of data attributes, which the
 * page's script draws over the image (imageOcclusion.ts).
 */

export interface Cloze {
  /** The cloze numbers as written, deduplicated and sorted ({{c2,1::}} is [1, 2]). */
  ordinals: number[];
  nodes: ClozeNode[];
  hint?: string;
}
export type ClozeNode = string | Cloze;

type Token = { open: number[] } | { text: string } | 'close';

/** `{{c<numbers>::` at `i`: the numbers and where the cloze's text starts. */
function openAt(text: string, i: number): { ordinals: number[]; end: number } | undefined {
  if (!text.startsWith('{{c', i)) return undefined;
  let j = i + 3;
  while (j < text.length && /[0-9,]/.test(text[j])) j++;
  // As Rust's u16 parse: an empty part or one past 65535 is dropped.
  const ordinals = [...new Set(text.slice(i + 3, j).split(',').filter((s) => s !== '' && Number(s) <= 65535).map(Number))].sort((a, b) => a - b);
  if (!ordinals.length || !text.startsWith('::', j)) return undefined;
  return { ordinals, end: j + 2 };
}

function* tokenize(text: string): Generator<Token> {
  let i = 0;
  while (i < text.length) {
    const open = openAt(text, i);
    if (open) { yield { open: open.ordinals }; i = open.end; continue; }
    if (text.startsWith('}}', i)) { yield 'close'; i += 2; continue; }
    let k = i + 1;
    while (k < text.length && !text.startsWith('}}', k) && !openAt(text, k)) k++;
    yield { text: text.slice(i, k) };
    i = k;
  }
}

/**
 * parse_text_with_clozes: text and clozes, nested. A "::" in a cloze's text starts its hint (the
 * last one wins); a "}}" outside any cloze is text; a cloze never closed is dropped, text and
 * all; past ten open clozes, a further opening is ignored, though its "}}" still closes one.
 */
export function parseClozes(text: string): ClozeNode[] {
  const open: Cloze[] = [];
  const out: ClozeNode[] = [];
  for (const token of tokenize(text)) {
    if (token === 'close') {
      const cloze = open.pop();
      if (cloze) (open.length ? open[open.length - 1].nodes : out).push(cloze);
      else out.push('}}');
    } else if ('open' in token) {
      if (open.length < 10) open.push({ ordinals: token.open, nodes: [] });
    } else {
      const cloze = open[open.length - 1];
      if (!cloze) { out.push(token.text); continue; }
      let t = token.text;
      if (!t.startsWith('image-occlusion:')) {
        const at = t.indexOf('::');
        if (at >= 0) { cloze.hint = t.slice(at + 2); t = t.slice(0, at); }
      }
      cloze.nodes.push(t);
    }
  }
  return out;
}

/** A cloze's text with every cloze inside it filled in. */
function clozedText(cloze: Cloze): string {
  return cloze.nodes.map((n) => (typeof n === 'string' ? n : clozedText(n))).join('');
}

const ATTR_ENTITIES: Record<string, string> = { '"': '&quot;', '&': '&amp;', "'": '&#x27;', '<': '&lt;', '>': '&gt;' };

/** htmlescape's encode_attribute: the minimal entities, then every other non-alphanumeric code point below 256 as &#xHH;. */
export function encodeAttribute(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ATTR_ENTITIES[ch]) out += ATTR_ENTITIES[ch];
    else if (cp < 256 && (cp > 127 || !/[0-9A-Za-z]/.test(ch))) out += `&#x${cp.toString(16).toUpperCase().padStart(2, '0')};`;
    else out += ch;
  }
  return out;
}

function revealCloze(cloze: Cloze, ord: number, question: boolean, found: { active: boolean }): string {
  const active = cloze.ordinals.includes(ord);
  found.active ||= active;
  const ords = cloze.ordinals.join(',');
  const occlusion = imageOcclusionText(cloze);
  if (occlusion !== undefined) {
    // render_image_occlusion: shown on the question (and always, for cloze 0's labels), outlined on the answer.
    const cls = (question && active) || cloze.ordinals.includes(0) ? 'cloze' : active ? 'cloze-highlight' : 'cloze-inactive';
    return `<div class="${cls}" data-ordinal="${ords}" ${imageClozeData(occlusion)}></div>`;
  }
  const inner = () => cloze.nodes.map((n) => (typeof n === 'string' ? n : revealCloze(n, ord, question, found))).join('');
  if (question && active) {
    return `<span class="cloze" data-cloze="${encodeAttribute(inner())}" data-ordinal="${ords}">[${cloze.hint ?? '...'}]</span>`;
  }
  return `<span class="${active ? 'cloze' : 'cloze-inactive'}" data-ordinal="${ords}">${inner()}</span>`;
}

/**
 * The {{cloze:}} filter (cloze_filter, reveal_cloze_text): card `ord`'s cloze hidden behind its
 * hint on the question and shown on the answer, the others shown, at any depth, then the HTML
 * inside MathJax stripped. Empty when the text has no cloze `ord`.
 */
export function renderCloze(text: string, ord: number, side: 'front' | 'back'): string {
  const found = { active: false };
  const out = parseClozes(text).map((n) => (typeof n === 'string' ? n : revealCloze(n, ord, side === 'front', found))).join('');
  return found.active ? stripHtmlInsideMathjax(out) : '';
}

// rslib's MATHJAX: \( or \[ up to the first \) or \] (either closes either), across lines.
const MATHJAX = /(\\[([])([\s\S]*?)(\\[\])])/g;
// rslib text.rs HTML: comments, style and script elements whole, then any tag.
const HTML_TAG = /(<!--[\s\S]*?-->)|(<style[\s\S]*?>[\s\S]*?<\/style>)|(<script[\s\S]*?>[\s\S]*?<\/script>)|(<[\s\S]*?>)/gi;

/**
 * strip_html_inside_mathjax: HTML can't go inside MathJax, so the cloze filter takes the tags out
 * of everything between its delimiters (its own spans, a hint's tags), keeping entities.
 */
function stripHtmlInsideMathjax(text: string): string {
  return text.replace(MATHJAX, (_, open: string, inner: string, close: string) => open + inner.replace(HTML_TAG, '') + close);
}

/** The text after "image-occlusion:" when the cloze starts with it (ExtractedCloze::image_occlusion). */
function imageOcclusionText(cloze: Cloze): string | undefined {
  const first = cloze.nodes[0];
  return typeof first === 'string' && first.startsWith('image-occlusion:') ? first.slice('image-occlusion:'.length) : undefined;
}

/** One image occlusion shape as written in the note: "rect:left=.2:top=.3" is rect, [[left, .2], [top, .3]]. */
interface ImageCloze {
  shape: string;
  properties: [name: string, value: string][];
}

/**
 * parse_image_cloze (rslib image_occlusion/imageocclusion.rs, a nom parser): the shape up to the
 * first ":", then ":name=value" pairs, where a name is anything up to "=" and a value may escape
 * ":" and "\\" with a backslash. The first pair that doesn't parse ends the list (an empty value
 * followed by ":", a bad escape, a trailing backslash). Undefined with no ":" at all.
 */
function parseImageCloze(text: string): ImageCloze | undefined {
  const colon = text.indexOf(':');
  if (colon < 0) return undefined;
  const properties: [string, string][] = [];
  let i = colon;
  while (text[i] === ':') {
    const eq = text.indexOf('=', i + 1);
    if (eq <= i + 1) break; // no "=", or an empty name
    const value = escapedValue(text, eq + 1);
    if (!value) break;
    properties.push([text.slice(i + 1, eq), value.text]);
    i = value.end;
  }
  return { shape: text.slice(0, colon), properties };
}

/** nom's escaped_transform(is_not("\\:"), '\\', one_of("\\:")) from `start`: the value and where it ends. */
function escapedValue(text: string, start: number): { text: string; end: number } | undefined {
  let out = '';
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      const next = text[i + 1];
      if (next !== '\\' && next !== ':') return undefined;
      out += next;
      i += 2;
    } else if (c === ':') {
      if (i === start) return undefined; // an empty value is an error unless it ends the text
      break;
    } else {
      let j = i;
      while (j < text.length && text[j] !== '\\' && text[j] !== ':') j++;
      out += text.slice(i, j);
      i = j;
    }
  }
  return { text: out, end: i };
}

const IO_SHAPES = ['rect', 'ellipse', 'polygon', 'text'];

/**
 * get_image_cloze_data: a shape's data attributes, each followed by a space. Only the properties
 * Anki knows, an empty one (or a zero size) left out; values go in as written but for the text,
 * which is attribute-encoded.
 */
function imageClozeData(text: string): string {
  const parsed = parseImageCloze(text);
  if (!parsed) return '';
  let out = IO_SHAPES.includes(parsed.shape) ? `data-shape="${parsed.shape}" ` : '';
  for (const [name, value] of parsed.properties) {
    switch (name) {
      case 'left': case 'top': case 'angle': case 'fill':
        if (value) out += `data-${name}="${value}" `;
        break;
      case 'width': case 'height': case 'rx': case 'ry': case 'scale':
        if (value && value !== '0') out += `data-${name}="${value}" `;
        break;
      case 'points': {
        const points = value.split(' ').filter((p) => p.includes(',')).join(' ');
        if (points) out += `data-points="${points}" `;
        break;
      }
      case 'oi':
        if (value) out += `data-occludeInactive="${value}" `;
        break;
      case 'text':
        if (value) out += `data-text="${encodeAttribute(value)}" `;
        break;
      case 'fs':
        if (value) out += `data-font-size="${value}" `;
        break;
    }
  }
  return out;
}

/** reveal_cloze_text_in_nodes: each cloze `ord`'s hint (question) or text (answer), outer before inner. */
function clozeTexts(nodes: ClozeNode[], ord: number, question: boolean, out: string[] = []): string[] {
  for (const n of nodes) {
    if (typeof n === 'string') continue;
    if (n.ordinals.includes(ord)) out.push(question ? n.hint ?? '...' : clozedText(n));
    clozeTexts(n.nodes, ord, question, out);
  }
  return out;
}

/**
 * The cloze-only filter (reveal_cloze_text_only): just the card's clozes, for reading aloud: the
 * hint (or "...") on the question, the text on the answer, several joined with ", ".
 */
export function clozeOnly(text: string, ord: number, side: 'front' | 'back'): string {
  return clozeTexts(parseClozes(text), ord, side === 'front').join(', ');
}

/**
 * The text a {{type:cloze:Field}} card expects (extract_cloze_for_typing): its cloze's answers,
 * joined with ", ", or once when they're all the same; empty when the note has none.
 */
export function clozeForTyping(text: string, clozeNumber: number): string {
  const found = clozeTexts(parseClozes(text), clozeNumber, false);
  if (!found.length) return '';
  return found.every((x) => x === found[0]) ? found[0] : found.join(', ');
}

/** The cloze numbers a text uses, at any depth, 0 left out ("{{c1::...}} {{c3::...}}" -> [1, 3]). */
export function clozeNumbers(text: string): number[] {
  const set = new Set<number>();
  const walk = (nodes: ClozeNode[]) => {
    for (const n of nodes) {
      if (typeof n === 'string') continue;
      for (const o of n.ordinals) if (o !== 0) set.add(o);
      walk(n.nodes);
    }
  };
  walk(parseClozes(text));
  return [...set].sort((a, b) => a - b);
}
