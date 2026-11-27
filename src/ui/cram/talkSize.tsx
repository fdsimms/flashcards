import React, { useState } from 'react';
import { type TextSize } from '../../reader/fonts';
import { prefs, savePrefs } from '../../reader/storage';
import { textMenu, type TextFont } from '../textMenu';

/**
 * The text size of a cram's talking points: Read & Listen's own text size (the reader's menu sets the
 * same one), so a choice here and there agree.
 */
export function useTalkSize(): [TextSize, (size: TextSize) => void] {
  const [size, setSize] = useState<TextSize>(prefs().textSize);
  return [size, (next) => { savePrefs({ textSize: next }); setSize(next); }];
}

/**
 * The header's Text menu: the font for the cram's language, and the talking points' size. A plain
 * function called inside a `Stack.Toolbar`, which drops any other child.
 */
export function talkSizeMenu(size: TextSize, choose: (size: TextSize) => void, text: TextFont) {
  return textMenu(text, { value: size, onChange: choose });
}
