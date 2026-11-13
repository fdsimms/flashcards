import { useCallback, useEffect, useRef, useState } from 'react';
import { htmlToText } from '../core/html';
import type { Card, Note } from '../core/types';
import type { Api, Language, Word } from '../reader/api';
import { cardLanguage, glossesOf, glossKey, glossRequests } from '../reader/cardGlosses';

/** What a card needs to gloss its example sentence: Read & Listen's server, its decks, and what a popover's buttons do. */
export type CardGlossing = {
  api: Api;
  /** Each language's deck, as Read & Listen's settings name them. */
  decks: Partial<Record<Language, string>>;
  /** Plays a word: its deck recording, else the phone's voice (useWordAudio). */
  onPlayWord: (word: string, language: Language) => void;
  /** Opens the note editor on a word not in the deck; true once it's saved. */
  onAddWord: (word: string, meaning: string, language: Language) => Promise<boolean>;
};

/** One card's example sentence as words to tap, with what the popover's buttons do. */
export type SentenceGloss = Omit<CardGlossing, 'decks'> & { language: Language; words: Word[] };

// Kept for as long as the app runs, so a sentence studied again later in the day needs no call,
// and a session that can't reach the server still shows what an earlier one fetched.
const kept = new Map<string, Word[]>();

/**
 * The words of each card's example sentence, asked for once when the session's cards are known
 * (one call per language: reader/cardGlosses.ts), and again only for sentences not asked about yet
 * (cards added by Custom Study). A sentence the server hasn't answered for shows as it always did.
 */
export function useCardGlosses(glossing: CardGlossing | undefined, cards: Card[] | undefined, notes: Map<string, Note>) {
  const asked = useRef(new Set<string>());
  const mounted = useRef(true);
  const [, setVersion] = useState(0);
  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    if (!glossing || !cards?.length) return;
    for (const request of glossRequests(cards, notes, glossing.decks, asked.current)) {
      for (const s of request.sentences) asked.current.add(glossKey(request.language, s.text));
      glossing.api.glosses(request.language, request.sentences).then((answer) => {
        if (!answer.ready) return;
        for (const [key, words] of glossesOf(request, answer.sentences)) kept.set(key, words);
        if (mounted.current) setVersion((v) => v + 1);
      }, () => undefined);
    }
  }, [glossing, cards, notes]);

  return useCallback((card: Card, note: Note): SentenceGloss | null => {
    if (!glossing) return null;
    const language = cardLanguage(card, note, glossing.decks);
    const words = language ? kept.get(glossKey(language, htmlToText(note.fields.Context ?? ''))) : undefined;
    if (!language || !words) return null;
    const { api, onPlayWord, onAddWord } = glossing;
    return { api, onPlayWord, onAddWord, language, words };
  }, [glossing]);
}
