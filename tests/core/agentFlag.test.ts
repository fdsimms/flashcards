import { describe, expect, it } from 'vitest';
import { AGENT_FLAG, AGENT_FLAG_REASONS, canFixNow, cleanFlagNote, decodeFlagNote, encodeFlagNote, FLAG_NOTE_MAX, flagNoteOf, flagReasonOf, isFlagTag, withFlagReason, withoutFlag } from '../../src/core/agentFlag';
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

  it('offers a fix now for text reasons but not for audio, which needs a new recording', () => {
    expect(canFixNow('audio')).toBe(false);
    for (const r of ['typo', 'translation', 'other'] as const) expect(canFixNow(r)).toBe(true);
  });

  it('offers reasons whose slugs are valid, distinct tag parts', () => {
    const slugs = AGENT_FLAG_REASONS.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z-]+$/);
  });
});

describe('flag note', () => {
  it('round-trips text of any script, case and spacing included', () => {
    for (const text of ['Remove (เสียใจ) from it', 'Wrong: it is "Kot", not "kot"', 'Привет, мир', 'ß ÄÖ 😀']) {
      expect(decodeFlagNote(encodeFlagNote(text))).toBe(text);
    }
  });

  it('is lowercase hex only, so Anki neither splits it nor changes its case', () => {
    expect(encodeFlagNote('Ab c')).toBe('41622063');
    expect(encodeFlagNote('Remove (เสียใจ) :: it')).toMatch(/^[0-9a-f]+$/);
  });

  it('cleans the note: one line, trimmed, and cut at the limit', () => {
    expect(cleanFlagNote('  two\n\nlines   here ')).toBe('two lines here');
    expect(Array.from(cleanFlagNote('é'.repeat(FLAG_NOTE_MAX + 50)))).toHaveLength(FLAG_NOTE_MAX);
    expect(cleanFlagNote('😀'.repeat(FLAG_NOTE_MAX + 5))).toBe('😀'.repeat(FLAG_NOTE_MAX));
  });

  it('reads nothing from hex that is not one', () => {
    expect(decodeFlagNote('zz')).toBe('');
    expect(decodeFlagNote('abc')).toBe('');
    expect(decodeFlagNote('ff')).toBe('');
  });

  it('adds a note tag with the reason, and drops an old one when flagged again', () => {
    const tags = withFlagReason(['verb'], 'typo', 'Remove (เสียใจ)');
    expect(tags.slice(0, 2)).toEqual(['verb', 'flag::typo']);
    expect(flagNoteOf(tags)).toBe('Remove (เสียใจ)');
    expect(flagReasonOf(tags)).toBe('typo');
    const again = withFlagReason(tags, 'audio');
    expect(again).toEqual(['verb', 'flag::audio']);
    expect(flagNoteOf(again)).toBe('');
  });

  it('counts the note tag as a flag tag, and finds nothing on an unflagged note', () => {
    expect(isFlagTag('flagnote::41')).toBe(true);
    expect(isFlagTag('FlagNote::41')).toBe(true);
    expect(flagNoteOf(['verb'])).toBe('');
    expect(flagReasonOf(['verb', 'flag::nonsense'])).toBeNull();
  });

  it('removes every flag tag and keeps the rest', () => {
    expect(withoutFlag(['verb', 'flag::typo', 'flagnote::41', 'Flag::Audio'])).toEqual(['verb']);
  });
});
