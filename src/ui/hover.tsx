import React from 'react';
import { Pressable, type PressableProps } from 'react-native';
import { GestureDetector, HoverEffect, useHoverGesture } from 'react-native-gesture-handler';

/**
 * Pointer feedback for a control, for an iPad or Mac with a trackpad or mouse. iOS draws it, not
 * us: `lift` is for a button, chip or tile (the pointer snaps onto it and it rises a little),
 * `highlight` for a row or anything that fills its width (a soft tint behind it). A touch screen
 * has no pointer, so on an iPhone this does nothing, and nothing may depend on it.
 *
 * Pass `none` for a control that is disabled, so it doesn't invite a tap it can't take. The effect
 * is a prop of one wrapper that is always there, rather than the wrapper coming and going, so a
 * control that enables or disables doesn't remount.
 *
 * The detector renders with `display: 'contents'`, so wrapping a control changes nothing in layout.
 */
export function Hoverable({ effect, children }: { effect: 'lift' | 'highlight' | 'none'; children: React.ReactElement }) {
  const hover = useHoverGesture({ effect: effect === 'lift' ? HoverEffect.LIFT : effect === 'highlight' ? HoverEffect.HIGHLIGHT : HoverEffect.NONE });
  return <GestureDetector gesture={hover}>{children}</GestureDetector>;
}

/**
 * A `Pressable` that gets the pointer effect, for a row or a tile a screen builds itself (a screen
 * reaches for `NavRow`, `CheckRow` or `Tappable` in `kit.tsx` first). A row takes the default,
 * `highlight`; a tile or a choice button with its own fill takes `lift`. It is `none` while
 * `disabled`. Leave a plain `Pressable` where a pointer effect would be noise: a backdrop that
 * dismisses, a tap anywhere on a card to reveal it, a word inside a sentence, a chart bar.
 */
export function HoverPressable({ hover = 'highlight', ...props }: PressableProps & { hover?: 'lift' | 'highlight' }) {
  return (
    <Hoverable effect={props.disabled ? 'none' : hover}>
      <Pressable {...props} />
    </Hoverable>
  );
}
