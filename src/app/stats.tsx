import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { useApp } from '../ui/AppContext';
import { Stats } from '../ui/Stats';
import { answersFromLog } from '../wanikani/log';

export default function StatsRoute() {
  const { repo, wanikani } = useApp();
  const answers = useMemo(() => answersFromLog(wanikani.log), [wanikani.log]);
  return <Stats repo={repo} wanikani={answers} onTrouble={() => router.push('/trouble')} />;
}
