/**
 * Type the answer, as Anki does it (rslib typeanswer.rs and aqt's reviewer, at the sync server's
 * ANKI_VERSION, 26.09.4): a card template's {{type:Field}} asks for the field's text, and the back
 * shows what was typed against it, character by character. Outputs are checked against Anki's own
 * (tests/fixtures/anki/typeanswer-vectors.json, from make-typeanswer-vectors.py).
 */

// ==== difflib ====

export type Opcode = ['equal' | 'replace' | 'delete' | 'insert', number, number, number, number];

/**
 * Python difflib's SequenceMatcher(None, a, b, autojunk=False).get_opcodes(), as the Rust difflib
 * crate Anki uses computes it. Python's default autojunk (past 200 items) gives a different answer
 * from Anki's on a long sentence; the recorded vectors include one.
 */
export function opcodes(a: string[], b: string[]): Opcode[] {
  const b2j = new Map<string, number[]>();
  b.forEach((x, j) => { const l = b2j.get(x); if (l) l.push(j); else b2j.set(x, [j]); });
  const longest = (alo: number, ahi: number, blo: number, bhi: number): [number, number, number] => {
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>();
      for (const j of b2j.get(a[i]) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        next.set(j, k);
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = next;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) { besti--; bestj--; bestsize++; }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
    return [besti, bestj, bestsize];
  };
  const blocks: [number, number, number][] = [];
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const m = longest(alo, ahi, blo, bhi);
    const [i, j, k] = m;
    if (!k) continue;
    blocks.push(m);
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  const merged: [number, number, number][] = [];
  let [i1, j1, k1] = [0, 0, 0];
  for (const [i2, j2, k2] of blocks) {
    if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2;
    else { if (k1) merged.push([i1, j1, k1]); [i1, j1, k1] = [i2, j2, k2]; }
  }
  if (k1) merged.push([i1, j1, k1]);
  merged.push([a.length, b.length, 0]);
  const out: Opcode[] = [];
  let i = 0, j = 0;
  for (const [ai, bj, size] of merged) {
    const tag = i < ai && j < bj ? 'replace' : i < ai ? 'delete' : j < bj ? 'insert' : undefined;
    if (tag) out.push([tag, i, ai, j, bj]);
    i = ai + size; j = bj + size;
    if (size) out.push(['equal', ai, i, bj, j]);
  }
  return out;
}

// ==== Anki's text helpers ====

