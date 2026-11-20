import { useCallback, useRef, useState } from 'react';
import { timingLine, withSample, type AnswerTiming } from '../core/answerTiming';

// A diagnostic, turned on from Review's ⋯ menu: it stays on until the app is closed, across decks.
let timingOn = false;

/**
 * Review's answer timing (src/core/answerTiming.ts): `revealPressed` and `revealShown` around Show
 * answer, `pressed` when an answer button is, then `shown`, `queueTook` and `saved` as each step happens. Every call is a no-op while it's off, and
 * nothing here sets state until a step is known, so the answer itself isn't slowed by it.
 */
export function useAnswerTiming() {
  const [on, setOn] = useState(timingOn);
  const [latest, setLatest] = useState<AnswerTiming>();
  const [recent, setRecent] = useState<number[]>([]);
  // The last flip, kept until the next one: it happens before the answer, so it isn't part of a sample.
  const [flip, setFlip] = useState<number>();
  const flipAt = useRef<number | null>(null);
  // The answer being timed: when its button was pressed, the showing it was pressed on, and what's known so far.
  const sample = useRef<{ at: number; from: string; timing: AnswerTiming } | null>(null);

  const toggle = useCallback(() => {
    timingOn = !timingOn;
    setOn(timingOn);
    sample.current = null;
    setLatest(undefined);
    setRecent([]);
    setFlip(undefined);
    flipAt.current = null;
  }, []);

  /** Show answer was pressed (or the card tapped). */
  const revealPressed = useCallback(() => {
    if (timingOn) flipAt.current = performance.now();
  }, []);

  /**
   * The back has been committed. Measured to the second frame after it: the first is drawn with the
   * mount's layout, and a fade-in that stalls shows up in the one after.
   */
  const revealShown = useCallback(() => {
    const at = flipAt.current;
    if (at === null) return;
    flipAt.current = null;
    requestAnimationFrame(() => requestAnimationFrame(() => setFlip(performance.now() - at)));
  }, []);

  /** An answer button was pressed on `from` (the showing). Returns the sample, for `saved`. */
  const pressed = useCallback((from: string) => {
    if (!timingOn) return null;
    sample.current = { at: performance.now(), from, timing: {} };
    return sample.current;
  }, []);

  /** A card is on screen. Counted once per answer, and only for a card other than the one answered. */
  const shown = useCallback((showing: string) => {
    const s = sample.current;
    if (!s || s.timing.shown !== undefined || showing === s.from) return;
    const ms = performance.now() - s.at;
    s.timing = { ...s.timing, shown: ms };
    setLatest(s.timing);
    setRecent((r) => withSample(r, ms));
  }, []);

  /** The queue was rebuilt in `ms`. Called while rendering, so it's only noted; `flush` shows it. */
  const queueTook = useCallback((ms: number) => {
    const s = sample.current;
    if (s && s.timing.queue === undefined) s.timing = { ...s.timing, queue: ms };
  }, []);

  /** Shows what's been noted since (the queue's time), from an effect. */
  const flush = useCallback(() => {
    const s = sample.current;
    if (s) setLatest((l) => (l === s.timing ? l : s.timing));
  }, []);

  /** The answer pressed as `of` is saved. Ignored once a newer answer is being timed. */
  const saved = useCallback((of: ReturnType<typeof pressed>) => {
    if (!of || of !== sample.current) return;
    of.timing = { ...of.timing, saved: performance.now() - of.at };
    setLatest(of.timing);
  }, []);

  const withFlip = flip === undefined ? latest : { ...latest, flip };
  return { on, toggle, revealPressed, revealShown, pressed, shown, queueTook, flush, saved, line: on ? timingLine(withFlip, recent) : null };
}
