import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { ApiError, type Api, type GrammarChoice, type TextGrammar } from '../reader/api';
import { HeaderAction } from './kit';
import { space, type, useTheme } from './theme';

/**
 * The tapped word's grammar, in the reader's popover: why the word is marked, and for a point
 * never marked, buttons to mark it from here (docs/read-and-listen/architecture.md, Grammar).
 * `chosen` is what was picked for it earlier in this session, which the text itself doesn't know.
 */
export function ReadGrammarNote({ grammar, api, chosen, onChosen }: {
  grammar: TextGrammar;
  api: Api;
  chosen: GrammarChoice | undefined;
  onChosen: (id: string, state: GrammarChoice) => void;
}) {
  const c = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const about = `${grammar.name}. ${grammar.note}.`;
  const line = {
    practice: `Grammar you're practicing: ${about}`,
    avoid: `${grammar.name}, which you don't know yet, slipped in here. ${grammar.note}.`,
    review: `Grammar you know, worked in for review: ${about}`,
    unset: `Grammar you haven't marked yet: ${about}`,
  }[grammar.role];

  const mark = async (state: GrammarChoice) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.setGrammar(grammar.id, state);
      onChosen(grammar.id, state);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't change that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{line}</Text>
      {grammar.role === 'unset' && chosen ? (
        <Text style={{ ...type.footnote, color: c.textSecondary }}>
          {chosen === 'avoid' ? "Marked as Don't know it. It's kept out of texts written from now on." : 'Marked as Know it. Applies from the next text written.'}
        </Text>
      ) : grammar.role === 'unset' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.m }}>
          <HeaderAction label="I know it" accessibilityLabel={`I know the ${grammar.name}`} onPress={() => mark('normal')} />
          <HeaderAction label="I don't know it" accessibilityLabel={`I don't know the ${grammar.name}`} onPress={() => mark('avoid')} />
        </View>
      ) : null}
      {error ? <Text style={{ ...type.footnote, color: c.danger }}>{error}</Text> : null}
    </View>
  );
}
