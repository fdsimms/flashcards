import { useHeaderHeight } from 'expo-router/react-navigation';
import { useCallback, useRef, useState, type ComponentRef } from 'react';
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
  return { ref, onLayout, top };
}
