import type { ReaderText, TextChoice } from './api';

/** What a choice says, as one string: its words (and the spaces and punctuation between them) put back together. */
export function choiceText(choice: TextChoice): string {
  return choice.words.map((w) => w.text).join('').trim();
}

/** Whether a story episode ends on a decision (an older server, and any other text, sends none). */
export function hasChoices(text: ReaderText): boolean {
  return (text.choices?.length ?? 0) > 0;
}

/**
 * What the end of the text shows. A text being read offers its choices to pick from; one read
 * before (a past text) shows only what was picked, read-only, since the next episode is already
 * written from it and a second pick would change nothing. Nothing when there is nothing to show.
 */
export function choicesView(text: ReaderText, review: boolean): { pick: boolean } | null {
  if (!hasChoices(text)) return null;
  if (!review) return { pick: true };
  return text.chosen === null || text.chosen === undefined ? null : { pick: false };
}

/** Whether Play all stops at the end of this text instead of moving on, so the choice isn't skipped past. */
export function holdsPlayAll(text: ReaderText, review: boolean): boolean {
  return choicesView(text, review)?.pick === true;
}
