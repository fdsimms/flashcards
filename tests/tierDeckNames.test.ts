/**
 * The deck list hides the subdecks the MCP's tier_deck_by_frequency makes, and finds them by name:
 * the pattern is written in Python (`TIER_NAME`, server/mcp/franki_mcp/tiers.py) and in TypeScript
 * (`TIER_DECK_PART`, src/core/deckTree.ts). If one changes alone, tiers either show up as decks or a
 * deck of the user's disappears, so this fails the build when the two stop being the same pattern.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TIER_DECK_PART } from '../src/core/deckTree';

describe('tier subdeck names', () => {
  it('are matched by the same pattern in the MCP and in the app', () => {
    const python = readFileSync(join(__dirname, '..', 'server', 'mcp', 'franki_mcp', 'tiers.py'), 'utf8');
    const found = python.match(/^TIER_NAME = re\.compile\(r"(.*)"\)$/m);
    expect(found, 'TIER_NAME is no longer defined in tiers.py as re.compile(r"...")').not.toBeNull();
    expect(found![1]).toBe(TIER_DECK_PART.source);
  });
});
