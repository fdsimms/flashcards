import { useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { WaniKaniReview } from '../ui/WaniKaniReview';

/** Studies WaniKani's reviews and today's lessons. */
export default function WaniKaniRoute() {
  const router = useRouter();
  const { wanikani } = useApp();
  return <WaniKaniReview wanikani={wanikani} onDone={() => router.back()} onOptions={() => router.push('/wanikani-settings')} />;
}
