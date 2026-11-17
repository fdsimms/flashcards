import { StyleSheet, useColorScheme } from 'react-native';

/**
 * The design tokens. Screens take every color, gap, corner and text size from here, never a
 * literal: a hard-coded '#fff' is the one that stays white on a dark background.
 *
 * Warm paper and gold in light mode, near-black and the same gold in dark. Card counts follow
 * Anki's colors so they read the same at a glance: new is blue, due green, learning red. The deck
 * list counts learning cards in due; Review shows them apart, in `countLearn`.
 */

const light = {
  bg: '#f6f4ef',
  surface: '#ffffff',
  /** A quieter fill inside a surface: chips, inputs, the guide line of a subdeck. */
  fill: '#efebe2',
  /** Something floating over a surface (the change-rating strip over the review card): set apart from it by its fill and edge, not only its shadow. */
  raised: '#f1ede4',
  raisedEdge: '#d6d0c2',
  text: '#1b1b1b',
  textSecondary: '#5f636b',
  /** Icons, chevrons and a count of zero: things meant to recede, at 3:1 (WCAG's floor for icons). Words that carry information use textSecondary. */
  textTertiary: '#898c95',
  /** Words that are quiet but still say something (a count of zero, an unselected wheel value), at 4.5:1 on the screen and its wells. Not for icons: those use textTertiary. */
  textDim: '#656972',
  /** The edge of a control whose fill alone is too faint to show its shape (a secondary button): about 3:1 on the screen and on a card, WCAG's floor for a control's boundary. */
  controlEdge: '#8c887c',
  border: '#e3dfd4',
  accent: '#876a1e',
  /** Text and icons drawn on an accent-colored fill. */
  onAccent: '#ffffff',
  danger: '#b3443b',
  warning: '#99651a',
  countNew: '#2f6db5',
  /** A quiet fill behind a new card's chip, in the new count's blue. */
  countNewFill: 'rgba(47, 109, 181, 0.12)',
  /** A quiet fill behind a learning card's chip, in the learning count's red. */
  countLearnFill: 'rgba(181, 71, 63, 0.12)',
  countLearn: '#b5473f',
  countDue: '#3d7a52',
  again: '#c35249',
  hard: '#c98a3a',
  good: '#43835a',
  easy: '#4279b6',
  /** Text on the rating buttons. Hard's amber is too light for white (2.9:1), so it has its own. */
  onRating: '#ffffff',
  onHard: '#1b1407',
  /** A settings tile with no rating color to borrow (WaniKani's), white on it as on the rating tiles. */
  violet: '#7a4fb5',
  /** More settings or Practice tiles with no rating color to borrow (Numbers', Counting things', Reading the script's, Similar words'), white on them too. */
  orange: '#b0601e',
  teal: '#2f7d7a',
  rose: '#b23a6a',
  indigo: '#4a55b0',
  /** A grammar point being practiced: its chip's text and fill, in the Grammar tool's violet. */
  violetInk: '#6b43a3',
  violetFill: 'rgba(122, 79, 181, 0.12)',
  /**
   * Text in the good or the warning color, on its fill or on a surface (a known or a not-known grammar point's tag, the right letters of a typed answer).
   * `good` is a button's fill, under 4.5:1 as text in dark mode, and `warning` is under it on `warningFill` in light mode.
   */
  goodInk: '#2f6a45',
  warningInk: '#7a4f12',
  /**
   * The soft tile behind a deck's emoji on the deck list, one per deck (`deckTint`): the tile colors
   * above (orange, rose, blue, teal, indigo, red, violet, green), faint enough that the emoji reads on any of them.
   */
  deckTints: [
    'rgba(176, 96, 30, 0.15)', 'rgba(178, 58, 106, 0.15)', 'rgba(66, 121, 182, 0.15)', 'rgba(47, 125, 122, 0.15)',
    'rgba(74, 85, 176, 0.15)', 'rgba(195, 82, 73, 0.15)', 'rgba(122, 79, 181, 0.15)', 'rgba(67, 131, 90, 0.15)',
  ],
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
  /**
   * Counting money's banknotes, largest first, and its coins: plain tints with the amount on,
   * never a picture of a real note. `onCash` is the amount's color on any of them.
   */
  cashNotes: ['#d9cdf0', '#f3c6bf', '#c4d7f2', '#c8e6cf', '#f2deb0', '#e3d6c6', '#d6e3e6'],
  cashCoin: '#dcd8cf',
  onCash: '#1b1b1b',
  /** A quiet accent fill: a chosen word, a practice word's chip, speaker A in Read & Listen. */
  accentFill: 'rgba(138, 109, 31, 0.13)',
  /** Quiet fills for a right and a wrong choice once it's marked (the vocabulary check). */
  goodFill: 'rgba(67, 131, 90, 0.15)',
  dangerFill: 'rgba(179, 68, 59, 0.12)',
  /** A quiet amber fill: a note that something is off but not wrong (a line that sounds stiff). */
  warningFill: 'rgba(153, 101, 26, 0.13)',
  /** Speaker B's badge in Read & Listen, and the text on it. */
  speakerB: '#d2e6db',
  onSpeakerB: '#24563f',
  /**
   * Read & Listen's drawn characters (reader/characters.ts): a face and clothes in a softer tone
   * of the speaker's color, opaque so they read the same on any row, and the white-ish of an apron
   * or a stethoscope. The strongest tone (hair, details) is the badge's own text color.
   */
  speakerAFace: '#c3b48f',
  speakerABody: '#ac9763',
  speakerBFace: '#90afa0',
  speakerBBody: '#668d7a',
  characterWhite: '#ffffff',
  /** Behind a word that isn't in the deck, when Read & Listen highlights them. */
  highlight: '#fbe2b0',
  /** Behind a name in a Read & Listen text (Mali, Kasia), when names are marked. */
  nameFill: '#cfe3f2',
  /** Behind the word being spoken as a Read & Listen line plays. */
  spoken: '#e4ddcb',
  /**
   * WaniKani's three kinds of subject, each a solid fill: a card is filled with its own kind's
   * color, and a "Made of" tile with its part's kind. White (`onWk`) is on all of them.
   */
  wkRadical: '#0b6fc4',
  wkKanji: '#c8157f',
  wkVocab: '#8a2be2',
  onWk: '#ffffff',
  /** Quieter white on those fills (labels, secondary text), and the lines and wells drawn on them. */
  onWkSoft: 'rgba(255, 255, 255, 0.86)',
  wkLine: 'rgba(255, 255, 255, 0.3)',
  wkWell: 'rgba(0, 0, 0, 0.2)',
  /**
   * The band across a WaniKani card's foot that says what's asked: light for the meaning, dark for
   * the reading, as on wanikani.com and its iOS clients, so the kind of question reads at a glance.
   * The same in both themes, since the convention is the cue.
   */
  wkMeaningBand: '#f1f1f1',
  onWkMeaningBand: '#333333',
  wkReadingBand: '#2a2a2a',
  onWkReadingBand: '#ffffff',
  /** Grammatical gender, as the color of a word's article (and a dot on its chip): masculine, feminine, neuter. Text colors, so none is red, green or blue like a card count. */
  genderM: '#4a55b0',
  genderF: '#b23a6a',
  genderN: '#2f7d7a',
  /** Thai tones, as the color of a syllable in a romanization (mid has none): low, falling, high, rising. */
  toneLow: '#2f6db5',
  toneFalling: '#b5473f',
  toneHigh: '#b0601e',
  toneRising: '#3d7a52',
  /** The outline of WaniKani's stage popup: on a white card its colored pill needs one to stand out, on dark it doesn't. */
  stageRing: 'rgba(27, 27, 27, 0.4)',
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
  raised: '#272b36',
  raisedEdge: '#3a3f4c',
  text: '#f1f1f1',
  textSecondary: '#a2a8b3',
  textTertiary: '#6c727d',
  textDim: '#8a909b',
  controlEdge: '#6e7480',
  border: '#2a2e38',
  accent: '#d4b46a',
  // Gold is light in dark mode, so what sits on it is dark.
  onAccent: '#1b1407',
  danger: '#e0766c',
  warning: '#e0a85a',
  countNew: '#6fa8ec',
  countNewFill: 'rgba(111, 168, 236, 0.16)',
  countLearnFill: 'rgba(224, 118, 108, 0.16)',
  countLearn: '#e0766c',
  countDue: '#6cc08a',
  again: '#b5473f',
  hard: '#9d6c2c',
  good: '#3d7a52',
  easy: '#3a6ea5',
  onRating: '#ffffff',
  onHard: '#ffffff',
  violet: '#694595',
  orange: '#9a521a',
  teal: '#2a6e6b',
  rose: '#9c3560',
  indigo: '#434c9c',
  violetInk: '#c4a6f0',
  violetFill: 'rgba(150, 110, 210, 0.24)',
  goodInk: '#6cc08a',
  warningInk: '#e0a85a',
  deckTints: [
    'rgba(176, 96, 30, 0.3)', 'rgba(178, 58, 106, 0.3)', 'rgba(66, 121, 182, 0.3)', 'rgba(47, 125, 122, 0.3)',
    'rgba(74, 85, 176, 0.3)', 'rgba(195, 82, 73, 0.3)', 'rgba(122, 79, 181, 0.3)', 'rgba(67, 131, 90, 0.3)',
  ],
  chart: '#b88d32',
  heat: ['#614e20', '#87692a', '#b38f3e', '#e6c270'],
  cashNotes: ['#4b3f66', '#6a3f38', '#34496a', '#365a40', '#665a33', '#5a4b3c', '#3b5357'],
  cashCoin: '#4a4e57',
  onCash: '#f1f1f1',
  accentFill: 'rgba(212, 180, 106, 0.18)',
  goodFill: 'rgba(95, 176, 124, 0.18)',
  dangerFill: 'rgba(224, 118, 108, 0.16)',
  warningFill: 'rgba(224, 168, 90, 0.16)',
  speakerB: '#22392f',
  onSpeakerB: '#9fd6bb',
  speakerAFace: '#70613f',
  speakerABody: '#96814f',
  speakerBFace: '#517564',
  speakerBBody: '#6f9a86',
  characterWhite: '#e9e6df',
  highlight: '#4d3a14',
  nameFill: '#1f3a4f',
  spoken: '#3b4252',
  wkRadical: '#0a5a9e',
  wkKanji: '#a3106a',
  wkVocab: '#6b25b8',
  onWk: '#ffffff',
  onWkSoft: 'rgba(255, 255, 255, 0.86)',
  wkLine: 'rgba(255, 255, 255, 0.3)',
  wkWell: 'rgba(0, 0, 0, 0.22)',
  wkMeaningBand: '#f1f1f1',
  onWkMeaningBand: '#333333',
  wkReadingBand: '#2a2a2a',
  onWkReadingBand: '#ffffff',
  genderM: '#8f9bf0',
  genderF: '#e486a8',
  genderN: '#5fc4bf',
  toneLow: '#6fa8ec',
  toneFalling: '#e0766c',
  toneHigh: '#f0984f',
  toneRising: '#6cc08a',
  stageRing: 'transparent',
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
  /** Text the learner reads or writes in a sentence-length answer (typed or checked), a size up from the body. */
  reading: { fontSize: 20, lineHeight: 28 },
} as const;

/**
 * A screen's content column on a wide display (iPad): spread into a ScrollView's
 * `contentContainerStyle`. On an iPhone the screen is narrower than this, so nothing changes; on an
 * iPad the rows stop at a readable width, centered, as Review's card already does.
 */
export const readable = { width: '100%', maxWidth: 640, alignSelf: 'center' } as const;

/** The smallest a tap target gets, per Apple's guidelines. */
export const MIN_TAP = 44;
