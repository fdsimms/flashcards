import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { grammarPoint } from '../core/grammar';
import { exampleSource } from '../reader/grammar';
import { useApp } from '../ui/AppContext';
import { ReadGrammarPoint } from '../ui/reader/ReadGrammarPoint';
import { useGrammarGlossing } from '../ui/useGrammarGlossing';

/** A grammar point's page, for the point named by the `id` parameter (docs/grammar.md, step 4). */
export default function ReadGrammarPointRoute() {
  const router = useRouter();
  const { repo, reader } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  // A tapped word in the explanation: played, or added to its language's deck as the reader's words are.
  const glossing = useGrammarGlossing();
  // What the page reads from the phone: notes and Forms practice, and when Not yet was chosen.
  const practice = useMemo(() => ({
    load: async () => {
      const [notes, records, dismissed, drills] = await Promise.all([
        repo.listNotes(), repo.listPractice(), repo.grammarHintsDismissed(), repo.listGrammarAnswers(),
      ]);
      return { notes, practice: records, dismissed, drills };
    },
    saveDismissed: (dismissed: Record<string, string>) => repo.saveGrammarHintsDismissed(dismissed),
  }), [repo]);
  if (!reader.api) return <Redirect href="/read-settings" />;
  const language = grammarPoint(id)?.language;
  // `decks` is missing from a server older than the deck setting.
  const deck = language && reader.settings?.decks ? reader.settings.decks[language] ?? null : null;
  return (
    <ReadGrammarPoint
      api={reader.api}
      glossing={glossing}
      practice={practice}
      id={id}
      dayStartsAtHour={reader.dayStartsAtHour}
      practiceDeck={deck}
      onOpenPoint={(next) => router.push({ pathname: '/read-grammar-point', params: { id: next } })}
      onPracticeForms={(practiceDeck, groups) => router.push({ pathname: '/forms-practice', params: { deck: practiceDeck, groups: JSON.stringify(groups) } })}
      onDrill={(point) => router.push({ pathname: '/tool', params: { id: 'grammar', points: JSON.stringify([point]) } })}
      onLesson={(point) => router.push({ pathname: '/read-grammar-lesson', params: { id: point } })}
      onOpenText={(example) => router.push({ pathname: '/reader', params: { source: JSON.stringify({ kind: 'past', text: exampleSource(example) }) } })}
    />
  );
}
