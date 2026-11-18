import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { CramRound } from '../ui/cram/CramRound';

/** A round of the cram named by `id`. */
export default function CramRoundRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CramRound repo={useApp().repo} id={id} onDone={() => router.back()} />;
}
