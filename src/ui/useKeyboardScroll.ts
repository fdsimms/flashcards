import { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, TextInput, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native';
import { space } from './theme';

/**
 * Keyboard handling for a ScrollView of fields, in place of `automaticallyAdjustKeyboardInsets`:
 * under the transparent header iOS picked a scroll position that overshot (a field at the top of
 * the page was pushed up under the header), and picked it again on every re-render.
 *
 * Spread `scrollProps` on the ScrollView and add `bottomPadding` to its content's paddingBottom.
 * The padding is the keyboard's height while it is up; the focused field is then scrolled only as
 * far as it takes to clear the keyboard, never when it already does. A field focused by code
 * (`.focus()`) while the keyboard is already up isn't followed.
 */
export function useKeyboardScroll() {
  const ref = useRef<ScrollViewInstance>(null);
  const offset = useRef(0);
  const height = useRef(0);
  const [keyboard, setKeyboard] = useState(0);

  const reveal = useCallback(() => {
    const input = TextInput.State.currentlyFocusedInput();
    if (!input || !ref.current || height.current === 0) return;
    input.measureInWindow((_x, y, _w, h) => {
      const overlap = y + h + space.m - (Dimensions.get('window').height - height.current);
      if (overlap > 0) ref.current?.scrollTo({ y: offset.current + overlap, animated: true });
    });
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', (e) => { height.current = e.endCoordinates.height; setKeyboard(height.current); });
    // The padding is laid out by the time the keyboard has finished showing, so the scroll has room.
    const shown = Keyboard.addListener('keyboardDidShow', reveal);
    const hide = Keyboard.addListener('keyboardWillHide', () => { height.current = 0; setKeyboard(0); });
    return () => { show.remove(); shown.remove(); hide.remove(); };
  }, [reveal]);

  return {
    bottomPadding: keyboard,
    scrollProps: {
      ref,
      scrollEventThrottle: 16,
      onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => { offset.current = e.nativeEvent.contentOffset.y; },
      // Tapping another field with the keyboard already up shows no keyboard event.
      onTouchEnd: () => { if (height.current > 0) setTimeout(reveal, 150); },
    },
  };
}
