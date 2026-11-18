import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { CramUsed } from '../ui/cram/CramUsed';

/** On the day: the checklist of the cram named by `id`. */
export default function CramUsedRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CramUsed repo={useApp().repo} id={id} onDone={() => router.back()} />;
}
