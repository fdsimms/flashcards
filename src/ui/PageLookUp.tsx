import React, { useMemo, useRef, useState } from 'react';
import type { Card, Note } from '../core/types';
import type { GlossLanguage } from '../reader/api';
import { cardLanguage } from '../reader/cardGlosses';
import { canAdd, contextAround, wordIn } from '../reader/lookUp';
import { saidAs } from '../reader/wordAudio';
import type { PageWord } from './CardWebView';
import { glossText } from './lookUpCache';
import { GlossPopover, type Tapped } from './reader/Reader';
import type { CardGlossing } from './useCardGlosses';

/**
 * Look it up on an Anki-template card (src/reader/lookUp.ts): a word held on the question side, or
 * tapped on the answer side (CardWebView's `onLookUp`), shown in the popover a card's sentence uses
 * (GlossPopover), with its meaning in the sense of the text around it. Only a card in a deck whose
 * language Read & Listen has, while it's on (`glossing`); `onLookUp` is undefined otherwise, so the
 * page doesn't listen for words at all. Nothing here grades a card.
 */
export function usePageLookUp(glossing: CardGlossing | undefined, card: Card | null | undefined, note: Note | undefined) {
  const language: GlossLanguage | null = glossing && card && note ? cardLanguage(card, note, glossing.glossDecks) : null;
  const [tapped, setTapped] = useState<(Tapped & { language: GlossLanguage; context: string }) | null>(null);
  // The latest tap only: one answered after another was made is dropped.
  const seq = useRef(0);
  const looked = useRef(new Map<string, string>());

  const onLookUp = useMemo(() => {
    if (!glossing || !language) return undefined;
    return (found: PageWord) => {
      const mine = ++seq.current;
      const context = contextAround(found.context, found.word);
      glossText(glossing.api, language, context)
        .catch(() => null)
        .then((words) => {
          if (mine !== seq.current) return;
          setTapped({ word: wordIn(words ?? [], found.word), x: found.x, y: found.y, language, context });
        });
    };
  }, [glossing, language]);

  const popover = glossing ? (
    <GlossPopover
      tapped={tapped}
      grammar={null}
      api={glossing.api}
      grammarChosen={{}}
      onGrammarChosen={() => undefined}
      flagged={false}
      onToggleFlag={null}
      onPlay={() => { if (tapped) glossing.onPlayWord(tapped.word.text, tapped.language, saidAs(tapped.language, tapped.word.text, tapped.word.translit)); }}
      meaningLookup={(word) => (tapped ? glossing.api.wordMeaning(tapped.language, word.text) : Promise.resolve(null)).then((meaning) => {
        if (meaning) looked.current.set(word.text, meaning);
        return meaning;
      })}
      onAddToDeck={tapped && canAdd(tapped.word) ? () => {
        // The popover is a modal, so it closes before the note editor opens over the card.
        const { word, language: lang } = tapped;
        setTapped(null);
        void glossing.onAddWord(word.text, word.gloss ?? looked.current.get(word.text) ?? '', lang, { ipa: word.ipa, ipa_source: word.ipa_source, translit: word.translit });
      } : null}
      onClose={() => setTapped(null)}
    />
  ) : null;

  return { onLookUp, popover };
}
