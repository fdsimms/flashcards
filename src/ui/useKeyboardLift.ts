import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Keyboard } from 'react-native';

/**
 * The keyboard's height above the safe area while it is up, else 0 (`pad`), and the same as an
 * animated value (`lift`) that follows the keyboard's own duration and curve. For a screen whose
 * typing box rides on the keyboard while the card behind it stays the size it is: the box and
 * whatever must stay readable are moved up with a transform by `lift`, and nothing is laid out
 * again, so nothing on the card re-centers or jumps. (`useKeyboardInset` pads the whole screen
 * instead, which resizes what is above it.)
 */
export function useKeyboardLift(bottomInset: number) {
  const [pad, setPad] = useState(0);
  const lift = useRef(new Animated.Value(0)).current;
  const inset = useRef(bottomInset);
  inset.current = bottomInset;
  useEffect(() => {
    const move = (height: number, duration: number) => {
      const to = Math.max(0, height - inset.current);
      setPad(to);
      Animated.timing(lift, { toValue: to, duration, easing: Easing.bezier(0.17, 0.59, 0.4, 0.77), useNativeDriver: true }).start();
    };
    const show = Keyboard.addListener('keyboardWillShow', (e) => move(e.endCoordinates.height, e.duration));
    const hide = Keyboard.addListener('keyboardWillHide', (e) => move(0, e.duration));
    return () => { show.remove(); hide.remove(); lift.stopAnimation(); };
  }, [lift]);
  return { pad, lift, up: Animated.multiply(lift, -1) };
}
