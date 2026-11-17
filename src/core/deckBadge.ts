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
