import { useFocusEffect, useNavigation } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { View } from 'react-native';

/**
 * How far the native header covers the top of a plain (non-scrolling) screen. The stack lays the
 * screen's frame out from the top of the window and only a ScrollView with
 * `contentInsetAdjustmentBehavior` is moved below the header for you, so a fixed layout has its top
 * (the counts, the card's label) drawn under the header. Pad the screen's top by `top`: it's the
 * header's height less however far down the window the frame already starts, so it can't be applied
 * twice. Put `ref` and `onLayout` on the view that fills the screen.
 */
export function useHeaderInset() {
  const headerHeight = useHeaderHeight();
  const ref = useRef<ComponentRef<typeof View>>(null);
  const [top, setTop] = useState(0);
  const onLayout = useCallback(() => {
    ref.current?.measureInWindow((_x, y) => setTop(Math.max(0, headerHeight - y)));
  }, [headerHeight]);
  // onLayout alone isn't enough: the header's height is often 0 when the screen first lays out and
  // only settles afterward, with no new layout to trigger onLayout, so the inset stayed 0.
  useEffect(onLayout, [onLayout]);
  // A push from the deck list can measure the frame mid-transition, with the header's height not yet
  // settled, and nothing lays out again once it lands, leaving the inset at 0 and the screen's top
  // under the header. Measure again when the transition ends and whenever the screen regains focus.
  const navigation = useNavigation();
  useEffect(() => {
    const listen = navigation.addListener as (event: string, cb: () => void) => () => void;
    return listen.call(navigation, 'transitionEnd', onLayout);
  }, [navigation, onLayout]);
  useFocusEffect(onLayout);
  return { ref, onLayout, top };
}
