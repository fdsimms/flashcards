import { useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { backToDecks } from '../ui/leaveScreen';
import { WaniKaniReview } from '../ui/WaniKaniReview';

/** Studies WaniKani's reviews and today's lessons. */
export default function WaniKaniRoute() {
  const router = useRouter();
  const { wanikani } = useApp();
  return <WaniKaniReview wanikani={wanikani} onDone={() => backToDecks(router)} onOptions={() => router.push('/wanikani-settings')} />;
}
