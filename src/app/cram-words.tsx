import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { CramWords } from '../ui/cram/CramWords';

/** Add words to the cram named by `id`. */
export default function CramWordsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CramWords repo={useApp().repo} id={id} />;
}
