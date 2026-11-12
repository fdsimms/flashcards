import { StyleSheet, useColorScheme } from 'react-native';

/**
 * The design tokens. Screens take every color, gap, corner and text size from here, never a
 * literal: a hard-coded '#fff' is the one that stays white on a dark background.
 *
 * Warm paper and gold in light mode, near-black and the same gold in dark. Card counts follow
 * Anki's colors so they read the same at a glance: new is blue, learning red, due green.
 */

const light = {
  bg: '#f6f4ef',
  surface: '#ffffff',
  /** A quieter fill inside a surface: chips, inputs, the guide line of a subdeck. */
  fill: '#efebe2',
  text: '#1b1b1b',
  textSecondary: '#5f636b',
  /** Icons, chevrons and a count of zero: things meant to recede, at 3:1 (WCAG's floor for icons). Words that carry information use textSecondary. */
  textTertiary: '#898c95',
  border: '#e3dfd4',
  accent: '#876a1e',
  /** Text and icons drawn on an accent-colored fill. */
  onAccent: '#ffffff',
  danger: '#b3443b',
  warning: '#99651a',
  countNew: '#2f6db5',
  countLearn: '#b5473f',
  countDue: '#3d7a52',
  again: '#c35249',
  hard: '#c98a3a',
  good: '#43835a',
  easy: '#4279b6',
  /** Text on the rating buttons. Hard's amber is too light for white (2.9:1), so it has its own. */
  onRating: '#ffffff',
  onHard: '#1b1407',
  /**
   * A chart's bars (Stats): the accent's gold, stepped to pass the dataviz checks for a data mark
   * (lightness band, chroma floor, 3:1 against the surface) in each mode.
   */
  chart: '#9a7210',
  /**
   * A heatmap's shades, fewest to most (the Stats calendar); a day with none is `fill`. One gold
   * ramp, stepped light to dark here and dark to light in dark mode, each step at 2:1 or more
   * against the surface (checked with the dataviz skill's ordinal ramp validator).
   */
  heat: ['#d2ae52', '#b8922c', '#8f6a0e', '#5f4504'],
  /** A quiet accent fill: a chosen word, a practice word's chip, speaker A in Read & Listen. */
  accentFill: 'rgba(138, 109, 31, 0.13)',
  /** Speaker B's badge in Read & Listen, and the text on it. */
  speakerB: '#d2e6db',
  onSpeakerB: '#24563f',
  /** Behind a word that isn't in the deck, when Read & Listen highlights them. */
  highlight: '#fbe2b0',
  /** Behind a name in a Read & Listen text (Mali, Kasia), when names are marked. */
  nameFill: '#cfe3f2',
  /** A soft drop shadow under a raised surface (the review card). Near-invisible on dark, so it's heavier there. */
  shadow: '#2a2113',
  shadowOpacity: 0.08,
  /** Anki's card flags, 1 to 7: red, orange, green, blue, pink, turquoise, purple (index 0 unused). */
  flags: ['', '#d0453f', '#d8792a', '#3e9354', '#3a78c9', '#cc5fae', '#22999a', '#8656c8'],
};

const dark: typeof light = {
  bg: '#0f1115',
  surface: '#1a1d24',
  fill: '#242833',
  text: '#f1f1f1',
  textSecondary: '#a2a8b3',
  textTertiary: '#6c727d',
  border: '#2a2e38',
  accent: '#d4b46a',
  // Gold is light in dark mode, so what sits on it is dark.
  onAccent: '#1b1407',
  danger: '#e0766c',
  warning: '#e0a85a',
  countNew: '#6fa8ec',
  countLearn: '#e0766c',
  countDue: '#6cc08a',
  again: '#b5473f',
  hard: '#9d6c2c',
  good: '#3d7a52',
  easy: '#3a6ea5',
  onRating: '#ffffff',
  onHard: '#ffffff',
  chart: '#b88d32',
  heat: ['#614e20', '#87692a', '#b38f3e', '#e6c270'],
  accentFill: 'rgba(212, 180, 106, 0.18)',
  speakerB: '#22392f',
  onSpeakerB: '#9fd6bb',
  highlight: '#4d3a14',
  nameFill: '#1f3a4f',
  shadow: '#000000',
  shadowOpacity: 0.45,
  flags: ['', '#ee6b63', '#f0984f', '#62bd7b', '#6ba2ec', '#e486cb', '#4cc4c4', '#a989e6'],
};

export type Colors = typeof light;

export function useTheme(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Spacing, doubling-ish from 4. Use these for padding, margin and gap. */
export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;

export const radius = { s: 8, m: 12, l: 16, xl: 22, pill: 999 } as const;

/**
 * Spread into any rounded box. iOS's own corners are continuous curves, not circular arcs; the
 * difference is small and is the first thing that makes a rounded rectangle look hand-made.
 */
export const smooth = { borderCurve: 'continuous' } as const;

/** The thinnest line the screen can draw: a row separator or the edge of a group. */
export const hairline = StyleSheet.hairlineWidth;

/** A raised surface's shadow, from the theme's two shadow tokens. */
export function lift(c: Colors, depth: 'low' | 'high' = 'low') {
  return {
    shadowColor: c.shadow,
    shadowOpacity: c.shadowOpacity * (depth === 'high' ? 1.5 : 1),
    shadowRadius: depth === 'high' ? 18 : 8,
    shadowOffset: { width: 0, height: depth === 'high' ? 6 : 2 },
  } as const;
}

/**
 * Text sizes, after iOS's own text styles. Text still grows with the system text size, so a
 * box holding text never gets a fixed height: give it padding or a minHeight instead.
 */
export const type = {
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: 0.4 },
  title: { fontSize: 22, fontWeight: '700' },
  headline: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 17 },
  callout: { fontSize: 16 },
  subhead: { fontSize: 15 },
  footnote: { fontSize: 13 },
  caption: { fontSize: 12 },
  /** A small all-caps label over a group or a field on a card. */
  overline: { fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  /** The word or question on a card. */
  cardFront: { fontSize: 34, fontWeight: '600' },
  cardBack: { fontSize: 26, fontWeight: '600' },
} as const;

/** The smallest a tap target gets, per Apple's guidelines. */
export const MIN_TAP = 44;
