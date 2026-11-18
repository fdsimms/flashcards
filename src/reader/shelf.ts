// The shelf's cards in words, and the small decisions the shelf and the reader's end view make
// (docs/read-and-listen/architecture.md, Shelf). Pure, so they're tested.
import type { Form, GrammarList, Length, Shelf, ShelfStory, ShelfText, Suggestion } from './api';

// About how long a line takes to read and listen to, at a learner's pace with the audio.
const SECONDS_PER_LINE = 20;

/** Roughly how many minutes a text of `lines` lines takes; at least one. */
export function minutesFor(lines: number): number {
  return Math.max(1, Math.round((lines * SECONDS_PER_LINE) / 60));
}

const FORM_NAME: Record<Form, string> = { dialogue: 'Dialogue', story: 'Story' };

/** A card's length: "Dialogue · 3 min". */
export function cardDetail(text: Pick<ShelfText, 'form' | 'lines'>): string {
  return `${FORM_NAME[text.form]} · ${minutesFor(text.lines)} min`;
}

/**
 * Where the story card's episode falls, beside the story's name: "Episode 8 of 8 · Finale". From a
 * server older than seasons, the running episode number `episode`.
 */
export function episodeLabel(story: Pick<ShelfStory, 'season' | 'season_episode' | 'season_length'>, episode: number): string {
  const { season, season_episode: at, season_length: length } = story;
  if (!season || !at || !length) return `Episode ${episode}`;
  return `Episode ${at} of ${length}${at === length ? ' · Finale' : ''}`;
}

/** Why a text is on the shelf, as its card says it. */
export function reasonLabel(text: ShelfText): string {
  switch (text.reason) {
    case 'due': {
      // Only words already reviewed today: one read before its review would turn that review into
      // short-term recall (server/reader's stretch.py).
      const n = text.stretch.length;
      return n === 0 ? 'Written around words you reviewed today' : `Uses ${n} ${n === 1 ? 'word' : 'words'} you reviewed today`;
    }
    case 'liked':
      return `Because you liked "${text.topic}"`;
    case 'new':
      return 'Something new';
    case 'asked':
      return 'You asked for this';
    case 'story':
      return `Episode ${text.episode}`;
    default:
      // Written for a topic before the shelf existed.
      return text.topic;
  }
}

/**
 * What Up next's Play all goes through, over the list: "3 texts · 12 min". Only the list's texts:
 * the story's episode is played from its own card above. Null when the list is empty.
 */
export function upNextSummary(shelf: Pick<Shelf, 'texts'>): string | null {
  const n = shelf.texts.length;
  if (n === 0) return null;
  return `${n === 1 ? '1 text' : `${n} texts`} · ${playMinutes(shelf)} min`;
}

/** The texts Up next's Play all goes through, in order: the shelf's texts, never the story's episode. */
export function upNextOrder(shelf: Pick<Shelf, 'texts'>): number[] {
  return shelf.texts.map((t) => t.id);
}

/** The shelf's reading order, for Next and for downloads: the story's next episode, then the shelf. */
export function playOrder(shelf: Pick<Shelf, 'story' | 'texts'>): number[] {
  return [...(shelf.story?.next ? [shelf.story.next.id] : []), ...shelf.texts.map((t) => t.id)];
}

/** How long Play all takes, in minutes: the shelf's texts, without the story's episode. */
export function playMinutes(shelf: Pick<Shelf, 'texts'>): number {
  return shelf.texts.reduce((sum, t) => sum + minutesFor(t.lines), 0);
}

/** After `current`, the text to open next from `order`, or null at the end. */
export function nextInOrder(order: number[], current: number): number | null {
  const at = order.indexOf(current);
  return at >= 0 && at + 1 < order.length ? order[at + 1] : null;
}

export type LengthStep = 'shorter' | 'same' | 'longer';

const LENGTHS: Length[] = [6, 8, 12];

/** The length the next texts are written at after a step from `current`, held at the ends. */
export function stepLength(current: Length, step: LengthStep): Length {
  const at = LENGTHS.indexOf(current);
  const to = step === 'shorter' ? at - 1 : step === 'longer' ? at + 1 : at;
  return LENGTHS[Math.min(LENGTHS.length - 1, Math.max(0, to))];
}

export type GrammarStep = 'simpler' | 'same' | 'harder';

// How many times a text may use grammar not set: the server holds it between these (grammar.py).
const MIN_GRAMMAR_USES = 1;
const MAX_GRAMMAR_USES = 4;

/** The allowance the next texts are written with after a step from `current`, held at the ends. */
export function stepGrammarUses(current: number, step: GrammarStep): number {
  const to = step === 'simpler' ? current - 1 : step === 'harder' ? current + 1 : current;
  return Math.min(MAX_GRAMMAR_USES, Math.max(MIN_GRAMMAR_USES, to));
}

const timesOf = (n: number) => (n === 1 ? 'once' : `${n} times`);

/** What a step to `to` from `from` means for the texts written next; null when nothing changes. */
export function grammarStepNote(from: number, to: number, step: GrammarStep): string | null {
  if (step === 'same') return null;
  if (to === from) return `That's as ${step === 'harder' ? 'far' : 'low'} as it goes: ${timesOf(to)} a text.`;
  return `Texts can use grammar you haven't marked ${timesOf(to)}, ${to > from ? 'up' : 'down'} from ${from}.`;
}

/** Whether another point can be set to Practice now: at most `max_practice` at once. */
export function hasPracticeRoom(list: GrammarList): boolean {
  return list.points.filter((p) => p.state === 'practice').length < list.max_practice;
}

// Surprise me picks among this many of the best-fitting ideas, so it varies but stays readable.
const SURPRISE_POOL = 5;

/** The topic Surprise me writes on: one of the best-fitting `ideas`, chosen by `random` (0 up to
 * 1). Null when no idea is left. The form is the one the person chose before tapping it. */
export function surprisePick(ideas: Suggestion[], random: () => number): string | null {
  const pool = ideas.slice(0, SURPRISE_POOL);
  if (pool.length === 0) return null;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))].name;
}
