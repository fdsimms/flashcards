import { htmlToText, textToHtml } from './html';

/** The note fields a card lets you edit in place: what you wrote about the word, not what the word is. */
export type EditableField = 'Mnemonic' | 'Notes';

/**
 * The note's fields with `name` set to `text`. Text equal to what the card already shows changes nothing
 * (the field keeps its markup); a blank text clears the field, so its block leaves the card.
 */
export function withFieldText(fields: Record<string, string>, name: EditableField, text: string): Record<string, string> {
  const next = text.trim();
  if (next === htmlToText(fields[name] ?? '')) return fields;
  return { ...fields, [name]: textToHtml(next) };
}
