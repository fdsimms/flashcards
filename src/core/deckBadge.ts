/**
 * A deck's badge on the deck list: the emoji its name starts with ("🐘 ภาษาไทย"), shown on a tile of
 * its own, and which of the theme's tints that tile takes.
 */

// One emoji: a pictograph with its variation selector, skin tone and any ZWJ-joined parts
// ("🏝️", "👨‍💻"), a flag (two regional indicators), or a keycap ("1️⃣").
const LEADING_EMOJI = /^(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*)*)/u;

/**
 * Splits the emoji a deck's name starts with from the rest of it. A name that doesn't start with
 * one, or is nothing but one, comes back whole with no emoji.
 */
export function leadingEmoji(name: string): { emoji: string | null; rest: string } {
  const m = LEADING_EMOJI.exec(name);
  if (!m) return { emoji: null, rest: name };
  const rest = name.slice(m[0].length).trim();
  return rest ? { emoji: m[0], rest } : { emoji: null, rest: name };
}

/**
 * Which of `count` tints a deck's tile takes, from its full name (`Languages::Polski`), so a deck
 * keeps its color however the list is ordered or filtered, and on every phone.
 */
export function deckTint(deck: string, count: number): number {
  let h = 2166136261;
  for (const ch of deck) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % count;
}

/**
 * The tint of every deck in `decks` (full names), with siblings kept apart: decks under the same
 * parent are taken in name order, each starting at the tint `deckTint` prefers and moving on to the
 * next one a sibling hasn't taken. Only a parent with more than `count` children repeats a tint.
 * A name hash alone put French and Russian on the same one. Adding or removing a deck can move the
 * tints of siblings after it by name; every screen gets them from here, so they still agree.
 */
export function deckTintSlots(decks: Iterable<string>, count: number): Map<string, number> {
  const families = new Map<string, string[]>();
  for (const deck of new Set(decks)) {
    const cut = deck.lastIndexOf('::');
    const parent = cut < 0 ? '' : deck.slice(0, cut);
    const family = families.get(parent);
    if (family) family.push(deck);
    else families.set(parent, [deck]);
  }
  const slots = new Map<string, number>();
  for (const family of families.values()) {
    family.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const taken = new Set<number>();
    for (const deck of family) {
      const wanted = deckTint(deck, count);
      let slot = wanted;
      // With every tint taken the deck keeps its preferred one, repeating it.
      while (taken.has(slot) && taken.size < count) slot = (slot + 1) % count;
      taken.add(slot);
      slots.set(deck, slot);
    }
  }
  return slots;
}

/**
 * The subdeck of `studied` that a card's deck sits in ("Languages::Polski::Tier 1" studied from
 * "Languages" is "Languages::Polski"), or null when the card is in `studied` itself or outside it.
 */
export function subdeckOf(deck: string, studied: string): string | null {
  if (!deck.startsWith(`${studied}::`)) return null;
  return `${studied}::${deck.slice(studied.length + 2).split('::')[0]}`;
}

/**
 * The subdecks of `studied` that its cards are in. Review marks each card with its subdeck
 * (Languages' Polish, Thai and German mixed in one session) only when there are two or more.
 */
export function studiedSubdecks(cardDecks: Iterable<string>, studied: string): Set<string> {
  const found = new Set<string>();
  for (const d of cardDecks) {
    const sub = subdeckOf(d, studied);
    if (sub) found.add(sub);
  }
  return found;
}
