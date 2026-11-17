import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_FONT_OPTIONS, fontFileNames } from '../src/core/fonts';

// A font that's listed but missing a file, or not registered natively, draws in the system font with no error.
describe('the bundled fonts', () => {
  const appJson = readFileSync('app.json', 'utf8');
  const cardFonts = readFileSync('src/media/cardFonts.ts', 'utf8');
  const files = APP_FONT_OPTIONS.flatMap((o) => fontFileNames(o.id));

  it('has a file for every face, registered in app.json and in the card fonts table', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      expect(existsSync(`assets/fonts/${name}`), `${name} is in assets/fonts`).toBe(true);
      expect(appJson, `${name} is in app.json`).toContain(`./assets/fonts/${name}`);
      expect(cardFonts, `${name} is in src/media/cardFonts.ts`).toContain(`'${name}': require('../../assets/fonts/${name}')`);
    }
  });
  it('ships each family with its license', () => {
    for (const o of APP_FONT_OPTIONS) if (o.family) expect(existsSync(`assets/fonts/${o.family}-OFL.txt`), `${o.family} license`).toBe(true);
  });
});
