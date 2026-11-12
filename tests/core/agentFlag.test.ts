import { describe, expect, it } from 'vitest';
import { AGENT_FLAG, AGENT_FLAG_REASONS, isFlagTag, withFlagReason } from '../../src/core/agentFlag';
import { FLAG_NAMES } from '../../src/core/cardState';

describe('agent flag', () => {
  it('is the purple flag', () => {
    expect(FLAG_NAMES[AGENT_FLAG]).toBe('Purple');
  });

  it('adds the reason tag and keeps the other tags', () => {
    expect(withFlagReason(['verb', 'leech'], 'audio')).toEqual(['verb', 'leech', 'flag::audio']);
  });

  it('replaces an earlier reason instead of stacking two', () => {
    expect(withFlagReason(['flag::typo', 'verb'], 'audio')).toEqual(['verb', 'flag::audio']);
    expect(withFlagReason(['Flag::Typo'], 'other')).toEqual(['flag::other']);
  });

  it('recognizes reason tags only by their prefix', () => {
    expect(isFlagTag('flag::typo')).toBe(true);
    expect(isFlagTag('FLAG::audio')).toBe(true);
    expect(isFlagTag('flagship')).toBe(false);
    expect(isFlagTag('flag')).toBe(false);
  });

  it('offers reasons whose slugs are valid, distinct tag parts', () => {
    const slugs = AGENT_FLAG_REASONS.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z-]+$/);
  });
});
