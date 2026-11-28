import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { FilteredDeckEditor } from '../ui/FilteredDeckEditor';

/**
 * A new filtered deck (from the deck list, or Browse's search as `search`), or a filtered deck's
 * options (`deck`). A deck just built is studied: it replaces this screen, so Back returns to where
 * it was made from. A changed deck goes back to where its options were opened.
 */
export default function FilteredDeckRoute() {
  const router = useRouter();
  const { repo, refresh } = useApp();
  const { deck, search } = useLocalSearchParams<{ deck?: string; search?: string }>();
  return (
    <FilteredDeckEditor
      repo={repo}
      existing={deck || undefined}
      initialSearch={search || undefined}
      onBuilt={(name) => {
        refresh();
        if (deck) router.back();
        else router.replace({ pathname: '/review', params: { deck: name } });
      }}
    />
  );
}
