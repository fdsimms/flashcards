import React, { useState } from 'react';
import { View } from 'react-native';
import { space } from './theme';

/** The height of a rating button, and of Show answer, Check and Type it, so flipping a card doesn't change the footer's height. */
export const FOOTER_BUTTON_HEIGHT = 60;

/** The Last answer line (44) and a footer button: the tallest the footer is in an ordinary session. */
const BASE_HEIGHT = 44 + space.s + FOOTER_BUTTON_HEIGHT;

/**
 * The review screen's footer, kept one height. Show answer, the rating buttons, a typed-answer box and
 * the Last answer line are all different heights, and the card above takes whatever's left, so its
 * bottom edge (and the gap to the buttons) moved at each answer and each new card. The footer reserves
 * room for the tallest state, and a taller one seen (larger text, the typing field) raises that for the
 * rest of the session. Content sits at the bottom, so the buttons stay where they are.
 */
export function ReviewFooter({ children }: { children: React.ReactNode }) {
  const [tallest, setTallest] = useState(0);
  return (
    <View
      onLayout={(e) => {
        const h = Math.ceil(e.nativeEvent.layout.height);
        setTallest((t) => (h > t ? h : t));
      }}
      style={{ minHeight: Math.max(BASE_HEIGHT, tallest), justifyContent: 'flex-end', gap: space.s }}
    >
      {children}
    </View>
  );
}
