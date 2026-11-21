import { useCallback, useEffect, useRef, useState } from 'react';
import { examplesOf } from '../core/examples';
import { htmlToText } from '../core/html';
import type { Card, Note } from '../core/types';
import type { ReadingLine } from '../reader/api';
import { cardLanguage } from '../reader/cardGlosses';
import { lineFor, lineKey, lineWord, readingLineRequests } from '../reader/readingLines';
import type { CardGlossing } from './useCardGlosses';

/**
 * Each card's lines from texts read (reader/readingLines.ts), asked for once when the session's cards
 * are known, one call a language, and again only for words not asked about yet (cards added by Custom
 * Study). Kept only for the session: a word read since should show its new line next time. A word the
 * server has no line for, or a server that can't be reached or is older than this, shows no line.
 */
export function useReadingLines(glossing: CardGlossing | undefined, cards: Card[] | undefined, notes: Map<string, Note>) {
  const asked = useRef(new Set<string>());
  const found = useRef(new Map<string, ReadingLine[]>());
  const mounted = useRef(true);
  // Counts the answers that have come in: the function returned changes with it, so a card drawn before its lines arrived is drawn again.
  const [version, setVersion] = useState(0);
  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    if (!glossing || !cards?.length) return;
    for (const request of readingLineRequests(cards, notes, glossing.decks, asked.current)) {
      const keys = request.words.map((w) => lineKey(request.language, w));
      for (const key of keys) asked.current.add(key);
      glossing.api.readingLines(request.language, request.words).then((lines) => {
        for (const [word, list] of Object.entries(lines)) found.current.set(lineKey(request.language, word), list);
        if (mounted.current) setVersion((v) => v + 1);
      // Asked about again on the next change, not skipped for the rest of the session.
      }, () => { for (const key of keys) asked.current.delete(key); });
    }
  }, [glossing, cards, notes]);

  /** The line this card shows on its answer side this time, if it has one. */
  return useCallback((card: Card, note: Note): ReadingLine | undefined => {
    if (!glossing) return undefined;
    const language = cardLanguage(card, note, glossing.decks);
    const word = lineWord(note);
    if (!language || !word) return undefined;
    return lineFor(found.current.get(lineKey(language, word)), card.sched.reps, examplesOf(note).map((e) => htmlToText(e.context)));
  }, [glossing, version]); // eslint-disable-line react-hooks/exhaustive-deps
}
