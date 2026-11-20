import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { useApp } from '../ui/AppContext';
import { ReadDailyTasks } from '../ui/reader/ReadDailyTasks';
import { leaveScreen } from '../ui/leaveScreen';
import { DECKS_PATH } from '../ui/tabPaths';

/** Which languages dundundun adds a daily Read & Listen task for, from Read & Listen's settings. */
export default function ReadDailyTasksRoute() {
  const router = useRouter();
  const { reader } = useApp();
  // Read & Listen was turned off (or its passphrase changed): back to its settings.
  useEffect(() => { if (!reader.api) leaveScreen(router, DECKS_PATH); }, [reader.api, router]);
  if (!reader.api) return null;
  return <ReadDailyTasks api={reader.api} onSettings={reader.setSettings} />;
}
