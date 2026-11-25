import { fieldIsEmpty } from './template';

/**
 * The three Omnilanguage fields that only switch a card on or off, as the note editor shows them: a
 * toggle named for the card it makes, not a field holding "y". Anki reads a conditional as "anything
 * at all" (`cardKindsFor`), so a field holding "no" is on; a switch turned off writes nothing, and one
 * turned on writes "y" (what the MCP's `SWITCHES` check holds it to). Pure, so it's tested.
 */
export interface CardSwitch {
  field: string;
  label: string;
  hint: string;
  /** The field turns the card OFF (SuppressFrontCard), so the toggle is on while it is empty: all three read as "this card is made". */
  suppresses?: boolean;
}

export const CARD_SWITCHES: readonly CardSwitch[] = [
  { field: 'SuppressFrontCard', label: 'Word to meaning card', hint: 'Shows the word and asks the meaning.', suppresses: true },
  { field: 'GenerateReverse', label: 'Meaning to word card', hint: 'Shows the meaning and asks the word.' },
  { field: 'GenerateAudioCard', label: 'Listening card', hint: 'Plays the word and asks the meaning.' },
];

export const SWITCH_FIELDS: readonly string[] = CARD_SWITCHES.map((s) => s.field);

/** Whether a note type's fields include all three switches, so the editor can show them as toggles. */
export function hasCardSwitches(fieldNames: readonly string[]): boolean {
  return SWITCH_FIELDS.every((f) => fieldNames.includes(f));
}

/** Whether the card is made, from the field's text as it is edited. */
export function switchOn(fields: Record<string, string>, s: CardSwitch): boolean {
  const set = !fieldIsEmpty(fields[s.field]);
  return s.suppresses ? !set : set;
}

/** The fields with the card turned on or off. */
export function withSwitch(fields: Record<string, string>, s: CardSwitch, on: boolean): Record<string, string> {
  const set = s.suppresses ? !on : on;
  return { ...fields, [s.field]: set ? 'y' : '' };
}
