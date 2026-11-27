import { type TextSize } from '../../reader/fonts';
import { textMenu, useTextSize, type TextFont } from '../textMenu';

/** The text size of a cram's talking points: Read & Listen's own, shared with every other screen (`useTextSize`). */
export const useTalkSize = useTextSize;

/**
 * The header's Text menu: the font for the cram's language, and the talking points' size. A plain
 * function called inside a `Stack.Toolbar`, which drops any other child.
 */
export function talkSizeMenu(size: TextSize, choose: (size: TextSize) => void, text: TextFont) {
  return textMenu(text, { value: size, onChange: choose });
}
