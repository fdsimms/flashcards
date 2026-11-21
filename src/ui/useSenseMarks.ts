import { useCallback, useMemo, useState } from 'react';
import type { MissAnswers } from '../core/misses';
import { lastMissedSenses, senseMissKey, senseReminder, sensesGot } from '../core/senseMarks';
import type { RenderedCard } from '../core/types';
import type { SenseMarking } from './SenseMarks';

/**
 * Missed senses for the card on screen (src/core/senseMarks.ts): which senses are tapped on this
 * answer, the reason to keep with whichever rating is pressed (`miss`), and what the card's latest
 * answer left to remind about. Only a card whose answer shows a numbered Meaning has any (a forward
 * or audio card; a reverse card's prompt is the senses). `answers` is the card's own log (useMissMarks).
 * `turn` names this showing of the card (the card and how many answers the session has), so a card that
 * comes back after its answer, or after an undo, starts with nothing tapped.
 */
export function useSenseMarks(turn: string | undefined, rendered: RenderedCard | undefined, answers: MissAnswers | undefined) {
  const senses = useMemo(() => rendered?.back.blocks.find((b) => b.senses)?.senses ?? [], [rendered]);
  // The taps belong to one answer: another card, or this one shown again, starts with none.
  const [taps, setTaps] = useState<{ turn: string; marked: ReadonlySet<number> } | null>(null);
  const marked = useMemo(() => (taps && taps.turn === turn ? taps.marked : new Set<number>()), [taps, turn]);
  const onToggle = useCallback((sense: number) => {
    if (!turn) return;
    setTaps((prev) => {
      const next = new Set(prev && prev.turn === turn ? prev.marked : []);
      if (!next.delete(sense)) next.add(sense);
      return { turn, marked: next };
    });
  }, [turn]);
  const last = useMemo(() => lastMissedSenses(answers ?? [], senses.length), [answers, senses.length]);
  const marking = useMemo<SenseMarking | undefined>(() => (senses.length ? { marked, last, onToggle } : undefined), [senses.length, marked, last, onToggle]);
  const reminder = senseReminder(senses.length, last);
  return {
    marking,
    /** How many senses the answer has (0 with no numbered Meaning). */
    count: senses.length,
    /** The reason an answer given now keeps, or undefined with no sense tapped. */
    miss: senses.length ? senseMissKey(marked) : undefined,
    /** The front's line and what its tap shows, or null with nothing missed last time. */
    reminder: reminder ? { text: reminder, got: sensesGot(senses, last) } : null,
  };
}
