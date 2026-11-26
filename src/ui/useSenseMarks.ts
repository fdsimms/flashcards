import { useCallback, useMemo, useState } from 'react';
import type { MissAnswers } from '../core/misses';
import { carriedRecalled, lastMissedSenses, senseMissKey, senseReminder, senseReminderParts, sensesGot } from '../core/senseMarks';
import type { RenderedCard } from '../core/types';
import type { SenseMarking, SenseVerdict } from './SenseMarks';

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
  const last = useMemo(() => lastMissedSenses(answers ?? [], senses.length), [answers, senses.length]);
  // Senses recalled on the card's latest answer start checked, so only the missed one is left to say (carriedRecalled).
  const carried = useMemo(() => new Map<number, SenseVerdict>(carriedRecalled(senses.length, last).map((n) => [n, 'got'])), [senses.length, last]);
  // The taps belong to one answer: another card, or this one shown again, starts from the carried checks.
  const [taps, setTaps] = useState<{ turn: string; verdicts: ReadonlyMap<number, SenseVerdict> } | null>(null);
  const verdicts = useMemo(() => (taps && taps.turn === turn ? taps.verdicts : carried), [taps, turn, carried]);
  // Only the missed ones are kept with the answer; "recalled" is what the row shows for a tap, and an untouched sense counts as recalled too.
  const marked = useMemo(() => new Set([...verdicts].filter(([, v]) => v === 'missed').map(([n]) => n)), [verdicts]);
  const onMark = useCallback((sense: number, verdict: SenseVerdict) => {
    if (!turn) return;
    setTaps((prev) => {
      const next = new Map(prev && prev.turn === turn ? prev.verdicts : carried);
      if (next.get(sense) === verdict) next.delete(sense);
      else next.set(sense, verdict);
      return { turn, verdicts: next };
    });
  }, [turn, carried]);
  const marking = useMemo<SenseMarking | undefined>(() => (senses.length ? { verdicts, last, onMark } : undefined), [senses.length, verdicts, last, onMark]);
  const parts = senseReminderParts(senses.length, last);
  return {
    marking,
    /** How many senses the answer has (0 with no numbered Meaning). */
    count: senses.length,
    /** The reason an answer given now keeps, or undefined with no sense tapped. */
    miss: senses.length ? senseMissKey(marked) : undefined,
    /** The front's line and what its tap shows, or null with nothing missed last time. */
    reminder: parts ? { ...parts, text: senseReminder(senses.length, last)!, got: sensesGot(senses, last), missed: last.length } : null,
  };
}
