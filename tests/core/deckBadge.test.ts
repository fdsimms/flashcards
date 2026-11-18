import { describe, expect, it } from 'vitest';
import { deckTint, leadingEmoji, studiedSubdecks, subdeckOf } from '../../src/core/deckBadge';

describe('a deck\'s emoji', () => {
  it('splits the emoji a name starts with from the rest', () => {
    expect(leadingEmoji('🐘 ภาษาไทย')).toEqual({ emoji: '🐘', rest: 'ภาษาไทย' });
    expect(leadingEmoji('💈 Polski')).toEqual({ emoji: '💈', rest: 'Polski' });
  });

  it('keeps an emoji\'s variation selector, skin tone and joined parts together', () => {
    expect(leadingEmoji('🏝️ Ελληνικά')).toEqual({ emoji: '🏝️', rest: 'Ελληνικά' });
    expect(leadingEmoji('👨‍💻 Morse')).toEqual({ emoji: '👨‍💻', rest: 'Morse' });
    expect(leadingEmoji('👋🏽 Hello')).toEqual({ emoji: '👋🏽', rest: 'Hello' });
    expect(leadingEmoji('🇹🇭 Thai')).toEqual({ emoji: '🇹🇭', rest: 'Thai' });
  });

  it('takes the emoji even with no space after it', () => {
    expect(leadingEmoji('🧠Trivia')).toEqual({ emoji: '🧠', rest: 'Trivia' });
  });

  it('leaves a name with no leading emoji, or only an emoji, whole', () => {
    expect(leadingEmoji('Custom Study Session')).toEqual({ emoji: null, rest: 'Custom Study Session' });
    expect(leadingEmoji('Polski 🔤')).toEqual({ emoji: null, rest: 'Polski 🔤' });
    expect(leadingEmoji('🐘')).toEqual({ emoji: null, rest: '🐘' });
    // A digit is a keycap only with the keycap mark.
    expect(leadingEmoji('3000 words')).toEqual({ emoji: null, rest: '3000 words' });
  });
});

describe('a deck\'s tint', () => {
  it('is the same every time for the same deck, and in range', () => {
    const names = ['👅 Languages::🐘 ภาษาไทย', '👅 Languages::💈 Polski', '🧠 Trivia', 'Default'];
    for (const n of names) {
      expect(deckTint(n, 8)).toBe(deckTint(n, 8));
      expect(deckTint(n, 8)).toBeGreaterThanOrEqual(0);
      expect(deckTint(n, 8)).toBeLessThan(8);
    }
  });

  it('spreads sibling decks over the tints', () => {
    const siblings = ['Español', '日本語', 'Ελληνικά', 'ภาษาไทย', 'Norsk', 'Русский', 'Polski', 'English', 'Français', 'Deutsch'].map((n) => `👅 Languages::${n}`);
    expect(new Set(siblings.map((n) => deckTint(n, 8))).size).toBeGreaterThanOrEqual(5);
  });
});

describe('a card\'s language in a deck that holds several', () => {
  it('names the subdeck of the studied deck a card sits in, tiers included', () => {
    expect(subdeckOf('Languages::Polski', 'Languages')).toBe('Languages::Polski');
    expect(subdeckOf('Languages::Polski::Tier 1', 'Languages')).toBe('Languages::Polski');
    expect(subdeckOf('Languages', 'Languages')).toBeNull();
    expect(subdeckOf('Trivia::Geo', 'Languages')).toBeNull();
    expect(subdeckOf('LanguagesOld::Polski', 'Languages')).toBeNull();
  });

  it('finds the distinct subdecks the cards are in', () => {
    const found = studiedSubdecks(['Languages::Polski::Tier 1', 'Languages::Polski::Tier 2', 'Languages::Thai', 'Languages'], 'Languages');
    expect([...found].sort()).toEqual(['Languages::Polski', 'Languages::Thai']);
    expect(studiedSubdecks(['Languages::Polski::Tier 1'], 'Languages').size).toBe(1);
  });
});
