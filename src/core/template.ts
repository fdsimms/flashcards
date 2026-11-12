import { ttsFilter, ttsTags, withoutTts, TTS_NO_LANGUAGE, type TtsTag } from './tts';
import { clozeForTyping, compareAnswer } from './typeAnswer';
import type { Note, NoteType } from './types';

/**
 * Anki card templates, rendered the way Anki does, for every note type except Omnilanguage (which
 * has its own native renderer with TTS, `renderCard` in cards.ts). The output is HTML for a
 * WebView; `cardDocument` wraps it with the note type's CSS.
 *
 * Covered: {{Field}}, {{#Field}}...{{/Field}}, {{^Field}}...{{/Field}}, the special fields
 * (FrontSide, Tags, Type, Deck, Subdeck, Card), and the filters text, hint, cloze, cloze-only,
 * furigana, kana, kanji and tts (read aloud, src/core/tts.ts). An unknown filter passes the value through, as
 * Anki does for add-on filters it can't run. {{type:Field}} (and type:cloze:, type:nc:) asks for
 * the answer to be typed, as Anki's reviewer does it: see `renderTemplateCard`.
 */

export interface RenderContext {
  note: Note;
  noteType: NoteType;
  /** The card's template ordinal (for a cloze note type, cloze number - 1). */
  ord: number;
  side: 'front' | 'back';
  /** The rendered front, for {{FrontSide}} on the back. */
  frontSide?: string;
}

/** Anki's rule for an empty field: only whitespace, <br> and <div> tags. An image is not empty. */
export function fieldIsEmpty(value: string | undefined): boolean {
  return !value || /^(?:\s|&nbsp;|<\/?(?:br|div)\s?\/?>)*$/i.test(value);
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');
}

const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

/** The cloze numbers a text uses ("{{c1::...}} {{c3::...}}" -> [1, 3]). */
export function clozeNumbers(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(CLOZE)) out.add(Number(m[1]));
  return [...out].sort((a, b) => a - b);
}

/**
 * Anki's cloze-only (reveal_cloze_text_only): just the card's cloze, for reading aloud: its hint
 * (or "...") on the question, its text on the answer, several joined with ", ".
 */
function clozeOnly(text: string, n: number, side: 'front' | 'back'): string {
  return [...text.matchAll(CLOZE)].filter((m) => Number(m[1]) === n).map((m) => (side === 'front' ? m[3] ?? '...' : m[2])).join(', ');
}

function renderCloze(text: string, n: number, side: 'front' | 'back'): string {
  return text.replace(CLOZE, (_, num: string, answer: string, hint?: string) => {
    if (Number(num) !== n) return `<span class="cloze-inactive">${answer}</span>`;
    if (side === 'back') return `<span class="cloze">${answer}</span>`;
    return `<span class="cloze">[${hint ?? '...'}]</span>`;
  });
}

/** "漢字[かんじ]" -> ruby; Anki's furigana filter. A leading space separates readings. */
function furigana(text: string, mode: 'furigana' | 'kana' | 'kanji'): string {
  return text.replace(/ ?([^ >]+?)\[(.+?)\]/g, (_, base: string, reading: string) => {
    if (mode === 'kana') return reading;
    if (mode === 'kanji') return base;
    return `<ruby><rb>${base}</rb><rt>${reading}</rt></ruby>`;
  });
}

function applyFilter(filter: string, value: string, fieldName: string, ctx: RenderContext): string {
  const name = filter.trim();
  if (name.startsWith('tts ')) return ttsFilter(name.slice(4), value);
  switch (name) {
    case 'text': return stripHtml(value);
    case 'cloze': return renderCloze(value, ctx.ord + 1, ctx.side);
    case 'cloze-only': return clozeOnly(value, ctx.ord + 1, ctx.side);
    case 'hint':
      if (fieldIsEmpty(value)) return '';
      return `<a class="hint" href="#" onclick="this.style.display='none';this.nextElementSibling.style.display='block';return false;">${fieldName}</a><div class="hint" style="display:none">${value}</div>`;
    case 'furigana':
    case 'kana':
    case 'kanji':
      return furigana(value, name);
    default:
      return value;
  }
}

