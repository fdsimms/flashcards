// The reader's settings that last between launches: playback speed, whether words outside the
// deck are highlighted, whether names are shaded, which of the other marks the reader switched off (the key), whether a story with paragraphs is shown as paragraphs, which Thai letters it's drawn in, how big the text is,
// whether the word being spoken is lit as a line plays (useSpokenWords), and whether the deck list's
// counts are sent to the server for dundundun (useCountsReport), and whether the check after reading shows its questions' English, and whether a tapped word's meaning waits to be asked for (guessFirst) and, for a word in the deck, behind a multiple-choice question (quizKnown), and whether a new text opens with its words hidden until it's been heard through (listenFirst), and then twice (listenTwice), and how many times a finished text is offered to hear again (listenAgain). Pure, so it's tested; storage.ts keeps them in the Keychain.
import { TEXT_SIZES, THAI_FONTS, type TextSize, type ThaiFont } from './fonts';
import { HIDEABLE, type HideableMark } from './marks';
import { RATES } from './playbackRate';

/** How many times a finished text is offered to hear again: never, once (3 days on) or three times (1, 4 and 10 days). */
export type ListenAgain = 0 | 1 | 3;
export const LISTEN_AGAIN: readonly ListenAgain[] = [0, 1, 3];

export type Prefs = { rate: number; highlight: boolean; markNames: boolean; paragraphs: boolean; thaiFont: ThaiFont; textSize: TextSize; followWords: boolean; shareCounts: boolean; hiddenMarks: HideableMark[]; checkEnglish: boolean; guessFirst: boolean; quizKnown: boolean; listenFirst: boolean; listenTwice: boolean; listenAgain: ListenAgain };

// Sending counts is a network call nobody tapped for, so it's off until turned on (CLAUDE.md, Data flow).
export const DEFAULT_PREFS: Prefs = { rate: 0.9, highlight: false, markNames: true, paragraphs: true, thaiFont: 'looped', textSize: 'default', followWords: true, shareCounts: false, hiddenMarks: [], checkEnglish: false, guessFirst: true, quizKnown: false, listenFirst: false, listenTwice: false, listenAgain: 1 };

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
    textSize: TEXT_SIZES.find((s) => s === saved.textSize) ?? DEFAULT_PREFS.textSize,
    followWords: typeof saved.followWords === 'boolean' ? saved.followWords : DEFAULT_PREFS.followWords,
    shareCounts: typeof saved.shareCounts === 'boolean' ? saved.shareCounts : DEFAULT_PREFS.shareCounts,
    hiddenMarks: Array.isArray(saved.hiddenMarks) ? HIDEABLE.filter((m) => (saved.hiddenMarks as unknown[]).includes(m)) : DEFAULT_PREFS.hiddenMarks,
    checkEnglish: typeof saved.checkEnglish === 'boolean' ? saved.checkEnglish : DEFAULT_PREFS.checkEnglish,
    guessFirst: typeof saved.guessFirst === 'boolean' ? saved.guessFirst : DEFAULT_PREFS.guessFirst,
    quizKnown: typeof saved.quizKnown === 'boolean' ? saved.quizKnown : DEFAULT_PREFS.quizKnown,
    listenFirst: typeof saved.listenFirst === 'boolean' ? saved.listenFirst : DEFAULT_PREFS.listenFirst,
    listenTwice: typeof saved.listenTwice === 'boolean' ? saved.listenTwice : DEFAULT_PREFS.listenTwice,
    listenAgain: LISTEN_AGAIN.find((n) => n === saved.listenAgain) ?? DEFAULT_PREFS.listenAgain,
  };
}
