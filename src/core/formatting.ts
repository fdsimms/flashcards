/**
 * Bold, italic and underline in the note editor, which edits a field's HTML as text (line breaks
 * shown as new lines, see noteEditing.ts): toggling a mark wraps the selection in its tag or takes
 * the tag away, Plain text strips formatting, and `formattedRuns` reads a field back as styled
 * text so the editor can show how it will look.
 */

import { decodeEntities } from './html';

export type Mark = 'b' | 'i' | 'u';
export interface Selection { start: number; end: number }
export interface Edit { text: string; selection: Selection }

/** Every tag that makes text bold, italic or underlined, as Anki's editor and others write them. */
const MARK_TAGS: Record<Mark, string[]> = { b: ['b', 'strong'], i: ['i', 'em'], u: ['u'] };

/**
 * Wraps the selection in a mark's tag, or unwraps it when the selection already sits exactly
 * inside one (or is one, tags included). With nothing selected, an empty pair goes in at the
 * cursor, ready to type into.
 */
export function toggleMark(text: string, sel: Selection, mark: Mark): Edit {
  const start = Math.min(sel.start, sel.end);
  const end = Math.max(sel.start, sel.end);
  const open = `<${mark}>`;
  const close = `</${mark}>`;
  for (const tag of MARK_TAGS[mark]) {
    const o = `<${tag}>`;
    const c = `</${tag}>`;
    // The selection is just inside the tags.
    if (text.slice(start - o.length, start).toLowerCase() === o && text.slice(end, end + c.length).toLowerCase() === c) {
      return {
        text: text.slice(0, start - o.length) + text.slice(start, end) + text.slice(end + c.length),
        selection: { start: start - o.length, end: end - o.length },
      };
    }
    // The selection takes in the tags themselves.
    const picked = text.slice(start, end);
    if (picked.length >= o.length + c.length && picked.toLowerCase().startsWith(o) && picked.toLowerCase().endsWith(c)) {
      const inner = picked.slice(o.length, picked.length - c.length);
      return { text: text.slice(0, start) + inner + text.slice(end), selection: { start, end: start + inner.length } };
    }
  }
  return {
    text: text.slice(0, start) + open + text.slice(start, end) + close + text.slice(end),
    selection: { start: start + open.length, end: end + open.length },
  };
}

/** Formatting tags: what Plain text takes out (their text stays). */
const FORMATTING = /<\/?(b|strong|i|em|u|s|strike|span|font|sup|sub|mark)(\s[^>]*)?>/gi;

/** Takes bold, italic, underline and other text formatting out of the selection, or the whole field with nothing selected. */
export function clearFormatting(text: string, sel: Selection): Edit {
  const start = Math.min(sel.start, sel.end);
  const end = Math.max(sel.start, sel.end);
  if (start === end) {
    const plain = text.replace(FORMATTING, '');
    return { text: plain, selection: { start: plain.length, end: plain.length } };
  }
  const inner = text.slice(start, end).replace(FORMATTING, '');
  return { text: text.slice(0, start) + inner + text.slice(end), selection: { start, end: start + inner.length } };
}

/** Whether a field has formatting worth previewing. */
export function hasFormatting(text: string): boolean {
  return /<[a-z/][^>]*>|&[a-z#0-9]+;/i.test(text);
}

export interface Run { text: string; bold: boolean; italic: boolean; underline: boolean }


/**
 * A field's text as styled runs: bold, italic and underline from their tags (nested ones too), a
 * `<br>` or a new line as a line break, other tags dropped and their text kept, the common
 * entities decoded. What the editor's preview shows.
 */
export function formattedRuns(html: string): Run[] {
  const runs: Run[] = [];
  const depth = { b: 0, i: 0, u: 0 };
  const push = (t: string) => {
    if (!t) return;
    const style = { bold: depth.b > 0, italic: depth.i > 0, underline: depth.u > 0 };
    const last = runs[runs.length - 1];
    if (last && last.bold === style.bold && last.italic === style.italic && last.underline === style.underline) last.text += t;
    else runs.push({ text: t, ...style });
  };
  const tagRe = /<(\/?)([a-z][a-z0-9]*)\b[^>]*>/gi;
  let at = 0;
  for (let m = tagRe.exec(html); m; m = tagRe.exec(html)) {
    push(decodeEntities(html.slice(at, m.index)));
    at = m.index + m[0].length;
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const mark = MARK_TAGS.b.includes(name) ? 'b' : MARK_TAGS.i.includes(name) ? 'i' : MARK_TAGS.u.includes(name) ? 'u' : null;
    if (mark) depth[mark] = Math.max(0, depth[mark] + (closing ? -1 : 1));
    else if (name === 'br' || (closing && (name === 'div' || name === 'p'))) push('\n');
  }
  push(decodeEntities(html.slice(at)));
  return runs;
}
