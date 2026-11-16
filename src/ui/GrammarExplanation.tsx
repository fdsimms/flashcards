import React, { useEffect, useMemo, useState } from 'react';
import { Text } from 'react-native';
import { explanationParagraphs } from '../core/grammar';
import type { Api, Language, Word } from '../reader/api';
import type { Pronunciation } from '../reader/mining';
import { LANGUAGES } from '../reader/languages';
import { explanationGlosses, explanationRequest } from '../reader/grammarGlosses';
import { haptic } from './haptics';
import { GlossPopover, type Tapped } from './Reader';
import { type, useTheme } from './theme';

/** What a tapped word's popover needs: Read & Listen's server, and what its buttons do (as on a card's sentence, useCardGlosses). */
export type ExplanationGlossing = {
  api: Api;
  /** Plays a word: its deck recording, else the phone's voice (useWordAudio). */
  onPlayWord: (word: string, language: Language) => void;
  /** Opens the note editor on a word not in the deck; true once it's saved. */
  onAddWord: (word: string, meaning: string, language: Language, pronunciation?: Pronunciation) => Promise<boolean>;
};

/**
 * A grammar point's explanation, its paragraphs with the language's own words highlighted. Each
 * highlighted word can be tapped for the reader's popover (meaning, play, pronunciation, Add to
 * deck), once the server has split and glossed the phrases; until then, and when it can't, they're
 * only highlighted. Tapping only shows a word: nothing is graded or written (reader/grammarGlosses.ts).
 */
export function GrammarExplanation({ language, explanation, glossing }: { language: Language; explanation: string; glossing: ExplanationGlossing }) {
  const c = useTheme();
  const { api } = glossing;
  const [glosses, setGlosses] = useState<Map<string, Word[]>>(new Map());
  const [tapped, setTapped] = useState<Tapped | null>(null);
  const paragraphs = useMemo(() => explanationParagraphs(explanation), [explanation]);
  const request = useMemo(() => explanationRequest(language, paragraphs), [language, paragraphs]);

  useEffect(() => {
    setGlosses(new Map());
    setTapped(null);
    if (!request) return;
    // Dropped when the point changes or the screen is left before the answer comes.
    let current = true;
    api.glosses(request.language, request.sentences).then((answer) => {
      if (current && answer.ready) setGlosses(explanationGlosses(request, answer.sentences));
    }, () => undefined);
    return () => { current = false; };
  }, [api, request]);

  return (
    <>
      {paragraphs.map((para, i) => (
        <Text key={i} style={{ ...type.body, color: c.text, lineHeight: 24 }}>
          {para.map((run, j) => {
            if (!run.language) return run.text;
            const words = glosses.get(run.text);
            return (
              <Text key={j} style={{ fontWeight: '600', color: c.accent }}>
                {words ? words.map((w, k) => (w.status === null ? w.text : (
                  <Text
                    key={k}
                    accessibilityRole="button"
                    accessibilityHint="Shows what this word means"
                    onPress={(e) => { haptic.tap(); setTapped({ word: w, x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }); }}
                  >
                    {w.text}
                  </Text>
                ))) : run.text}
              </Text>
            );
          })}
        </Text>
      ))}
      <GlossPopover
        tapped={tapped}
        translitLabel={LANGUAGES[language].translitLabel}
        grammar={null}
        api={api}
        grammarChosen={{}}
        onGrammarChosen={() => undefined}
        flagged={false}
        onToggleFlag={null}
        onPlay={() => { if (tapped) glossing.onPlayWord(tapped.word.text, language); }}
        onSelectPhrase={null}
        onAddToDeck={tapped && !tapped.word.deck && tapped.word.status !== 'name' ? () => {
          // The popover is a modal, so it closes before the note editor opens over the page.
          const { text, gloss: meaning } = tapped.word;
          const pronunciation = { ipa: tapped.word.ipa, ipa_source: tapped.word.ipa_source };
          setTapped(null);
          void glossing.onAddWord(text, meaning ?? '', language, pronunciation);
        } : null}
        onClose={() => setTapped(null)}
      />
    </>
  );
}
