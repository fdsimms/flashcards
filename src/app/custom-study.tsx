import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { CustomStudy } from '../ui/CustomStudy';
import { leaveScreen } from '../ui/leaveScreen';
import { DECKS_PATH } from '../ui/tabPaths';

/** Custom study for the deck named by the `deck` parameter, over the review screen or the deck's options. */
export default function CustomStudyRoute() {
  const router = useRouter();
  const { repo, refresh } = useApp();
  const { deck } = useLocalSearchParams<{ deck: string }>();
  return (
    <CustomStudy
      repo={repo}
      deck={deck}
      onStarted={async (result) => {
        // A raised limit goes back to where it was asked from: Review loads the deck again on focus,
        // and the deck list's counts are refreshed here, since they're otherwise from when it was last
        // shown. Cards moved into the session deck are studied there: it replaces this sheet, so Back
        // returns to the deck. The list is refreshed first here too: a session deck left empty by an
        // earlier session is listed with no cards, and Review would open it as a deck with nothing in it.
        if (result.kind === 'limits') { refresh(); leaveScreen(router, DECKS_PATH); }
        else {
          await refresh().catch(() => undefined);
          router.replace({ pathname: '/review', params: { deck: result.deck } });
        }
      }}
    />
  );
}
