/**
 * Flagging a card for an agent to look at later (a typo, a mispronounced recording), through the
 * Franki MCP. It's built from what Anki already syncs: the purple flag on the card says "an agent
 * should look", and a `flag::<reason>` tag on the note says why. Both are plain Anki data, so every
 * device shows them and the MCP finds them with `flag:7` and `tag:flag::*`.
 */

/** Anki's purple flag (see `FLAG_NAMES`). */
export const AGENT_FLAG = 7;

export const FLAG_TAG_PREFIX = 'flag::';

/** The reasons the review menu offers, as the label shown and the tag's last part. */
export const AGENT_FLAG_REASONS = [
  { label: 'Typo or wrong text', slug: 'typo' },
  { label: 'Audio sounds wrong', slug: 'audio' },
  { label: 'Wrong translation', slug: 'translation' },
  { label: 'Something else', slug: 'other' },
] as const;

export type AgentFlagReason = (typeof AGENT_FLAG_REASONS)[number]['slug'];

/** Whether a tag is one of the reason tags (Anki compares tags without regard to case). */
export function isFlagTag(tag: string): boolean {
  return tag.toLowerCase().startsWith(FLAG_TAG_PREFIX);
}

/** The note's tags with its reason tags replaced by `reason`'s: a note carries one reason at a time. */
export function withFlagReason(tags: string[], reason: AgentFlagReason): string[] {
  return [...tags.filter((t) => !isFlagTag(t)), FLAG_TAG_PREFIX + reason];
}
