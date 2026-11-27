import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { leaveScreen } from '../ui/leaveScreen';
import { LookUp } from '../ui/LookUp';
import { shareInbox } from '../ui/shareInbox';
import { DECKS_PATH } from '../ui/tabPaths';
import { useCardGlossing } from '../ui/useCardGlossing';

/** Look up, as a sheet from Today's magnifier, Decks' menu or a word shared from another app (`shared`, useShareInbox). */
export default function LookUpRoute() {
  const router = useRouter();
  const { repo, reader } = useApp();
  const glossing = useCardGlossing(repo);
  const { shared: sharedId } = useLocalSearchParams<{ shared?: string }>();
  // A word shared to look up: kept until this sheet closes.
  const shared = shareInbox.get(sharedId);
  const done = () => {
    if (shared) shareInbox.remove(shared.id);
    leaveScreen(router, DECKS_PATH);
  };
  return (
    <LookUp
      glossing={glossing}
      initial={shared?.text}
      readerLanguage={reader.settings?.language}
      toolbar={(
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button accessibilityLabel="Done" onPress={done}>Done</Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
    />
  );
}
