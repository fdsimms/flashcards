import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOME_AFTER_SCREENS, SHEET_ROUTES, showsHomeButton } from '../src/ui/homeButton';

describe('showsHomeButton', () => {
  it('leaves a tab root and the first push (Settings) with just Back', () => {
    expect(showsHomeButton(1, 'index')).toBe(false);
    expect(showsHomeButton(2, 'settings')).toBe(false);
  });

  it('shows from the third screen of a stack', () => {
    expect(HOME_AFTER_SCREENS).toBe(3);
    expect(showsHomeButton(3, 'settings-page')).toBe(true);
    expect(showsHomeButton(5, 'reminder')).toBe(true);
  });

  it('never shows on a sheet, however deep', () => {
    for (const name of SHEET_ROUTES) expect(showsHomeButton(6, name)).toBe(false);
  });
});

describe('SHEET_ROUTES', () => {
  it('lists exactly the formSheet screens in the root layout', () => {
    const layout = readFileSync(join(__dirname, '../src/app/_layout.tsx'), 'utf8');
    const declared = [...layout.matchAll(/<Stack\.Screen name="([^"]+)" options=\{\{[^}]*presentation: 'formSheet'/g)].map((m) => m[1]);
    expect([...SHEET_ROUTES].sort()).toEqual(declared.sort());
  });
});
