import type { AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutputWake } from './useOutputWake';
import type { AudioLesson } from '../reader/api';
import { loadWait, saveWait } from '../reader/lessonStorage';
import { continueFrom, letGo, NOT_WAITING, pausesOf, waitTick, type Pause, type WaitState } from '../reader/lessonWaits';

export interface LessonWaits {
  /** Wait for my answer: the lesson stops at each place the learner speaks. Kept on the phone; the player's row and Settings, Lessons change the same one. */
  on: boolean;
  setOn: (on: boolean) => void;
  /** The lesson is stopped at a pause, waiting for Continue. */
  held: boolean;
  /** The lesson now on the player, whose pauses are waited at; null once nothing is. */
  watch: (lesson: AudioLesson | null) => void;
  /** Continue: past the rest of the silence, playing. Does nothing unless held. */
  goOn: () => void;
  /** The player was moved (back or forward 15 seconds): a hold is let go and the lesson plays from there. */
  moved: () => void;
}

/**
 * Waits at an audio lesson's pauses (src/reader/lessonWaits.ts has the rules) on Read & Listen's
 * shared player, whichever screen has it: the lesson's own, or the tab bar's mini-player once the
 * lesson was left playing. A listener of its own on the player, so a status update re-renders only
 * when the lesson stops or goes on.
 */
export function useLessonWaits(player: AudioPlayer): LessonWaits {
  const [on, setOnState] = useState(false);
  const [held, setHeld] = useState(false);
  const wake = useOutputWake();
  const onRef = useRef(false);
  const pauses = useRef<Pause[]>([]);
  const state = useRef<WaitState>(NOT_WAITING);

  useEffect(() => {
    let live = true;
    loadWait().then((v) => { if (live) { onRef.current = v; setOnState(v); } });
    return () => { live = false; };
  }, []);

  const reset = useCallback(() => {
    state.current = NOT_WAITING;
    setHeld(false);
  }, []);

  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      if (!onRef.current || !pauses.current.length) return;
      const step = waitTick(state.current, pauses.current, { seconds: status.currentTime, playing: status.playing, now: Date.now() });
      const before = state.current.held;
      state.current = step.state;
      if (step.act === 'hold') {
        player.pause();
        setHeld(true);
      } else if (step.act === 'continue' && before) {
        // Play on the lock screen or the tab bar while held: on past the silence, as Continue.
        setHeld(false);
        player.seekTo(continueFrom(pauses.current[before.index])).catch(() => undefined);
      }
    });
    return () => sub.remove();
  }, [player]);

  const setOn = useCallback((next: boolean) => {
    onRef.current = next;
    setOnState(next);
    saveWait(next);
    // Turned off while held: the lesson stays paused where it is, for Play.
    if (!next) reset();
  }, [reset]);

  const watch = useCallback((lesson: AudioLesson | null) => {
    pauses.current = lesson ? pausesOf(lesson) : [];
    reset();
  }, [reset]);

  const goOn = useCallback(() => {
    const at = state.current.held;
    if (!at) return;
    state.current = letGo(state.current);
    setHeld(false);
    // After the learner's turn, Bluetooth headphones may have gone quiet and would lose the lesson's next words (useOutputWake).
    const play = () => { void wake().then(() => { if (!state.current.held) player.play(); }); };
    player.seekTo(continueFrom(pauses.current[at.index])).then(play, play);
  }, [player, wake]);

  const moved = useCallback(() => {
    const wasHeld = !!state.current.held;
    reset();
    if (wasHeld) void wake().then(() => player.play());
  }, [player, reset, wake]);

  return { on, setOn, held, watch, goOn, moved };
}