function specialField(name: string, ctx: RenderContext): string | undefined {
  switch (name) {
    case 'FrontSide': return ctx.frontSide ?? '';
    case 'Tags': return ctx.note.tags.join(' ');
    case 'Type': return ctx.noteType.name;
    case 'Deck': return ctx.note.deck;
    case 'Subdeck': return ctx.note.deck.split('::').pop() ?? '';
    case 'Card': return ctx.noteType.templates.find((t) => t.ord === templateOrd(ctx))?.name ?? '';
    default: return undefined;
  }
}

/** A cloze note type has one template; its cards differ by cloze number, not template. */
function templateOrd(ctx: RenderContext): number {
  return ctx.noteType.kind === 'cloze' ? 0 : ctx.ord;
}

function fieldValue(name: string, ctx: RenderContext): string {
  return specialField(name, ctx) ?? ctx.note.fields[name] ?? '';
}

/**
 * Renders one template string. Sections are matched by name with nesting, so
 * {{#A}}{{#B}}..{{/B}}{{/A}} works; a section on an unknown field is treated as empty.
 */
export function renderTemplate(template: string, ctx: RenderContext): string {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf('{{', i);
    if (open < 0) { out += template.slice(i); break; }
    out += template.slice(i, open);
    const close = template.indexOf('}}', open + 2);
    if (close < 0) { out += template.slice(open); break; }
    const tag = template.slice(open + 2, close).trim();
    i = close + 2;

    const section = /^([#^])(.+)$/.exec(tag);
    if (section) {
      const field = section[2].trim();
      const end = findSectionEnd(template, i, field);
      const inner = template.slice(i, end.start);
      i = end.after;
      const empty = fieldIsEmpty(fieldValue(field, ctx));
      if ((section[1] === '#') !== empty) out += renderTemplate(inner, ctx);
      continue;
    }
    if (tag.startsWith('/')) continue; // stray close tag

    const parts = tag.split(':');
    const field = parts.pop()!.trim();
    // As rslib: {{type:...}} becomes [[type:...]] for the reviewer's pass, whatever filters are inside it.
    if (parts[0]?.trim() === 'type') {
      const inner = parts.slice(1).map((p) => p.trim());
      out += `[[type:${inner.length === 1 && (inner[0] === 'cloze' || inner[0] === 'nc') ? `${inner[0]}:` : ''}${field}]]`;
      continue;
    }
    let value = fieldValue(field, ctx);
    // Filters apply right to left: {{text:hint:F}} is text(hint(F)).
    for (const f of parts.reverse()) value = applyFilter(f, value, field, ctx);
    out += value;
  }
  return out;
}

function findSectionEnd(template: string, from: number, field: string): { start: number; after: number } {
  const tagRe = /\{\{\s*([#^/])\s*([^}]+?)\s*\}\}/g;
  tagRe.lastIndex = from;
  let depth = 1;
  for (let m = tagRe.exec(template); m; m = tagRe.exec(template)) {
    if (m[2] !== field) continue;
    depth += m[1] === '/' ? -1 : 1;
    if (depth === 0) return { start: m.index, after: m.index + m[0].length };
  }
  return { start: template.length, after: template.length };
}

/** What a {{type:}} card asks for: the text to compare against, and whether accents count. */
export interface TypeAnswer {
  expected: string;
  /** False for {{type:nc:Field}}, which ignores combining marks (accents). */
  combining: boolean;
}

const TYPE_PATTERN = /\[\[type:(.+?)\]\]/;
const TYPE_PATTERN_ALL = /\[\[type:(.+?)\]\]/g;

/**
 * The question side of a {{type:}} card, as aqt's reviewer has it (typeAnsQuestionFilter): the
 * first [[type:]] names the field. Where it sits, Franki shows nothing, as the text box is under
 * the card; an empty field asks for nothing, and a field the note type doesn't have says so.
 */
function typeAnswerQuestion(html: string, note: Note, noteType: NoteType, ord: number): { html: string; ask?: TypeAnswer } {
  const m = TYPE_PATTERN.exec(html);
  if (!m) return { html };
  let field = m[1];
  let clozeNumber: number | undefined;
  let combining = true;
  if (field.startsWith('cloze:')) { clozeNumber = ord + 1; field = field.split(':')[1]; }
  if (field.startsWith('nc:')) { combining = false; field = field.split(':')[1]; }
  let expected: string | undefined;
  if (noteType.fields.includes(field)) {
    expected = note.fields[field] ?? '';
    if (clozeNumber !== undefined) expected = clozeForTyping(expected, clozeNumber) || undefined;
  }
  if (expected === undefined) {
    const warning = clozeNumber !== undefined ? `Type answer: cloze ${clozeNumber} isn't on this note.` : `Type answer: unknown field ${field}`;
    return { html: html.replace(TYPE_PATTERN_ALL, warning) };
  }
  if (!expected) return { html: html.replace(TYPE_PATTERN_ALL, '') };
  return { html: html.replace(TYPE_PATTERN_ALL, ''), ask: { expected, combining } };
}

/**
 * The answer side (typeAnsAnswerFilter): each [[type:]] becomes the comparison of what was typed
 * with the field. When the back has `<hr id=answer>` (the usual {{FrontSide}} card), the line
 * moves to just above the comparison, as in Anki, so the question's [[type:]] in FrontSide is
 * where the comparison shows.
 */
function typeAnswerAnswer(html: string, ask: TypeAnswer | undefined, typed: string): string {
  if (!ask) return html.replace(TYPE_PATTERN_ALL, '');
  const hr = '<hr id=answer>';
  const buf = html.split(hr).join('');
  const hadHr = buf.length !== html.length;
  if (hadHr && !TYPE_PATTERN.test(buf)) return html;
  const shown = `${hadHr ? hr : ''}<div>${compareAnswer(ask.expected, typed, ask.combining)}</div>`;
  return buf.replace(TYPE_PATTERN_ALL, () => shown);
}

/**
 * Both sides of a card, as Anki would render them. A {{type:}} card also says what it asks for
 * (`typeAnswer`), and its back compares `typed` with it.
 */
export function renderTemplateCard(note: Note, noteType: NoteType, ord: number, typed = ''): { front: string; back: string; typeAnswer?: TypeAnswer } {
  const t = noteType.templates.find((x) => x.ord === (noteType.kind === 'cloze' ? 0 : ord)) ?? noteType.templates[0];
  if (!t) return { front: '', back: '' };
  const base = { note, noteType, ord };
  const front = renderTemplate(t.front, { ...base, side: 'front' });
  // {{FrontSide}} on the back shows the question without its sounds or speech playing again (and
  // keeps its [[type:]], where Anki shows the comparison).
  const back = renderTemplate(t.back, { ...base, side: 'back', frontSide: withoutTts(front.replace(/\[sound:[^\]]*\]/g, '')) });
  const question = typeAnswerQuestion(front, note, noteType, ord);
  return { front: question.html, back: typeAnswerAnswer(back, question.ask, typed), typeAnswer: question.ask };
}

/**
 * The template ordinals a note generates cards for, for an import that has no Anki cards to
 * follow (a TSV). A cloze note gets one per cloze number; a normal note one per template whose
 * front shows something more than it does with every field empty, which is Anki's rule in effect.
 */
export function templateOrdinals(note: Note, noteType: NoteType): number[] {
  if (noteType.kind === 'cloze') {
    const text = Object.values(note.fields).join(' ');
    return clozeNumbers(text).map((n) => n - 1);
  }
  const blank: Note = { ...note, fields: Object.fromEntries(Object.keys(note.fields).map((k) => [k, ''])) };
  const visible = (n: Note, ord: number) =>
    stripHtml(renderTemplateCard(n, noteType, ord).front).replace(/\s+/g, '');
  return noteType.templates
    .map((t) => t.ord)
    .filter((ord) => {
      const rendered = renderTemplateCard(note, noteType, ord).front;
      const hasMedia = /<img|\[sound:/i.test(rendered) && !/<img|\[sound:/i.test(renderTemplateCard(blank, noteType, ord).front);
      return hasMedia || visible(note, ord) !== visible(blank, ord);
    });
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** [sound:x.mp3] -> a play button; the first one on a side plays on its own when shown. */
function soundButtons(html: string): string {
  return html.replace(/\[sound:([^\]]+)\]/g, (_, file: string) =>
    `<a class="replay-button" href="#" data-sound="${escapeAttr(file)}" onclick="playSound(this.dataset.sound);return false;">▶</a>`);
}

/** [anki:tts] -> a play button that asks the app to read it (`sideAudio` lists them in the same order). */
function ttsButtons(html: string): string {
  return ttsTags(html, (tag, i) => (tag
    ? `<a class="replay-button" href="#" onclick="speakTts(${i});return false;">▶</a>`
    : escapeAttr(TTS_NO_LANGUAGE))).html;
}

/**
 * What a rendered side has to play: its text-to-speech tags, in the order of their play buttons,
 * and whether it has a recording. A recording wins: a side with one plays it on its own when shown
 * and reads nothing aloud until a play button is tapped, the rule Omnilanguage follows.
 */
export function sideAudio(html: string): { tts: TtsTag[]; hasSound: boolean } {
  return { tts: ttsTags(html, () => '').tags, hasSound: /\[sound:[^\]]+\]/.test(html) };
}

/**
 * A complete page for the WebView: the note type's CSS, Anki's body classes (`card cardN`, and
 * `nightMode night_mode` in dark mode, which many decks style), and the sound player. Relative
 * media paths ("flag.svg") resolve against `mediaBase`, the media folder's URI.
 */
export function cardDocument(
  html: string,
  opts: {
    css: string; ord: number; dark: boolean; autoplay: boolean; mediaBase?: string;
    /** The app's colors for the page behind the card, so it matches the frame it sits in. */
    colors?: { background: string; text: string; cloze: string };
  },
): string {
  const colors = opts.colors ?? (opts.dark
    ? { background: '#1a1d24', text: '#f1f1f1', cloze: '#6fa8ec' }
    : { background: '#ffffff', text: '#1b1b1b', cloze: '#2f6db5' });
  const night = opts.dark ? ' nightMode night_mode' : '';
  const base = opts.mediaBase ? `<base href="${escapeAttr(opts.mediaBase)}">` : '';
  return `<!doctype html><html><head><meta charset="utf-8">${base}
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body { margin: 0; padding: 16px; font-family: -apple-system, system-ui, sans-serif; font-size: 20px; text-align: center;
  background: ${colors.background}; color: ${colors.text}; }
img { max-width: 100%; height: auto; }
.cloze { font-weight: bold; color: ${colors.cloze}; }
.replay-button { display: inline-block; text-decoration: none; font-size: 22px; padding: 2px 8px; }
/* A typed answer's comparison, as Anki's reviewer styles it (a deck's own CSS, after this, can restyle it). */
code#typeans { display: inline-block; white-space: pre-wrap; font-family: ui-monospace, Menlo, monospace; line-height: 1.75; }
.typeGood { color: black; background: #afa; }
.typeBad { color: black; background: #faa; }
.typeMissed { color: black; background: #ccc; }
${opts.css}
</style></head>
<body class="card card${opts.ord + 1}${night}"><div id="qa">${ttsButtons(soundButtons(html))}</div>
<script>
var player = null;
function playSound(file) { if (player) player.pause(); player = new Audio(file); player.play(); }
function speakTts(i) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({ tts: i })); }
${opts.autoplay ? "var first = document.querySelector('[data-sound]'); if (first) playSound(first.dataset.sound);" : ''}
</script></body></html>`;
}
