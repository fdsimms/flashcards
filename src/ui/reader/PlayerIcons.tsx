import React from 'react';
import Svg, { Path } from 'react-native-svg';

/**
 * The player bar's Repeat line, Loop text and Start over icons. SF Symbols have no pair that tells
 * "this line" from "the whole text", so these are drawn on one grid (24 units, rounded 2-unit
 * strokes) and sit beside the SF Symbol buttons: one loop frame holding a single line for Repeat
 * line and a block of three for Loop text, and the restart arrow around a play triangle for
 * Start over. Decorative, like `Icon`: the button holding one carries the label.
 */

/** Two arrows chasing each other around a box: the same frame for the line and the text. */
const FRAME = 'M3 10V8.5A3.5 3.5 0 016.5 5H20M17.5 2.5L20 5l-2.5 2.5M21 14v1.5a3.5 3.5 0 01-3.5 3.5H4M6.5 21.5L4 19l2.5-2.5';

function Drawn({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {children}
    </Svg>
  );
}

/** Repeat line: the loop around one line. */
export function RepeatLineIcon({ size = 20, color }: { size?: number; color: string }) {
  return (
    <Drawn size={size}>
      <Path d={FRAME} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M8.5 12h7" stroke={color} strokeWidth={2.2} strokeLinecap="round" fill="none" />
    </Drawn>
  );
}

/** Loop text: the loop around a block of lines. */
export function LoopTextIcon({ size = 20, color }: { size?: number; color: string }) {
  return (
    <Drawn size={size}>
      <Path d={FRAME} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M8.5 9.8h7M8.5 12h7M8.5 14.2h4.5" stroke={color} strokeWidth={1.5} strokeLinecap="round" fill="none" />
    </Drawn>
  );
}

/** Start over: the counterclockwise arrow around a play triangle. */
export function StartOverIcon({ size = 20, color }: { size?: number; color: string }) {
  return (
    <Drawn size={size}>
      <Path d="M1.5 4v6h6M3.5 15a9 9 0 102.1-9.3L1.5 10" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M10 8.8v6.4l5.2-3.2z" fill={color} stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
    </Drawn>
  );
}
