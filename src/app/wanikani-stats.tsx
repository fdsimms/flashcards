import { useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { WaniKaniStats } from '../ui/WaniKaniStats';

/** WaniKani's level, items by stage and reviews coming up, from its row's menu. */
export default function WaniKaniStatsRoute() {
  const router = useRouter();
  const { wanikani } = useApp();
  return <WaniKaniStats wanikani={wanikani} onStats={() => router.push('/stats')} />;
}
