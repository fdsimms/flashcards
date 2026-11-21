import { FLAG_NAMES } from './cardState';
import { isBuried } from './queue';
import { isLiveLeech } from './leechRecovery';
import type { Card, Note } from './types';

/**
 * The markers Browse shows on a note's row: one summary for the whole note rather than one per
 * card, so a note with Front, Reverse and Audio cards stays one readable line. A marker names the
 * state and, when only some of the note's cards are in it, how many ("Suspended 1 of 3"). A
 * retired card (a kind the note no longer makes) counts for nothing. Display only; pure, so it's
 * tested.
 */
export interface NoteMarker {
  kind: 'suspended' | 'buried' | 'leech' | 'flag';
  /** What the marker says beside its color: "Suspended", "Buried until tomorrow", "Leech", "Red flag". */
  label: string;
  /** "1 of 3", when some but not all of the note's cards are in the state; none for the whole note. */
  partial?: string;
  /** Anki's flag number (1 to 7) for a flag marker. */
  flag?: number;
}

export function noteMarkers(note: Note, cards: Card[], now: Date, dayStartsAtHour: number): NoteMarker[] {
  const live = cards.filter((c) => !c.retired);
  const out: NoteMarker[] = [];
  const count = (kind: NoteMarker['kind'], label: string, n: number, flag?: number) => {
    if (n === 0) return;
    out.push({ kind, label, ...(n < live.length ? { partial: `${n} of ${live.length}` } : {}), ...(flag ? { flag } : {}) });
  };
  count('suspended', 'Suspended', live.filter((c) => c.suspended).length);
  // A suspended card is out of study already, so a bury on it adds nothing to say.
  count('buried', 'Buried until tomorrow', live.filter((c) => !c.suspended && isBuried(c, now, dayStartsAtHour)).length);
  // A leech that has recovered isn't marked, though Anki's tag stays on it (`isLiveLeech`).
  if (isLiveLeech(note, cards)) out.push({ kind: 'leech', label: 'Leech' });
  const flags = [...new Set(live.map((c) => c.flag ?? 0).filter((f) => f > 0 && f < FLAG_NAMES.length))].sort((a, b) => a - b);
  for (const f of flags) count('flag', `${FLAG_NAMES[f]} flag`, live.filter((c) => c.flag === f).length, f);
  return out;
}

/** A marker as one phrase for the row's accessibility label: "Suspended, 1 of 3". */
export function markerText(m: NoteMarker): string {
  return m.partial ? `${m.label}, ${m.partial}` : m.label;
}
