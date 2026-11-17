/**
 * The language flags (`src/ui/flagImages.ts`) are header button icons. iOS sizes a bar button from
 * its image's size in points (pixels over the @2x/@3x scale), and only then shrinks the picture to
 * fit the bar's height, so a flag saved as a 128-pixel image with no scale suffix is a 128-point
 * icon: the button stretches into a wide pill around a small flag. Each flag comes at icon size, in
 * 1x, @2x and @3x, so the button stays a circle.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FLAGS = join(__dirname, '..', 'assets', 'flags');
/** About the size of an SF Symbol in the header; past this the button turns into a pill. */
const MAX_POINTS = 28;

function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('flag images', () => {
  const files = readdirSync(FLAGS).filter((f) => f.endsWith('.png'));
  const bases = files.filter((f) => !f.includes('@'));

  it('finds the flags', () => {
    expect(bases).toContain('th.png');
  });

  it.each(bases)('%s comes at icon size in every scale', (base) => {
    const name = base.slice(0, -'.png'.length);
    const points = pngSize(join(FLAGS, base)).width;
    expect(points).toBeLessThanOrEqual(MAX_POINTS);
    for (const scale of [1, 2, 3]) {
      const file = scale === 1 ? base : `${name}@${scale}x.png`;
      expect(files).toContain(file);
      const { width, height } = pngSize(join(FLAGS, file));
      expect({ width, height }).toEqual({ width: points * scale, height: points * scale });
    }
  });
});
