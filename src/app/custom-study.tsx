import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { CustomStudy } from '../ui/CustomStudy';

/** Custom study for the deck named by the `deck` parameter, over the review screen or the deck's options. */
export default function CustomStudyRoute() {
  const router = useRouter();
  const { repo, refresh } = useApp();
  const { deck } = useLocalSearchParams<{ deck: string }>();
  return (
    <CustomStudy
      repo={repo}
      deck={deck}
      onStarted={(result) => {
        // A raised limit goes back to where it was asked from: Review loads the deck again on focus,
        // and the deck list's counts are refreshed here, since they're otherwise from when it was last
        // shown. Cards moved into the session deck are studied there: it replaces this sheet, so Back
        // returns to the deck.
        if (result.kind === 'limits') { refresh(); router.back(); }
        else router.replace({ pathname: '/review', params: { deck: result.deck } });
      }}
    />
  );
}
