import { useEffect, useState } from 'react';
import { Keyboard, LayoutAnimation, Platform } from 'react-native';

/**
 * The keyboard's height while it is up, else 0, for a screen that pads itself by it (a footer
 * with a typing box). The change is laid out with the keyboard's own duration and curve:
 * without that the padding lands in one frame while the keyboard is still sliding, and the
 * card shrinks and its content re-centers in a visible jump.
 */
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const move = (height: number, duration: number) => {
      if (Platform.OS === 'ios' && duration > 0) {
        LayoutAnimation.configureNext({ duration, update: { type: LayoutAnimation.Types.keyboard } });
      }
      setInset(height);
    };
    const show = Keyboard.addListener('keyboardWillShow', (e) => move(e.endCoordinates.height, e.duration));
    const hide = Keyboard.addListener('keyboardWillHide', (e) => move(0, e.duration));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return inset;
}
