import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_FONT_OPTIONS, fontFileNames } from '../src/core/fonts';

// A font that's listed but missing a file, or not registered natively, draws in the system font with no error.
describe('the bundled fonts', () => {
  const appJson = readFileSync('app.json', 'utf8');
  const cardFonts = readFileSync('src/media/cardFonts.ts', 'utf8');
  const bundled = APP_FONT_OPTIONS.filter((o) => !o.download);
  const files = bundled.flatMap((o) => fontFileNames(o.id));

  it('has a file for every bundled face, registered in app.json and in the card fonts table', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      expect(existsSync(`assets/fonts/${name}`), `${name} is in assets/fonts`).toBe(true);
      expect(appJson, `${name} is in app.json`).toContain(`./assets/fonts/${name}`);
      expect(cardFonts, `${name} is in src/media/cardFonts.ts`).toContain(`'${name}': require('../../assets/fonts/${name}')`);
    }
  });
  it('does not bundle a font that is downloaded', () => {
    for (const o of APP_FONT_OPTIONS.filter((x) => x.download)) {
      for (const name of fontFileNames(o.id)) {
        expect(existsSync(`assets/fonts/${name}`), `${name} stays out of assets/fonts`).toBe(false);
        expect(appJson).not.toContain(name);
        expect(cardFonts).not.toContain(name);
      }
    }
  });
  it('ships each family with its license', () => {
    for (const o of APP_FONT_OPTIONS) if (o.family) expect(existsSync(`assets/fonts/${o.family}-OFL.txt`), `${o.family} license`).toBe(true);
  });
});