/** HTML 4's named entities, which Anki's decoder (the htmlescape crate) knows: name=hex code point. */
const ENTITIES = new Map(
  ('AElig=c6 Aacute=c1 Acirc=c2 Agrave=c0 Alpha=391 Aring=c5 Atilde=c3 Auml=c4 Beta=392 Ccedil=c7 ' +
  'Chi=3a7 Dagger=2021 Delta=394 ETH=d0 Eacute=c9 Ecirc=ca Egrave=c8 Epsilon=395 Eta=397 Euml=cb ' +
  'Gamma=393 Iacute=cd Icirc=ce Igrave=cc Iota=399 Iuml=cf Kappa=39a Lambda=39b Mu=39c Ntilde=d1 ' +
  'Nu=39d OElig=152 Oacute=d3 Ocirc=d4 Ograve=d2 Omega=3a9 Omicron=39f Oslash=d8 Otilde=d5 Ouml=d6 ' +
  'Phi=3a6 Pi=3a0 Prime=2033 Psi=3a8 Rho=3a1 Scaron=160 Sigma=3a3 THORN=de Tau=3a4 Theta=398 ' +
  'Uacute=da Ucirc=db Ugrave=d9 Upsilon=3a5 Uuml=dc Xi=39e Yacute=dd Yuml=178 Zeta=396 aacute=e1 ' +
  'acirc=e2 acute=b4 aelig=e6 agrave=e0 alefsym=2135 alpha=3b1 amp=26 and=2227 ang=2220 aring=e5 ' +
  'asymp=2248 atilde=e3 auml=e4 bdquo=201e beta=3b2 brvbar=a6 bull=2022 cap=2229 ccedil=e7 cedil=b8 ' +
  'cent=a2 chi=3c7 circ=2c6 clubs=2663 cong=2245 copy=a9 crarr=21b5 cup=222a curren=a4 dArr=21d3 ' +
  'dagger=2020 darr=2193 deg=b0 delta=3b4 diams=2666 divide=f7 eacute=e9 ecirc=ea egrave=e8 ' +
  'empty=2205 emsp=2003 ensp=2002 epsilon=3b5 equiv=2261 eta=3b7 eth=f0 euml=eb euro=20ac ' +
  'exist=2203 fnof=192 forall=2200 frac12=bd frac14=bc frac34=be frasl=2044 gamma=3b3 ge=2265 gt=3e ' +
  'hArr=21d4 harr=2194 hearts=2665 hellip=2026 iacute=ed icirc=ee iexcl=a1 igrave=ec image=2111 ' +
  'infin=221e int=222b iota=3b9 iquest=bf isin=2208 iuml=ef kappa=3ba lArr=21d0 lambda=3bb ' +
  'lang=2329 laquo=ab larr=2190 lceil=2308 ldquo=201c le=2264 lfloor=230a lowast=2217 loz=25ca ' +
  'lrm=200e lsaquo=2039 lsquo=2018 lt=3c macr=af mdash=2014 micro=b5 middot=b7 minus=2212 mu=3bc ' +
  'nabla=2207 nbsp=a0 ndash=2013 ne=2260 ni=220b not=ac notin=2209 nsub=2284 ntilde=f1 nu=3bd ' +
  'oacute=f3 ocirc=f4 oelig=153 ograve=f2 oline=203e omega=3c9 omicron=3bf oplus=2295 or=2228 ' +
  'ordf=aa ordm=ba oslash=f8 otilde=f5 otimes=2297 ouml=f6 para=b6 part=2202 permil=2030 perp=22a5 ' +
  'phi=3c6 pi=3c0 piv=3d6 plusmn=b1 pound=a3 prime=2032 prod=220f prop=221d psi=3c8 quot=22 ' +
  'rArr=21d2 radic=221a rang=232a raquo=bb rarr=2192 rceil=2309 rdquo=201d real=211c reg=ae ' +
  'rfloor=230b rho=3c1 rlm=200f rsaquo=203a rsquo=2019 sbquo=201a scaron=161 sdot=22c5 sect=a7 ' +
  'shy=ad sigma=3c3 sigmaf=3c2 sim=223c spades=2660 sub=2282 sube=2286 sum=2211 sup=2283 sup1=b9 ' +
  'sup2=b2 sup3=b3 supe=2287 szlig=df tau=3c4 there4=2234 theta=3b8 thetasym=3d1 thinsp=2009 ' +
  'thorn=fe tilde=2dc times=d7 trade=2122 uArr=21d1 uacute=fa uarr=2191 ucirc=fb ugrave=f9 uml=a8 ' +
  'upsih=3d2 upsilon=3c5 uuml=fc weierp=2118 xi=3be yacute=fd yen=a5 yuml=ff zeta=3b6 zwj=200d ' +
  'zwnj=200c')
    .trim().split(' ').map((e) => { const [k, v] = e.split('='); return [k, String.fromCodePoint(parseInt(v, 16))] as const; }),
);

/**
 * Anki's decode_entities: every entity decoded and a no-break space made a space, or, if any `&`
 * isn't a valid entity, the text exactly as it was (htmlescape refuses the whole string).
 */
export function decodeEntities(html: string): string {
  if (!html.includes('&')) return html;
  let out = '';
  let i = 0;
  for (;;) {
    const amp = html.indexOf('&', i);
    if (amp < 0) { out += html.slice(i); break; }
    out += html.slice(i, amp);
    const m = /^&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]*));/.exec(html.slice(amp));
    const cp = m ? (m[1] ? parseInt(m[1], 10) : m[2] ? parseInt(m[2], 16) : undefined) : undefined;
    const ch = !m ? undefined : cp !== undefined ? (cp <= 0x10ffff ? String.fromCodePoint(cp) : undefined) : ENTITIES.get(m[3]);
    if (ch === undefined) return html;
    out += ch;
    i = amp + m![0].length;
  }
  return out.replace(/ /g, ' ');
}

