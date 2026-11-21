import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { dailyTasksSummary } from '../reader/dailyTasks';
import { settingsPage } from '../core/settingsPages';
import { useApp } from '../ui/AppContext';
import { LessonSettingsRows } from '../ui/reader/LessonSettingsRows';
import { SettingsPage } from '../ui/SettingsPage';
import { useNarrator } from '../ui/useNarrator';
import { useParticle } from '../ui/useParticle';

/** One page's settings (`?page=lessons`): from the gear in a tab's header, or its row in Settings. */
export default function SettingsPageRoute() {
  const router = useRouter();
  const { page } = useLocalSearchParams<{ page?: string }>();
  const { repo, reader } = useApp();
  const narrator = useNarrator();
  const [particle, setParticle] = useParticle();
  const info = settingsPage(page);
  const open = (route: string) => router.push(route as never);
  if (!info) return <Redirect href="/settings" />;
  return (
    <SettingsPage
      page={info.id}
      repo={repo}
      readerOn={!!reader.api}
      dailySummary={dailyTasksSummary(reader.settings)}
      lessonRows={(
        <LessonSettingsRows
          readerOn={!!reader.api}
          narrator={narrator}
          defaultNarrator={reader.settings?.voices?.en?.male}
          language={reader.settings?.language ?? 'fr'}
          particle={particle}
          onParticle={setParticle}
          onOpen={open}
        />
      )}
      onOpen={open}
    />
  );
}
