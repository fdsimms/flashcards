import type { AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioLesson } from '../reader/api';
import type { LessonWaits } from './useLessonWaits';

export interface LessonLoop {
  /** Whether this lesson starts again when it ends. */
  isOn: (lessonId: number) => boolean;
  /** Loop on or off for this lesson; returns the new value. */
  toggle: (lessonId: number) => boolean;
  /** Loop off for this lesson, as its screen opens with it not playing (a text's Loop text is off each time it opens, too). */
  clear: (lessonId: number) => void;
  /** A lesson is now on the player (or none, null): it's the one a finish restarts. */
  watch: (lesson: AudioLesson | null) => void;
  /** Start over: back to 0:00 and playing, letting go of a hold at a pause. */
  startOver: () => void;
}

/**
 * Loop for an audio lesson: played to its end, it starts again from 0:00. Kept on the shared player's
 * host, so it holds while the lesson moves between its screen and the tab bar's mini-player, and
 * set from either one or from the Live Activity's Loop button. Held by lesson id: a lesson's
 * screen opened while another lesson carries on in the mini-player doesn't change that one's.
 */
export function useLessonLoop(player: AudioPlayer, waits: LessonWaits): LessonLoop {
  const [looping, setLooping] = useState<number | null>(null);
  const loopingRef = useRef<number | null>(null);
  const watched = useRef<AudioLesson | null>(null);
  const waitsRef = useRef(waits);
  waitsRef.current = waits;

  const set = useCallback((id: number | null) => {
    loopingRef.current = id;
    setLooping(id);
  }, []);

  const startOver = useCallback(() => {
    waitsRef.current.moved();
    player.seekTo(0).then(() => player.play(), () => undefined);
  }, [player]);

  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      const lesson = watched.current;
      if (status.didJustFinish && lesson && loopingRef.current === lesson.id) startOver();
    });
    return () => sub.remove();
  }, [player, startOver]);

  // Read from the ref, so a listener made before the last change gets the current answer; `looping`
  // in the deps gives it a new identity on each change, so a screen showing it renders again.
  const isOn = useCallback((id: number) => loopingRef.current === id, [looping]); // eslint-disable-line react-hooks/exhaustive-deps -- see above
  const toggle = useCallback((id: number) => {
    const on = loopingRef.current !== id;
    set(on ? id : null);
    return on;
  }, [set]);
  const clear = useCallback((id: number) => { if (loopingRef.current === id) set(null); }, [set]);
  const watch = useCallback((lesson: AudioLesson | null) => { watched.current = lesson; }, []);

  return { isOn, toggle, clear, watch, startOver };
}