const HTML = /<!--.*?-->|<style.*?>.*?<\/style>|<script.*?>.*?<\/script>|<.*?>/gis;
const LINEBREAKS = /(?:\n|<br\s?\/?>|<\/?div>)+/gi;
const AV_TAGS = /\[sound:.+?\]|\[anki:tts[^\]]*\].*?\[\/anki:tts\]/gs;

/** The field as Anki compares it: sounds and tts out, line breaks as spaces, HTML stripped, trimmed. */
export function stripExpected(expected: string): string {
  return decodeEntities(expected.replace(AV_TAGS, '').replace(LINEBREAKS, ' ').replace(HTML, '')).trim();
}

/** htmlescape's encode_minimal. */
const encode = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[ch]!);
const isMark = (ch: string) => /^\p{M}/u.test(ch);
const chars = (s: string) => Array.from(s);

// ==== compareAnswer ====

type Kind = 'typeGood' | 'typeBad' | 'typeMissed';
const span = (kind: Kind, text: string) => `<span class=${kind}>${encode(text)}</span>`;
/** A token starting with a mark gets a no-break space before it, so it doesn't join the one before. */
const isolated = (text: string) => (isMark(text) ? ` ${text}` : text);

/**
 * What the back of a {{type:}} card shows: Anki's compare_answer. `combining` false is
 * {{type:nc:Field}}, which compares without accents and other combining marks, but still shows
 * them in the expected line.
 */
export function compareAnswer(expected: string, typed: string, combining: boolean): string {
  const stripped = stripExpected(expected);
  if (!typed) return `<code id=typeans>${encode(stripped)}</code>`;
  let t: string[], e: string[], original: string;
  let split: string[] | undefined;
  if (combining) {
    t = chars(typed.normalize('NFC'));
    e = chars(stripped.normalize('NFC'));
    original = e.join('');
  } else {
    t = chars(typed.normalize('NFKD')).filter((ch) => !isMark(ch));
    e = [];
    split = [];
    for (const ch of chars(stripped.normalize('NFKD'))) {
      if (isMark(ch)) { if (split.length) split[split.length - 1] += ch; }
      else { e.push(ch); split.push(ch); }
    }
    original = stripped;
  }
  if (t.length === e.length && t.every((ch, k) => ch === e[k])) return `<code id=typeans><span class=typeGood>${encode(original)}</span></code>`;
  let typedHtml = '';
  let expectedHtml = '';
  const expectedSpan = (kind: Kind, from: number, to: number) =>
    split ? span(kind, split.slice(from, to).join('')) : span(kind, isolated(e.slice(from, to).join('')));
  for (const [tag, a1, a2, b1, b2] of opcodes(t, e)) {
    const typedText = isolated(t.slice(a1, a2).join(''));
    if (tag === 'equal') { typedHtml += span('typeGood', typedText); expectedHtml += expectedSpan('typeGood', b1, b2); }
    else if (tag === 'delete') typedHtml += span('typeBad', typedText);
    else if (tag === 'insert') { typedHtml += span('typeMissed', '-'.repeat(b2 - b1)); expectedHtml += expectedSpan('typeMissed', b1, b2); }
    else { typedHtml += span('typeBad', typedText); expectedHtml += expectedSpan('typeMissed', b1, b2); }
  }
  return `<code id=typeans>${typedHtml}<br><span id=typearrow>&darr;</span><br>${expectedHtml}</code>`;
}

// ==== Clozes ====

const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

/**
 * The text a {{type:cloze:Field}} card expects (Anki's extract_cloze_for_typing): its cloze's
 * answers, joined with ", ", or once when they're all the same; empty when the note has none.
 */
export function clozeForTyping(text: string, clozeNumber: number): string {
  const found = [...text.matchAll(CLOZE)].filter((m) => Number(m[1]) === clozeNumber).map((m) => m[2]);
  if (!found.length) return '';
  return found.every((x) => x === found[0]) ? found[0] : found.join(', ');
}
