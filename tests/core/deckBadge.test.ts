import { describe, expect, it } from 'vitest';
import { deckTint, deckTintSlots, leadingEmoji, studiedSubdecks, subdeckOf } from '../../src/core/deckBadge';

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

describe('tints that keep sibling decks apart', () => {
  const fr = '👅 Languages::🥐 Français';
  const ru = '👅 Languages::🐻 Русский';
  const languages = ['🌮 Español', '🍥 日本語', '🏝️ Ελληνικά', '🐘 ภาษาไทย', '🐟 Norsk', '🐻 Русский', '💈 Polski', '🗽 English', '🥐 Français', '🥨 Deutsch', '🪵 Backlog'].map((n) => `👅 Languages::${n}`);

  it('gives no two decks under one parent the same tint while there are tints to spare', () => {
    // The names hash alone put Français and Русский (and Thai, 日本語 and Polski) on one tint.
    expect(deckTint(fr, 8)).toBe(deckTint(ru, 8));
    const slots = deckTintSlots(languages, 12);
    expect(slots.get(fr)).not.toBe(slots.get(ru));
    expect(new Set(languages.map((n) => slots.get(n))).size).toBe(languages.length);
  });

  it('keeps a deck on the tint its name prefers when no sibling took it', () => {
    const slots = deckTintSlots(['A::Only'], 12);
    expect(slots.get('A::Only')).toBe(deckTint('A::Only', 12));
  });

  it('is the same however the decks are ordered, and in range', () => {
    const forward = deckTintSlots(languages, 12);
    const backward = deckTintSlots([...languages].reverse(), 12);
    for (const n of languages) {
      expect(backward.get(n)).toBe(forward.get(n));
      expect(forward.get(n)).toBeGreaterThanOrEqual(0);
      expect(forward.get(n)).toBeLessThan(12);
    }
  });

  it('repeats a tint only once a parent has more children than tints', () => {
    const many = Array.from({ length: 5 }, (_, i) => `P::deck ${i}`);
    const slots = deckTintSlots(many, 3);
    expect(new Set(many.map((n) => slots.get(n))).size).toBe(3);
  });

  it('tints a deck under a different parent separately', () => {
    const slots = deckTintSlots(['A::x', 'B::x'], 12);
    expect(slots.get('A::x')).toBe(deckTint('A::x', 12));
    expect(slots.get('B::x')).toBe(deckTint('B::x', 12));
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
