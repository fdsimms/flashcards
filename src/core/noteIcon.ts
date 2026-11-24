/**
 * A note's picture (the Omnilanguage Icon field): one emoji where an emoji shows exactly the thing,
 * else a Tabler icon whose own name is the thing, kept as SVG path data. A drawing made up for the
 * note is never written: a picture has to be exactly the thing, and a near one teaches the wrong
 * word. Franki shows it with the meaning on an answer side, so the learner meets the picture with
 * what it stands for, and first on the meaning-to-word card's front, where the word is then
 * recalled from the thing itself and the English waits behind a tap (cards.ts).
 *
 * A drawing is `|`-separated SVG path `d` strings for a 24 by 24 box, drawn as round strokes with no
 * fill. Only path data is kept, never markup, so there is nothing to sanitize and nothing a card
 * could run: a value that is neither one emoji nor path data is no picture at all. This is what the
 * card draws, whatever wrote it, so it stays as permissive as the older notes need. The servers
 * hold what is written to the stricter rule, one emoji or exactly a Tabler icon's path data
 * (`franki_speech.icons`, used by note_queue.py and the MCP's omnilanguage.py). Pure, so it's tested.
 */

export type Picture = { emoji: string } | { paths: string[] };

/** The box a drawing's path data is written for. */
export const PICTURE_BOX = 24;
export const MAX_PATHS = 8;
export const MAX_DRAWING_LENGTH = 1200;
const MAX_EMOJI_CODEPOINTS = 8;

// What an emoji is made of: pictographs, with the joiner, variation selector, keycap, skin tones and flag letters.
const EMOJI = /^(?:[←-⇿⌀-⏿①-➿⤀-⥿⬀-⯿〰〽㊗㊙\u{1f000}-\u{1faff}]|[‍️⃣])+$/u;
const JOINERS = /[‍️⃣]/gu;
// One path: it starts with a move, and holds only SVG's path commands and numbers.
const PATH = /^[Mm][MmLlHhVvCcSsQqTtAaZz0-9\s,.+\-eE]*$/;

export function isEmoji(value: string): boolean {
  const points = Array.from(value);
  return points.length > 0 && points.length <= MAX_EMOJI_CODEPOINTS && EMOJI.test(value) && value.replace(JOINERS, '') !== '';
}

/** A drawing's paths, or null when the value isn't path data and nothing else. */
export function drawingPaths(value: string): string[] | null {
  if (!value || value.length > MAX_DRAWING_LENGTH) return null;
  const paths = value.split('|').map((p) => p.trim());
  return paths.length <= MAX_PATHS && paths.every((p) => PATH.test(p)) ? paths : null;
}

/** The picture an Icon field holds (as plain text), or null with none it can draw. */
export function parsePicture(raw: string): Picture | null {
  const value = raw.trim();
  if (isEmoji(value)) return { emoji: value };
  const paths = drawingPaths(value);
  return paths ? { paths } : null;
}
