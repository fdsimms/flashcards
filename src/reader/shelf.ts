// The shelf's cards in words, and the small decisions the shelf and the reader's end view make
// (docs/read-and-listen/architecture.md, Shelf). Pure, so they're tested.
import type { Form, Length, Shelf, ShelfText } from './api';

// About how long a line takes to read and listen to, at a learner's pace with the audio.
const SECONDS_PER_LINE = 20;

/** Roughly how many minutes a text of `lines` lines takes; at least one. */
export function minutesFor(lines: number): number {
  return Math.max(1, Math.round((lines * SECONDS_PER_LINE) / 60));
}

const FORM_NAME: Record<Form, string> = { dialogue: 'Dialogue', story: 'Story' };

/** A card's second line: "Dialogue · 8 lines · 3 min". */
export function cardDetail(text: Pick<ShelfText, 'form' | 'lines'>): string {
  return `${FORM_NAME[text.form]} · ${text.lines} lines · ${minutesFor(text.lines)} min`;
}

/** Why a text is on the shelf, as its card says it. */
export function reasonLabel(text: ShelfText): string {
  switch (text.reason) {
    case 'due': {
      const n = text.stretch.length;
      return n === 0 ? 'Written around words due today' : `Uses ${n} ${n === 1 ? 'word' : 'words'} due today`;
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
      return text.liked ? `Because you liked "${text.topic}"` : text.topic;
  }
}

/** The texts Play all goes through, in order: the story's next episode, then the shelf. */
export function playOrder(shelf: Pick<Shelf, 'story' | 'texts'>): number[] {
  return [...(shelf.story?.next ? [shelf.story.next.id] : []), ...shelf.texts.map((t) => t.id)];
}

/** How long Play all takes, in minutes. */
export function playMinutes(shelf: Pick<Shelf, 'story' | 'texts'>): number {
  const texts = [...(shelf.story?.next ? [shelf.story.next] : []), ...shelf.texts];
  return texts.reduce((sum, t) => sum + minutesFor(t.lines), 0);
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
