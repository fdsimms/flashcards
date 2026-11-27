import { cardTypeName } from './cardInfo';
import { studyDayStart } from './day';
import { htmlToText } from './html';
import { notePreview } from './noteEditing';
import { isBuried } from './queue';
import type { Card, Note, NoteType } from './types';

/**
 * A note as Browse's side panel shows it on a wide window (src/ui/BrowseNotePanel.tsx): every
 * field that has something in it, as plain text, and each of its cards with where it stands.
 * Pure, so it's tested; the row in the list is `notePreview`'s (noteEditing.ts).
 */
export interface NoteDetail {
  /** What the note's row shows first; empty for a note with nothing in that field. */
  title: string;
  fields: { name: string; value: string }[];
  cards: { id: string; type: string; state: string }[];
}

/**
 * Where a card stands, in a few words: out of study first (suspended, buried), then new, in
 * learning, due (today, for a review whose day has come) or due on a later day, which
 * `formatDay` writes. A review is due for its whole study day.
 */
export function cardStateLine(card: Card, now: Date, dayStartsAtHour: number, formatDay: (day: Date) => string): string {
  if (card.suspended) return 'Suspended';
  if (isBuried(card, now, dayStartsAtHour)) return 'Buried until tomorrow';
  const s = card.sched;
  if (s.state === 0) return 'New';
  if (s.state !== 2) return 'Learning';
  const day = studyDayStart(new Date(s.due), dayStartsAtHour);
  return day.getTime() <= studyDayStart(now, dayStartsAtHour).getTime() ? 'Due today' : `Due ${formatDay(day)}`;
}

export function noteDetail(note: Note, cards: Card[], noteType: NoteType | undefined, ctx: { now: Date; dayStartsAtHour: number; formatDay: (day: Date) => string }): NoteDetail {
  const text = (html: string) => htmlToText(html).replace(/\s+/g, ' ').trim();
  return {
    title: notePreview(note).front,
    fields: Object.entries(note.fields).map(([name, html]) => ({ name, value: text(html) })).filter((f) => f.value),
    // A card its note no longer makes (`retired`) isn't studied or listed, as in the row's markers.
    cards: cards.filter((c) => !c.retired).map((c) => ({ id: c.id, type: cardTypeName(c, noteType), state: cardStateLine(c, ctx.now, ctx.dayStartsAtHour, ctx.formatDay) })),
  };
}
