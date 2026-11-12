import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { useApp } from '../ui/AppContext';
import { Review } from '../ui/Review';

/** Studies the deck named by the `deck` parameter, and its subdecks. */
export default function ReviewRoute() {
  const router = useRouter();
  const { repo, sync, openNoteEditor } = useApp();
  const { deck } = useLocalSearchParams<{ deck: string }>();
  // Sync when leaving, however it's left: the Back button, the swipe, or "Back to decks".
  const syncRef = useRef(sync);
  syncRef.current = sync;
  useEffect(() => () => { syncRef.current(); }, []);
  return <Review repo={repo} deck={deck} onDone={() => router.back()} onEditNote={openNoteEditor} />;
}
