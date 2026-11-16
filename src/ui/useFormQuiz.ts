import { useCallback, useMemo, useState } from 'react';
import type { ReaderText, Word } from '../reader/api';
import { aroundWord, slotView, slotWords, type Settled, type SlotView } from '../reader/formQuiz';

/**
 * The reader's fill-in slots (reader/formQuiz.ts): which are still open, the one whose sheet is up, and
 * how each ended. Held for the open text only, so a text opened again starts with every slot open. Kept
 * here, not in Reader.tsx, so the screen only asks how to draw a word and what a tap on it means. Nothing
 * is saved and nothing is graded: the answers last as long as the text is open.
 */

type Spot = { line: number; index: number };

/** What the sheet shows: the word asked, its line around it, and the line's place in the text. */
export type OpenSlot = { word: Word; key: string; textId: number; line: number; before: string; after: string };

const keyOf = (spot: Spot) => `${spot.line}:${spot.index}`;

export function useFormQuiz(text: ReaderText | null, enabled: boolean) {
  const [held, setHeld] = useState<{ textId: number | null; settled: Record<string, Settled> }>({ textId: null, settled: {} });
  const [openKey, setOpenKey] = useState<string | null>(null);
  const textId = text?.id ?? null;
  const settled = held.textId === textId ? held.settled : NONE;

  // Each slot word's place in the text, by the word itself (the screen draws the words it was sent).
  const spots = useMemo(() => {
    const found = new Map<Word, Spot>();
    const slots = new Set(text ? slotWords(text) : []);
    text?.lines.forEach((line, l) => line.words.forEach((w, i) => { if (slots.has(w)) found.set(w, { line: l, index: i }); }));
    return found;
  }, [text]);

  const view = useCallback((word: Word, linePlaying: boolean): SlotView => {
    const spot = spots.get(word);
    return spot ? slotView(word, settled[keyOf(spot)], enabled, linePlaying) : null;
  }, [spots, settled, enabled]);

  /** Opens the sheet for an open slot; false for any other word, which is a tap like any other. */
  const begin = useCallback((word: Word): boolean => {
    const spot = spots.get(word);
    if (!spot || slotView(word, settled[keyOf(spot)], enabled, false) !== 'open') return false;
    setOpenKey(keyOf(spot));
    return true;
  }, [spots, settled, enabled]);

  const current = useMemo((): OpenSlot | null => {
    if (!text || openKey === null) return null;
    const entry = [...spots].find(([, spot]) => keyOf(spot) === openKey);
    if (!entry) return null;
    const around = aroundWord(text.lines[entry[1].line].words, entry[0]);
    return around ? { word: entry[0], key: openKey, textId: text.id, line: entry[1].line, ...around } : null;
  }, [text, spots, openKey]);

  /** Ends the open slot with `result` and closes the sheet. */
  const settle = useCallback((result: Settled) => {
    if (openKey === null) return;
    const base = held.textId === textId ? held.settled : {};
    setHeld({ textId, settled: { ...base, [openKey]: result } });
    setOpenKey(null);
  }, [openKey, held, textId]);

  /** Closes the sheet and leaves the slot open. */
  const close = useCallback(() => setOpenKey(null), []);

  return { view, begin, current, settle, close, any: spots.size > 0 };
}

const NONE: Record<string, Settled> = {};
