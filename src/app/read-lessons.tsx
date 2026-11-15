import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { ReadLessons } from '../ui/ReadLessons';

/** Audio lessons, from the shelf's row. */
export default function ReadLessonsRoute() {
  const router = useRouter();
  const { reader } = useApp();
  if (!reader.api) return <Redirect href="/read-settings" />;
  return (
    <ReadLessons
      api={reader.api}
      language={reader.settings?.language ?? 'fr'}
      onOpen={(lesson) => router.push({ pathname: '/read-lesson', params: { lesson: JSON.stringify(lesson) } })}
    />
  );
}
