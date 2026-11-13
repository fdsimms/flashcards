// The reader's settings that last between launches: playback speed, whether words outside the
// deck are highlighted, whether names are shaded, which of the other marks the reader switched off (the key), whether a story with paragraphs is shown as paragraphs, which Thai letters it's drawn in,
// whether the word being spoken is lit as a line plays (useSpokenWords), and whether the deck list's
// counts are sent to the server for dundundun (useCountsReport). Pure, so it's tested; storage.ts keeps them in the Keychain.
import { THAI_FONTS, type ThaiFont } from './fonts';
import { HIDEABLE, type HideableMark } from './marks';
import { RATES } from './playbackRate';

export type Prefs = { rate: number; highlight: boolean; markNames: boolean; paragraphs: boolean; thaiFont: ThaiFont; followWords: boolean; shareCounts: boolean; hiddenMarks: HideableMark[] };

// Sending counts is a network call nobody tapped for, so it's off until turned on (CLAUDE.md, Data flow).
export const DEFAULT_PREFS: Prefs = { rate: 0.9, highlight: false, markNames: true, paragraphs: true, thaiFont: 'looped', followWords: true, shareCounts: false, hiddenMarks: [] };

// Anything unreadable or out of range falls back to the default for that setting.
export function parsePrefs(raw: string | null): Prefs {
  let saved: Partial<Record<keyof Prefs, unknown>> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') saved = parsed as typeof saved;
  } catch {
    // Not JSON: use the defaults.
  }
  return {
    rate: typeof saved.rate === 'number' && RATES.includes(saved.rate) ? saved.rate : DEFAULT_PREFS.rate,
    highlight: typeof saved.highlight === 'boolean' ? saved.highlight : DEFAULT_PREFS.highlight,
    markNames: typeof saved.markNames === 'boolean' ? saved.markNames : DEFAULT_PREFS.markNames,
    paragraphs: typeof saved.paragraphs === 'boolean' ? saved.paragraphs : DEFAULT_PREFS.paragraphs,
    thaiFont: THAI_FONTS.find((f) => f === saved.thaiFont) ?? DEFAULT_PREFS.thaiFont,
    followWords: typeof saved.followWords === 'boolean' ? saved.followWords : DEFAULT_PREFS.followWords,
    shareCounts: typeof saved.shareCounts === 'boolean' ? saved.shareCounts : DEFAULT_PREFS.shareCounts,
    hiddenMarks: Array.isArray(saved.hiddenMarks) ? HIDEABLE.filter((m) => (saved.hiddenMarks as unknown[]).includes(m)) : DEFAULT_PREFS.hiddenMarks,
  };
}
