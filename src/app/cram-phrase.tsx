import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { CramPhraseEdit } from '../ui/cram/CramPhraseEdit';

/** Editing the phrase `text` of the cram `id` (the phrase's menu, Edit). */
export default function CramPhraseRoute() {
  const router = useRouter();
  const { id, text } = useLocalSearchParams<{ id: string; text: string }>();
  const { repo } = useApp();
  return <CramPhraseEdit repo={repo} id={id} text={text} onDone={() => router.back()} />;
}
