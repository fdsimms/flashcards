/**
 * Flagging a card for an agent to look at later (a typo, a mispronounced recording), through the
 * Franki MCP. It's built from what Anki already syncs: the purple flag on the card says "an agent
 * should look", a `flag::<reason>` tag on the note says why, and an optional `flagnote::<hex>` tag
 * carries what the user typed. All of it is plain Anki data, so every device shows it and the MCP
 * finds it with `flag:7` and `tag:flag::*`.
 */

/** Anki's purple flag (see `FLAG_NAMES`). */
export const AGENT_FLAG = 7;

export const FLAG_TAG_PREFIX = 'flag::';
export const FLAG_NOTE_PREFIX = 'flagnote::';

/** The longest note kept, in characters. A Thai note takes about six tag characters per letter, so this keeps the tag short. */
export const FLAG_NOTE_MAX = 200;

/** The reasons the flag sheet offers, as the label shown and the tag's last part. */
export const AGENT_FLAG_REASONS = [
  { label: 'Typo or wrong text', slug: 'typo' },
  { label: 'Audio sounds wrong', slug: 'audio' },
  { label: 'Wrong translation', slug: 'translation' },
  { label: 'Something else', slug: 'other' },
] as const;

export type AgentFlagReason = (typeof AGENT_FLAG_REASONS)[number]['slug'];

/**
 * Whether "Fix with Claude now" is offered for a reason. A fix is a text edit to the note's fields,
 * and a wrong-sounding recording needs a new one, which the server can't make (the MCP's
 * `add_tts_audio` can, in a chat), so the sheet only flags it.
 */
export function canFixNow(reason: AgentFlagReason): boolean {
  return reason !== 'audio';
}

/** Whether a tag is one of the flag's tags, reason or note (Anki compares tags without regard to case). */
export function isFlagTag(tag: string): boolean {
  const t = tag.toLowerCase();
  return t.startsWith(FLAG_TAG_PREFIX) || t.startsWith(FLAG_NOTE_PREFIX);
}

/**
 * A note as the text of a tag. A tag can't hold a space, and Anki merges tags that differ only by
 * case, which would change the capitals of a note typed on two cards; so the note's UTF-8 bytes are
 * written as lowercase hex. The MCP reads it back the same way (`_flag_note` in server/mcp).
 */
export function encodeFlagNote(note: string): string {
  const text = cleanFlagNote(note);
  let hex = '';
  // encodeURIComponent gives the UTF-8 bytes as %XX, and leaves ASCII punctuation as itself.
  for (const part of encodeURIComponent(text).split(/(%[0-9A-F]{2})/)) {
    if (/^%[0-9A-F]{2}$/.test(part)) hex += part.slice(1).toLowerCase();
    else for (let i = 0; i < part.length; i++) hex += part.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hex;
}

/** What a note was before `encodeFlagNote`, or '' for hex that isn't one. */
export function decodeFlagNote(hex: string): string {
  if (!/^([0-9a-f]{2})+$/i.test(hex)) return '';
  try {
    return decodeURIComponent(hex.replace(/../g, '%$&'));
  } catch {
    return '';
  }
}

/** A note trimmed, its line breaks and runs of spaces made single spaces, and cut to `FLAG_NOTE_MAX` characters. */
export function cleanFlagNote(note: string): string {
  return Array.from(note.replace(/\s+/g, ' ').trim()).slice(0, FLAG_NOTE_MAX).join('');
}

/** The note on a note's flag, or '' when it has none. */
export function flagNoteOf(tags: string[]): string {
  const tag = tags.find((t) => t.toLowerCase().startsWith(FLAG_NOTE_PREFIX));
  return tag ? decodeFlagNote(tag.slice(FLAG_NOTE_PREFIX.length)) : '';
}

/** The reason on a note's flag, or null when it has none. */
export function flagReasonOf(tags: string[]): AgentFlagReason | null {
  const tag = tags.find((t) => t.toLowerCase().startsWith(FLAG_TAG_PREFIX));
  const slug = tag?.slice(FLAG_TAG_PREFIX.length).toLowerCase();
  return AGENT_FLAG_REASONS.find((r) => r.slug === slug)?.slug ?? null;
}

/** The note's tags with its flag tags replaced by `reason`'s and `note`'s: a note carries one reason and one note at a time. */
export function withFlagReason(tags: string[], reason: AgentFlagReason, note = ''): string[] {
  const kept = withoutFlag(tags);
  const typed = cleanFlagNote(note);
  return [...kept, FLAG_TAG_PREFIX + reason, ...(typed ? [FLAG_NOTE_PREFIX + encodeFlagNote(typed)] : [])];
}

/** The note's tags without any flag tag: a flag that's been dealt with. */
export function withoutFlag(tags: string[]): string[] {
  return tags.filter((t) => !isFlagTag(t));
}
