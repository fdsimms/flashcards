import type { Point } from './ink';

/**
 * Stroke order for Writing by hand's kana and kanji: each character's strokes, in the order and
 * direction they're written, from KanjiVG (kanjivg.tagaini.net; Ulrich Apel, CC BY-SA 3.0, shown
 * as `STROKE_CREDIT` wherever they are). A character's file is downloaded from jsDelivr the first
 * time it's asked for, about 2 KB, at a pinned release whose files never change, and kept in the
 * caches folder (src/ui/tools/useStrokeOrder.ts). Pure; nothing here checks what the learner drew.
 */

/** The KanjiVG release the files come from. Checked on jsDelivr when this was written (27 November 2026). */
export const KANJIVG_VERSION = 'r20240807';

export const STROKE_CREDIT = 'Stroke order: KanjiVG, CC BY-SA 3.0';

/** KanjiVG draws every character in a box this many units square. */
export const STROKE_BOX = 109;

export interface StrokeOrder {
  /** Each stroke's SVG path, first stroke first, in `STROKE_BOX` units. */
  strokes: string[];
  /** Where each stroke starts: the end to begin it from. */
  starts: Point[];
  /** Where KanjiVG puts each stroke's number, clear of the strokes. */
  labels: Point[];
}

/** Whether `text` is one kana or kanji, which is what KanjiVG has a file for. */
export function hasStrokeFile(text: string): boolean {
  return [...text].length === 1 && /^[ぁ-ゖァ-ヺ㐀-䶿一-鿿]$/u.test(text);
}

/** A character's file in KanjiVG: its code point as five hex digits. */
export function strokeFileName(character: string): string {
  return `${character.codePointAt(0)!.toString(16).padStart(5, '0')}.svg`;
}

export function strokeUrl(character: string): string {
  return `https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg@${KANJIVG_VERSION}/kanji/${strokeFileName(character)}`;
}

const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

/**
 * A KanjiVG file's strokes: its `<path>`s by their `-sN` ids, in that order whatever order the
 * file lists them in, each with where it starts and where its number goes. None when the text
 * isn't a KanjiVG file, or a stroke is missing, so a half-read file is never drawn.
 */
export function parseStrokes(svg: string): StrokeOrder | null {
  const paths: { n: number; d: string }[] = [];
  for (const tag of svg.match(/<path\b[^>]*>/g) ?? []) {
    const n = /\bid="kvg:[0-9a-f]+-s(\d+)"/i.exec(tag)?.[1];
    const d = /\sd="([^"]+)"/.exec(tag)?.[1];
    if (n && d) paths.push({ n: Number(n), d });
  }
  if (!paths.length) return null;
  paths.sort((a, b) => a.n - b.n);
  if (paths.some((p, i) => p.n !== i + 1)) return null;
  const starts = paths.map((p) => {
    const [x, y] = (/^\s*M\s*([^a-zA-Z]+)/.exec(p.d)?.[1].match(NUMBER) ?? []).map(Number);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  });
  if (starts.some((s) => !s)) return null;
  const placed = new Map<number, Point>();
  for (const m of svg.matchAll(/<text\b[^>]*transform="matrix\(1 0 0 1 ([-\d.]+) ([-\d.]+)\)"[^>]*>(\d+)<\/text>/g)) {
    placed.set(Number(m[3]), { x: Number(m[1]), y: Number(m[2]) });
  }
  return {
    strokes: paths.map((p) => p.d),
    starts: starts as Point[],
    // A file with no number for a stroke puts it at the stroke's start.
    labels: paths.map((p, i) => placed.get(p.n) ?? (starts[i] as Point)),
  };
}

/** How many numbers each path command takes, by its letter in lower case. */
const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, z: 0 };

/**
 * About how long a stroke is, in its own units: the length of the straight lines through its
 * points and control points, which is never less than the curve and close to it for the gentle
 * curves of handwriting. For drawing a stroke at an even pace. None for a path with a command
 * this doesn't read (an arc).
 */
export function strokeLength(d: string): number | null {
  let length = 0;
  let at: Point = { x: 0, y: 0 };
  let start: Point = at;
  const go = (to: Point) => { length += Math.hypot(to.x - at.x, to.y - at.y); at = to; };
  for (const [, letter, rest] of d.matchAll(/([a-zA-Z])([^a-zA-Z]*)/g)) {
    const command = letter.toLowerCase();
    const arity = ARITY[command];
    if (arity === undefined) return null;
    const relative = letter === command;
    const values = (rest.match(NUMBER) ?? []).map(Number);
    if (command === 'z') { go(start); continue; }
    if (values.length === 0 || values.length % arity !== 0) return null;
    for (let i = 0; i < values.length; i += arity) {
      const v = values.slice(i, i + arity);
      const origin = relative ? at : { x: 0, y: 0 };
      if (command === 'h') go({ x: origin.x + v[0], y: at.y });
      else if (command === 'v') go({ x: at.x, y: origin.y + v[0] });
      else if (command === 'm' && i === 0) { at = { x: origin.x + v[0], y: origin.y + v[1] }; start = at; }
      // Every other command's numbers are points in turn, the last being where it ends; a
      // relative command's points are all measured from where it began.
      else for (let k = 0; k < v.length; k += 2) go({ x: origin.x + v[k], y: origin.y + v[k + 1] });
    }
  }
  return length;
}

/** How long each stroke takes to draw when they're played, and the pause before the next. */
export const STROKE_MS = 650;
export const STROKE_GAP_MS = 250;

/**
 * Where playing the strokes has got to after `elapsed` ms: how many are finished, and how far
 * along the one being drawn is (0 to 1; 0 through the pause after a stroke). Past the last
 * stroke, all of them are finished.
 */
export function strokesAt(elapsed: number, count: number): { done: number; drawing: number } {
  const each = STROKE_MS + STROKE_GAP_MS;
  const done = Math.min(count, Math.max(0, Math.floor(elapsed / each)));
  if (done >= count) return { done: count, drawing: 0 };
  const into = elapsed - done * each;
  // The pause comes first, so a finished stroke is seen whole before the next starts.
  return { done, drawing: Math.min(1, Math.max(0, (into - STROKE_GAP_MS) / STROKE_MS)) };
}
