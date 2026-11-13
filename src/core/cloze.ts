/**
 * Cloze deletions, as Anki reads them (rslib cloze.rs, at the sync server's ANKI_VERSION,
 * 26.09.4): `{{c1::text}}`, `{{c1::text::hint}}`, one cloze on several cards (`{{c1,2::text}}`),
 * and clozes inside clozes (`{{c1::Paris {{c2::France}}}}`, since Anki 2.1.56). Outputs are
 * checked against Anki's own (tests/fixtures/anki/template-vectors.json, from
 * make-template-vectors.py).
 *
 * Not covered: image occlusion's shapes (a cloze starting "image-occlusion:" renders as text), and
 * the cloze filter's stripping of HTML inside MathJax.
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
  const inner = () => cloze.nodes.map((n) => (typeof n === 'string' ? n : revealCloze(n, ord, question, found))).join('');
  if (question && active) {
    return `<span class="cloze" data-cloze="${encodeAttribute(inner())}" data-ordinal="${ords}">[${cloze.hint ?? '...'}]</span>`;
  }
  return `<span class="${active ? 'cloze' : 'cloze-inactive'}" data-ordinal="${ords}">${inner()}</span>`;
}

/**
 * The {{cloze:}} filter (reveal_cloze_text): card `ord`'s cloze hidden behind its hint on the
 * question and shown on the answer, the others shown, at any depth. Empty when the text has no
 * cloze `ord`.
 */
export function renderCloze(text: string, ord: number, side: 'front' | 'back'): string {
  const found = { active: false };
  const out = parseClozes(text).map((n) => (typeof n === 'string' ? n : revealCloze(n, ord, side === 'front', found))).join('');
  return found.active ? out : '';
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
