import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import type { Language } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { useApp } from '../ui/AppContext';
import { JournalEntryScreen } from '../ui/journal/JournalEntryScreen';
import { leaveScreen } from '../ui/leaveScreen';
import { usePhoneSpeech } from '../ui/usePhoneSpeech';
import { PRACTICE_PATH } from '../ui/tabPaths';

/** A journal entry, as a sheet from the Journal tool: a new one (`prompt`, `words` from the day's idea) or a kept one (`id`). */
export default function JournalEntryRoute() {
  const router = useRouter();
  const { repo, reader } = useApp();
  const speech = usePhoneSpeech(repo);
  const { language, id, prompt, words } = useLocalSearchParams<{ language: string; id?: string; prompt?: string; words?: string }>();
  if (!reader.api || !(language in LANGUAGES)) return <Redirect href="/read-settings" />;
  const code = language as Language;
  // `decks` is missing from a server older than the deck setting.
  const deck = reader.settings?.decks?.[code] ?? null;
  return (
    <JournalEntryScreen
      api={reader.api}
      onSay={(text) => void speech.sayLine(text, LANGUAGES[code].speech, false)}
      language={code}
      entryId={id ? Number(id) : undefined}
      prompt={prompt}
      words={words ? words.split('\n').filter(Boolean) : []}
      deck={deck}
      toolbar={(
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button accessibilityLabel="Close" onPress={() => leaveScreen(router, PRACTICE_PATH)}>Close</Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
    />
  );
}
