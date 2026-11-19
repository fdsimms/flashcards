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

  it('finds the language of a deck name as the app does, in the same order', () => {
    const { deckKeys } = skillCatalog();
    const ofName = (deck: string) => deckKeys.find(([key]) => deck.normalize('NFC').toLowerCase().includes(key))?.[1] ?? null;
    for (const deck of ['Thai', '🐟 Norsk', 'Polski', 'Deutsch::Verbs', 'Trivia', 'Japanese', 'Italiano']) {
      expect(ofName(deck), deck).toBe(languageOfDeck(deck)?.language ?? null);
    }
  });
});
