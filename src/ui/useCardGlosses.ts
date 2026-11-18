import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { firstExample } from '../core/examples';
import { htmlToText } from '../core/html';
import type { Card, Note } from '../core/types';
import type { Api, Language, Word } from '../reader/api';
import { cardLanguage, glossesOf, glossKey, glossRequests, keptForDisk, parseKept } from '../reader/cardGlosses';
import type { Pronunciation } from '../reader/mining';

/** What a card needs to gloss its example sentence: Read & Listen's server, its decks, and what a popover's buttons do. */
export type CardGlossing = {
  api: Api;
  /** Each language's deck, as Read & Listen's settings name them. */
  decks: Partial<Record<Language, string>>;
  /** Plays a word: its deck recording, else the phone's voice (useWordAudio). */
  onPlayWord: (word: string, language: Language, say?: string) => void;
  /** Opens the note editor on a word not in the deck; true once it's saved. */
  onAddWord: (word: string, meaning: string, language: Language, pronunciation?: Pronunciation) => Promise<boolean>;
};

/** One card's example sentence as words to tap, with what the popover's buttons do. */
export type SentenceGloss = Omit<CardGlossing, 'decks'> & { language: Language; words: Word[] };

// Kept on the phone (the newest KEPT_SENTENCES, in the documents folder), so a sentence studied
// again needs no call, and a session that can't reach the server (the subway) still shows what an
// earlier one fetched, after the app has been closed too.
const kept = new Map<string, Word[]>();
const keptFile = () => new File(Paths.document, 'card-glosses.json');
let loaded: Promise<void> | null = null;
const loadKept = () => {
  loaded ??= (async () => {
    try {
      const f = keptFile();
      // Fetched before the file was read wins: it's the newer answer.
      if (f.exists) for (const [key, words] of parseKept(JSON.parse(await f.text()))) if (!kept.has(key)) kept.set(key, words);
    } catch {
      // Nothing kept: the server is asked as before.
    }
  })();
  return loaded;
};
const saveKept = () => {
  try {
    const f = keptFile();
    if (!f.exists) f.create();
    f.writeSync(JSON.stringify(keptForDisk(kept)));
  } catch {
    // Still kept for as long as the app runs.
  }
};

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
  useEffect(() => { loadKept().then(() => { if (mounted.current) setVersion((v) => v + 1); }); }, []);

  useEffect(() => {
    if (!glossing || !cards?.length) return;
    for (const request of glossRequests(cards, notes, glossing.decks, asked.current)) {
      const keys = request.sentences.map((s) => glossKey(request.language, s.text));
      for (const key of keys) asked.current.add(key);
      // A sentence the server couldn't answer yet (its deck isn't read) or that failed offline is
      // asked about again on the next change, not skipped for the rest of the session.
      const askAgain = () => { for (const key of keys) asked.current.delete(key); };
      glossing.api.glosses(request.language, request.sentences).then((answer) => {
        if (!answer.ready) { askAgain(); return; }
        for (const [key, words] of glossesOf(request, answer.sentences)) { kept.delete(key); kept.set(key, words); }
        void loadKept().then(saveKept);
        if (mounted.current) setVersion((v) => v + 1);
      }, askAgain);
    }
  }, [glossing, cards, notes]);

  return useCallback((card: Card, note: Note): SentenceGloss | null => {
    if (!glossing) return null;
    const language = cardLanguage(card, note, glossing.decks);
    const words = language ? kept.get(glossKey(language, htmlToText(firstExample(note).context))) : undefined;
    if (!language || !words) return null;
    const { api, onPlayWord, onAddWord } = glossing;
    return { api, onPlayWord, onAddWord, language, words };
  }, [glossing]);
}
