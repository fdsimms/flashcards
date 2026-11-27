/**
 * Writing by hand's ink: the strokes a finger draws in the writing box, the line each is drawn
 * as, and the part of the box they cover, so the writing can be shown again smaller beside the
 * real letter whatever size it was written. Pure; the box itself is src/ui/tools/InkPad.tsx.
 */

export interface Point {
  x: number;
  y: number;
}

/** One stroke: the points a finger passed from touching down to lifting. */
export type Stroke = Point[];

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How far a finger has to move before a stroke takes another point: nearer than this adds nothing a line would show. */
export const MIN_STEP = 1.5;

/** `stroke` with `p` at its end, or `stroke` itself when `p` is closer than `minStep` to its last point. */
export function extendStroke(stroke: Stroke, p: Point, minStep = MIN_STEP): Stroke {
  const last = stroke[stroke.length - 1];
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < minStep) return stroke;
  return [...stroke, p];
}

const n = (v: number) => String(Math.round(v * 10) / 10);

/**
 * A stroke as an SVG path: a curve through the midpoints of its points, which rounds the corners
 * a finger's samples leave, and a tap as a line too short to see but drawn as a dot by a round cap.
 */
export function strokePath(stroke: Stroke): string {
  if (!stroke.length) return '';
  const [first] = stroke;
  if (stroke.length === 1) return `M${n(first.x)} ${n(first.y)}l0.1 0`;
  let d = `M${n(first.x)} ${n(first.y)}`;
  for (let i = 1; i < stroke.length - 1; i++) {
    const p = stroke[i];
    const next = stroke[i + 1];
    d += `Q${n(p.x)} ${n(p.y)} ${n((p.x + next.x) / 2)} ${n((p.y + next.y) / 2)}`;
  }
  const last = stroke[stroke.length - 1];
  return `${d}L${n(last.x)} ${n(last.y)}`;
}

/** The smallest box around every point; none when nothing is drawn. */
export function inkBounds(strokes: Stroke[]): Box | null {
  const points = strokes.flat();
  if (!points.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** The least of the box the smaller copy shows, as a share of its width: a dot isn't blown up to fill it. */
const MIN_SHARE = 0.35;

/**
 * The part of the writing box to show when the writing is drawn again in a frame of `aspect`
 * (width over height): the ink with `margin` of its larger side around it, grown to the frame's
 * shape about its middle. Nothing drawn shows the whole box.
 */
export function inkViewBox(strokes: Stroke[], pad: { width: number; height: number }, aspect = pad.width / pad.height, margin = 0.12): Box {
  const bounds = inkBounds(strokes);
  if (!bounds) return { x: 0, y: 0, width: pad.width, height: pad.height };
  const room = Math.max(bounds.width, bounds.height) * margin;
  let width = Math.max(bounds.width + room * 2, pad.width * MIN_SHARE);
  let height = Math.max(bounds.height + room * 2, (pad.width * MIN_SHARE) / aspect);
  if (width / height < aspect) width = height * aspect;
  else height = width / aspect;
  return { x: bounds.x + bounds.width / 2 - width / 2, y: bounds.y + bounds.height / 2 - height / 2, width, height };
}
