import type { RatingValue } from './scheduler';

/**
 * Which answer buttons Review shows: one setting for every deck. FSRS reads every grade, but
 * whether a card was remembered at all (Again or not) carries most of what it learns; Hard and
 * Easy only nudge the next interval and the card's difficulty. Fewer buttons are quicker on a
 * phone and avoid pressing Hard for a card that was actually forgotten, which tells FSRS it was
 * remembered. The deck's FSRS weights are trained on how the buttons were used, so after
 * changing habits, re-optimize in Anki's deck options.
 */
export type AnswerButtons = 'all' | 'againGoodEasy' | 'againGood';

export const ANSWER_BUTTON_CHOICES: { value: AnswerButtons; label: string; hint: string }[] = [
  { value: 'all', label: 'Again, Hard, Good, Easy', hint: 'All four, as in Anki.' },
  { value: 'againGoodEasy', label: 'Again, Good, Easy', hint: 'No Hard. Easy pushes a card you know well further out.' },
  { value: 'againGood', label: 'Again and Good', hint: 'Forgot or remembered.' },
];

export function ratingsShown(choice: AnswerButtons): RatingValue[] {
  return choice === 'againGood' ? [1, 3] : choice === 'againGoodEasy' ? [1, 3, 4] : [1, 2, 3, 4];
}

/** A stored setting read back; anything unrecognized is the default, all four. */
export function parseAnswerButtons(raw: string | null | undefined): AnswerButtons {
  return raw === 'againGood' || raw === 'againGoodEasy' ? raw : 'all';
}
