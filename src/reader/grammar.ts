// The grammar row on the topics screen, each point's line on the Grammar screen, in words, and the
// points practiced in Read & Listen that Forms practice asks first (docs/grammar.md).
import { studyDayStart } from '../core/day';
import type { Api, GrammarChoice, GrammarPoint, GrammarSeen, GrammarState } from './api';

/** The three choices, as the Grammar screen and Explain offer them. */
export const GRAMMAR_CHOICES: { value: GrammarChoice; label: string }[] = [
  { value: 'practice', label: 'Practice' },
  { value: 'normal', label: 'Know it' },
  { value: 'avoid', label: "Don't know it" },
];

/** How many points a language may practice at once when the server doesn't say (its MAX_PRACTICE). */
export const DEFAULT_MAX_PRACTICE = 2;

/**
 * The choices for one point, with Practice turned off when `practicing` points already fill the
 * limit and this one isn't among them: the server refuses it, so it isn't offered.
 */
export function grammarChoiceOptions(name: string, state: GrammarState, practicing: number, max: number) {
  const full = state !== 'practice' && practicing >= max;
  return GRAMMAR_CHOICES.map((s) => ({ ...s, accessibilityLabel: `${name}: ${s.label}`, disabled: s.value === 'practice' && full }));
}

/** A point's choice in a word or two, beside its name: "Preterite · Practicing". */
export function grammarStateWord(state: GrammarState): string {
  return { practice: 'Practicing', normal: 'Know it', avoid: "Don't know it", unset: 'Not set' }[state];
}

const plural = (n: number) => (n === 1 ? 'point' : 'points');
const times = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function grammarSummary(points: GrammarPoint[]): string {
  if (points.length === 0) return 'None for this language yet';
  const practicing = points.filter((p) => p.state === 'practice').length;
  const unknown = points.filter((p) => p.state === 'avoid').length;
  const parts = [
    practicing > 0 ? `Practicing ${practicing} ${plural(practicing)}` : null,
    unknown > 0 ? `${unknown} not known yet` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'Nothing chosen';
}

/** "today", "yesterday", "9 days ago", by study days. */
function daysAgo(at: Date, now: Date, dayStartsAtHour: number): string {
  const days = Math.round((studyDayStart(now, dayStartsAtHour).getTime() - studyDayStart(at, dayStartsAtHour).getTime()) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * How often a point came up in the texts read to the end, for under its name: "In 9 texts you
 * read (23 times), last today". `brief` leaves out the count of uses (the "Seen least" card).
 * Null when the server sent no counts (one older than them).
 */
export function seenLine(
  seen: GrammarSeen | undefined,
  state: GrammarState,
  now: Date,
  dayStartsAtHour: number,
  brief = false,
): string | null {
  if (!seen) return null;
  const when = seen.last ? daysAgo(new Date(seen.last), now, dayStartsAtHour) : null;
  if (state === 'avoid') {
    return seen.texts === 0 || !when
      ? 'Kept out of texts'
      : `Kept out of texts. Slipped into ${times(seen.texts, 'text', 'texts')} you read, last ${when}`;
  }
  const line = seen.texts === 0 || !when
    ? "Not in any text you've read yet"
    : `In ${times(seen.texts, 'text', 'texts')} you read${brief ? '' : ` (${times(seen.uses, 'time', 'times')})`}, last ${when}`;
  return state === 'unset' ? `Not set. ${line}` : line;
}

/** How long Forms practice waits for the choices before going on without them. */
export const CHOICES_WAIT_MS = 3000;

/**
 * The ids of the points set to Practice, in every language, for Forms practice. Empty with Read &
 * Listen off, when its server can't be reached, or after `waitMs`: practice then goes on as it
 * would without them, rather than waiting on the network.
 */
export async function practicingPoints(api: Pick<Api, 'grammarChoices'> | null, waitMs = CHOICES_WAIT_MS): Promise<Set<string>> {
  if (!api) return new Set();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), waitMs); });
  try {
    const got = await Promise.race([api.grammarChoices().catch(() => null), late]);
    return new Set(Object.entries(got?.choices ?? {}).filter(([, state]) => state === 'practice').map(([id]) => id));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * An example line split so the words the server's finder matched can be underlined: each match
 * found in turn, ignoring case (the server lowercases a spaced language's words), from where the
 * last one ended. A match it can't find is left out rather than guessed at.
 */
export function markedParts(line: string, words: string[]): { text: string; marked: boolean }[] {
  const out: { text: string; marked: boolean }[] = [];
  const lower = line.toLocaleLowerCase();
  let at = 0;
  for (const w of words) {
    const i = w ? lower.indexOf(w.toLocaleLowerCase(), at) : -1;
    if (i < 0 || w.toLocaleLowerCase().length !== w.length) continue;
    if (i > at) out.push({ text: line.slice(at, i), marked: false });
    out.push({ text: line.slice(i, i + w.length), marked: true });
    at = i + w.length;
  }
  if (at < line.length) out.push({ text: line.slice(at), marked: false });
  return out;
}
