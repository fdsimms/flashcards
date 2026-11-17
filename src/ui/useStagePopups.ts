import { useEffect, useRef, useState } from 'react';
import type { StageChange } from '../wanikani/srs';
import { nextSide, pushPopup, removePopup, type StackEntry } from '../wanikani/stagePopups';
import { STAGE_POPUP_EXIT_MS, stagePopupMs } from './StagePopup';

/**
 * The level-up popups showing on the review screen (StagePopup.tsx). Each keeps its own timer, so a
 * new one stacks over the ones before it (stagePopups.ts) rather than cutting them off.
 * `show` returns the popup's id, for taking that one down again with `hide`.
 */
export function useStagePopups() {
  const [stack, setStack] = useState<StackEntry[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const leaving = useRef(new Set<number>());
  const lastId = useRef(0);
  const lastSide = useRef<-1 | 1>(1);

  const clearTimer = (id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  };
  const hide = (id: number) => {
    clearTimer(id);
    leaving.current.delete(id);
    setStack((s) => removePopup(s, id));
  };
  const hideAll = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current.clear();
    leaving.current.clear();
    setStack([]);
  };
  const show = (change: StageChange): number => {
    lastId.current += 1;
    const id = lastId.current;
    // Rises alternate sides; a drop comes straight up and doesn't take a turn.
    let side: -1 | 0 | 1 = 0;
    if (change.up) {
      lastSide.current = nextSide(lastSide.current);
      side = lastSide.current;
    }
    setStack((s) => pushPopup(s, { id, change, side, out: false }));
    timers.current.set(id, setTimeout(() => hide(id), stagePopupMs(change)));
    return id;
  };

  // One pushed out by a newer popup fades on its own, then goes; its normal timer no longer applies.
  useEffect(() => {
    for (const e of stack) {
      if (!e.out || leaving.current.has(e.id)) continue;
      leaving.current.add(e.id);
      clearTimer(e.id);
      timers.current.set(e.id, setTimeout(() => hide(e.id), STAGE_POPUP_EXIT_MS));
    }
  }, [stack]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { timers.current.forEach((t) => clearTimeout(t)); }, []);

  return { stack, show, hide, hideAll };
}
