import { Stack } from 'expo-router';
import React, { useState } from 'react';
import { TEXT_SIZE_LABELS, TEXT_SIZES, type TextSize } from '../../reader/fonts';
import { prefs, savePrefs } from '../../reader/storage';

/**
 * The text size of a cram's talking points: Read & Listen's own text size (the reader's menu sets the
 * same one), so a choice here and there agree.
 */
export function useTalkSize(): [TextSize, (size: TextSize) => void] {
  const [size, setSize] = useState<TextSize>(prefs().textSize);
  return [size, (next) => { savePrefs({ textSize: next }); setSize(next); }];
}

/** The header's Text size menu. A plain function called inside a `Stack.Toolbar`, which drops any other child. */
export function talkSizeMenu(size: TextSize, choose: (size: TextSize) => void) {
  return (
    <Stack.Toolbar.Menu icon="textformat.size" title="Text size">
      {TEXT_SIZES.map((s) => (
        <Stack.Toolbar.MenuAction key={s} isOn={size === s} onPress={() => choose(s)}>{TEXT_SIZE_LABELS[s]}</Stack.Toolbar.MenuAction>
      ))}
    </Stack.Toolbar.Menu>
  );
}
