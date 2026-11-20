import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { SkillCards } from '../ui/SkillCards';
import { leaveScreen } from '../ui/leaveScreen';
import { DECKS_PATH } from '../ui/tabPaths';

/** Add skill cards to the deck named by the `deck` parameter, from its options. */
export default function SkillCardsRoute() {
  const router = useRouter();
  const { deck } = useLocalSearchParams<{ deck: string }>();
  return <SkillCards deck={deck} onDone={() => leaveScreen(router, DECKS_PATH)} />;
}
