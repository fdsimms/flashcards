import { useColorScheme } from 'react-native';

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
  textTertiary: '#9a9da4',
  border: '#e3dfd4',
  accent: '#8a6d1f',
  /** Text and icons drawn on an accent-colored fill. */
  onAccent: '#ffffff',
  danger: '#b3443b',
  warning: '#b7791f',
  countNew: '#2f6db5',
  countLearn: '#b5473f',
  countDue: '#3d7a52',
  again: '#c4554c',
  hard: '#c98a3a',
  good: '#4a9063',
  easy: '#4a80bd',
  /** Text on the four rating buttons. */
  onRating: '#ffffff',
  /**
   * A chart's bars (Stats): the accent's gold, stepped to pass the dataviz checks for a data mark
   * (lightness band, chroma floor, 3:1 against the surface) in each mode.
   */
  chart: '#9a7210',
  /** A quiet accent fill: a chosen word, a practice word's chip, speaker A in Read & Listen. */
  accentFill: 'rgba(138, 109, 31, 0.13)',
  /** Speaker B's badge in Read & Listen, and the text on it. */
  speakerB: '#d2e6db',
  onSpeakerB: '#24563f',
  /** Behind a word that isn't in the deck, when Read & Listen highlights them. */
  highlight: '#fbe2b0',
  /** Under a popover that floats over the page. */
  shadow: 'rgba(27, 27, 27, 0.18)',
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
  hard: '#a8742f',
  good: '#3d7a52',
  easy: '#3a6ea5',
  onRating: '#ffffff',
  chart: '#b88d32',
  accentFill: 'rgba(212, 180, 106, 0.18)',
  speakerB: '#22392f',
  onSpeakerB: '#9fd6bb',
  highlight: '#4d3a14',
  shadow: 'rgba(0, 0, 0, 0.6)',
};

export type Colors = typeof light;

export function useTheme(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Spacing, doubling-ish from 4. Use these for padding, margin and gap. */
export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;

export const radius = { s: 8, m: 12, l: 16, pill: 999 } as const;

/**
 * Text sizes, after iOS's own text styles. Text still grows with the system text size, so a
 * box holding text never gets a fixed height: give it padding or a minHeight instead.
 */
export const type = {
  largeTitle: { fontSize: 32, fontWeight: '700' },
  title: { fontSize: 22, fontWeight: '700' },
  headline: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 17 },
  callout: { fontSize: 16 },
  subhead: { fontSize: 15 },
  footnote: { fontSize: 13 },
  caption: { fontSize: 12 },
  /** The word or question on a card. */
  cardFront: { fontSize: 34, fontWeight: '600' },
  cardBack: { fontSize: 26, fontWeight: '600' },
} as const;

/** The smallest a tap target gets, per Apple's guidelines. */
export const MIN_TAP = 44;
