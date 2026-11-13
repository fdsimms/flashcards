import { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, type GestureResponderEvent, type ViewInstance } from 'react-native';
import type { Word } from '../reader/api';
import { dragTo, locate, wordUnder, type PhrasePick, type WordBox } from '../reader/phrase';
import { haptic } from './haptics';

/**
 * Selecting a phrase in the reader by holding a word and dragging to its last word. What a pick
 * is, and which word a finger is on, is src/reader/phrase.ts; this is only the gesture.
 *
 * The same rules as the deck list's drag (DeckDrag.tsx): a long press starts it, so a quick swipe
 * still scrolls the text; the responder is claimed in the capture phase by the view holding the
 * line's words, so the word's own press lets go; and the text's scrolling is off for the drag
 * (`dragging`), or the scroll view takes the touch back on the first move.
 *
 * The line's words are measured once, when the drag starts: nothing moves under the finger while
 * the scrolling is off. Held and let go without reaching another word, it's a tap (`onHeld`), so
 * the word's gloss opens as it would have.
 */

interface Drag {
  pick: PhrasePick;
  word: Word;
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** Filled in once the line's words are measured; until then the finger moves nothing. */
  boxes?: WordBox[];
}

const measure = (view: ViewInstance | undefined) => new Promise<Omit<WordBox, 'index'> | null>((resolve) => {
  if (!view) { resolve(null); return; }
  try {
    view.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
  } catch {
    resolve(null);
  }
});

export function usePhraseDrag(opts: {
  /** The text's lines, or null before it's loaded. */
  lines: { words: Word[] }[] | null;
  setPhrase: (pick: PhrasePick | null) => void;
  /** A word held and let go without dragging: what a tap on it does. */
  onHeld: (word: Word, x: number, y: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<Drag | null>(null);
  const views = useRef(new Map<Word, ViewInstance>());
  // The handlers below are made once, so they read the latest props from here.
  const latest = useRef(opts);
  latest.current = opts;

  // One ref callback per word, so a word doesn't get a new one every render.
  const refs = useRef(new Map<Word, (v: ViewInstance | null) => void>());
  const wordRef = useCallback((word: Word) => {
    let fn = refs.current.get(word);
    if (!fn) {
      fn = (v) => { if (v) views.current.set(word, v); else views.current.delete(word); };
      refs.current.set(word, fn);
    }
    return fn;
  }, []);

  /** Ends the phrase at the word under the finger. */
  const follow = () => {
    const d = drag.current;
    if (!d?.boxes) return;
    const index = wordUnder(d.boxes, d.x, d.y);
    if (index === null) return;
    const next = dragTo(d.pick, index);
    if (next === d.pick) return;
    d.pick = next;
    haptic.select();
    latest.current.setPhrase(next);
  };

  const end = useCallback((drop: boolean) => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    if (!drop) { latest.current.setPhrase(null); return; }
    if (d.pick.end === d.pick.start) {
      latest.current.setPhrase(null);
      latest.current.onHeld(d.word, d.startX, d.startY);
    }
  }, []);

  /** Starts a phrase at `word`, from the long press on it. */
  const begin = useCallback(async (word: Word, e: GestureResponderEvent) => {
    const lines = latest.current.lines;
    const at = lines && !drag.current ? locate(lines, word) : null;
    if (!lines || !at) return;
    const { pageX, pageY } = e.nativeEvent;
    const d: Drag = { pick: { line: at.line, start: at.index, end: at.index }, word, startX: pageX, startY: pageY, x: pageX, y: pageY };
    drag.current = d;
    haptic.lift();
    setDragging(true);
    latest.current.setPhrase(d.pick);
    const words = lines[at.line].words;
    // Spaces and punctuation aren't measured: a phrase starts and ends on a word.
    const measured = await Promise.all(words.map((w, index) => (
      w.status === null ? null : measure(views.current.get(w)).then((m) => (m ? { index, ...m } : null))
    )));
    if (drag.current !== d) return;
    d.boxes = measured.filter((m): m is WordBox => m !== null);
    follow();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    // In the capture phase, so the word's press lets go once the drag has started.
    onMoveShouldSetPanResponderCapture: () => drag.current !== null,
    onMoveShouldSetPanResponder: () => drag.current !== null,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (e) => {
      const d = drag.current;
      if (!d) return;
      d.x = e.nativeEvent.pageX;
      d.y = e.nativeEvent.pageY;
      follow();
    },
    onPanResponderRelease: () => end(true),
    onPanResponderTerminate: () => end(false),
  }), [end]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Spread on each view holding a line's (or a paragraph's) words. */
  const lineProps = {
    ...responder.panHandlers,
    // A press held and let go without moving never hands the touch over: end it here.
    onTouchEnd: () => { if (drag.current) end(true); },
    onTouchCancel: () => { if (drag.current) end(false); },
  };

  return { dragging, wordRef, begin, lineProps };
}
