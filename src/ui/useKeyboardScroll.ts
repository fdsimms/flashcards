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
  // The field the scroll last followed: a touch that leaves the focus where it was (a scroll, say)
  // must not scroll back to it, or the page can't be pulled up to what's above the field.
  const followed = useRef<unknown>(null);

  const reveal = useCallback(() => {
    const input = TextInput.State.currentlyFocusedInput();
    if (!input || !ref.current || height.current === 0) return;
    followed.current = input;
    // The field clears the keyboard, or the scroll view's own bottom edge when that's higher: a
    // screen that shrinks above the keyboard puts its footer between the two.
    ref.current.measureInWindow((_sx, sy, _sw, sh) => {
      const visibleBottom = Math.min(sy + sh, Dimensions.get('window').height - height.current);
      input.measureInWindow((_x, y, _w, h) => {
        const overlap = y + h + space.m - visibleBottom;
        if (overlap > 0) ref.current?.scrollTo({ y: offset.current + overlap, animated: true });
      });
    });
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', (e) => { height.current = e.endCoordinates.height; setKeyboard(height.current); });
    // The padding is laid out by the time the keyboard has finished showing, so the scroll has room.
    const shown = Keyboard.addListener('keyboardDidShow', reveal);
    const clear = () => { height.current = 0; followed.current = null; setKeyboard(0); };
    const hide = Keyboard.addListener('keyboardWillHide', clear);
    // A focused field that unmounts (the drill's Type field when Pick is chosen) can dismiss the keyboard without a "will hide", which left its height as padding under the screen.
    const hidden = Keyboard.addListener('keyboardDidHide', clear);
    return () => { show.remove(); shown.remove(); hide.remove(); hidden.remove(); };
  }, [reveal]);

  return {
    bottomPadding: keyboard,
    scrollProps: {
      ref,
      scrollEventThrottle: 16,
      onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => { offset.current = e.nativeEvent.contentOffset.y; },
      // Tapping another field with the keyboard already up shows no keyboard event.
      onTouchEnd: () => {
        if (height.current > 0) setTimeout(() => { if (TextInput.State.currentlyFocusedInput() !== followed.current) reveal(); }, 150);
      },
    },
  };
}
