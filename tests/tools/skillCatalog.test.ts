import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { languageOfDeck } from '../../src/tools/skills';
import { skillCatalog } from '../../src/tools/skillCatalog';

const FILE = join(__dirname, '..', '..', 'server', 'mcp', 'franki_mcp', 'skill_catalog.json');
const text = () => `${JSON.stringify(skillCatalog(), null, 1)}\n`;

describe("the skill catalog the MCP's daily job reads", () => {
  // `npm run catalog:skills` sets this and rewrites the file.
  if (process.env.UPDATE_SKILL_CATALOG) it('is rewritten', () => { writeFileSync(FILE, text()); });

  it('is the one skills.ts makes now (run `npm run catalog:skills` after changing a skill)', () => {
    expect(readFileSync(FILE, 'utf8')).toBe(text());
  });

  it('is the same every time it is made', () => {
    expect(text()).toBe(text());
  });

  it("gives each example deck the language the app's skill cards read from it", () => {
    // The MCP's test runs its own reading against the same examples (test_skills.py).
    for (const [deck, language] of skillCatalog().deckExamples) {
      const app = languageOfDeck(deck)?.language ?? null;
      expect(language, deck).toBe(app && skillCatalog().languages[app] ? app : null);
    }
  });
});
