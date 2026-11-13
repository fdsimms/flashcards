import { isInDeck } from './deckTree';
import {
  confusions, headword, practicePool, weakForms, withoutArticle,
  type Confusion, type PracticeRecord, type PracticeWord,
} from './forms';
import type { Note } from './types';

/**
 * What a deck's forms practice history says, for the Practice history screen. Read-only: it
 * counts the results kept in `PracticeRecord`, and nothing here reaches a card's schedule.
 */

/** A form still owed right answers (`weakForms`), with what the history says about it. */
export interface WeakFormStat {
  noteId: string;
  key: string;
  /** As a drill's summary names it: "wrzesień · gender". */
  name: string;
  /** The form's first accepted answer. */
  answer: string;
  attempts: number;
  misses: number;
  /** Right answers since the latest miss. */
  rightSince: number;
  owed: number;
}

export interface GroupStat {
  /** The kind of form: a tense, or a field's own label ("gender"). */
  group: string;
  answers: number;
  right: number;
}

export interface PracticeStats {
  answers: number;
  right: number;
  /** Whole days from the first answer to `now`, at least 1. */
  days: number;
  /** Most owed first. Every one, so the screen can say how many it left out. */
  weak: WeakFormStat[];
  mixedUp: Confusion[];
  /** Weakest first. */
  byGroup: GroupStat[];
}

const DAY_MS = 86400000;

/**
 * The words in `deck` (and its subdecks) whose notes list forms, with the practice history of those
 * words. `dayStartsAtHour` is the collection's, for what `weakForms` counts as a same-day retry.
 */
export function practiceStats(deck: string, notes: Iterable<Note>, history: PracticeRecord[], now: Date, dayStartsAtHour: number): PracticeStats {
  const words: PracticeWord[] = practicePool(notes).filter((w) => isInDeck(w.note.deck, deck));
  const byNote = new Map<string, PracticeRecord[]>();
  for (const r of history) (byNote.get(r.noteId) ?? byNote.set(r.noteId, []).get(r.noteId)!).push(r);

  let answers = 0;
  let right = 0;
  let first = '';
  const groups = new Map<string, GroupStat>();
  const weak: WeakFormStat[] = [];

  for (const w of words) {
    const mine = (byNote.get(w.note.id) ?? []).sort((a, b) => a.practicedAt.localeCompare(b.practicedAt));
    if (!mine.length) continue;
    const owed = weakForms(mine, dayStartsAtHour);
    for (const f of w.forms) {
      const rows = mine.filter((r) => r.key === f.key);
      if (!rows.length) continue;
      const g = groups.get(f.group) ?? { group: f.group, answers: 0, right: 0 };
      for (const r of rows) {
        answers++;
        g.answers++;
        if (r.correct) { right++; g.right++; }
        if (!first || r.practicedAt < first) first = r.practicedAt;
      }
      groups.set(f.group, g);
      const stillOwed = owed.get(f.key);
      if (!stillOwed) continue;
      const lastMiss = rows.map((r) => r.correct).lastIndexOf(false);
      const gender = f.key === 'field:Gender';
      const word = headword(w.note);
      weak.push({
        noteId: w.note.id,
        key: f.key,
        name: [gender ? withoutArticle(word) : word, f.label, ...(f.group && f.group !== f.label ? [f.group] : [])].join(' · '),
        answer: f.answers[0],
        attempts: rows.length,
        misses: rows.filter((r) => !r.correct).length,
        rightSince: rows.length - 1 - lastMiss,
        owed: stillOwed,
      });
    }
  }

  weak.sort((a, b) => b.owed - a.owed || b.misses - a.misses || a.name.localeCompare(b.name));
  const days = first ? Math.max(1, Math.floor((now.getTime() - new Date(first).getTime()) / DAY_MS)) : 1;
  return {
    answers,
    right,
    days,
    weak,
    mixedUp: confusions([...byNote.values()].flat(), words),
    byGroup: [...groups.values()].sort((a, b) => a.right / a.answers - b.right / b.answers || a.group.localeCompare(b.group)),
  };
}
