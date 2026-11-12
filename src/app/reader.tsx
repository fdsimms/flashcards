import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { useApp } from '../ui/AppContext';
import { Reader, type ReaderSource } from '../ui/Reader';

/**
 * The reader. Its `source` parameter is a shelf text, a topic to write a text for, or a past text,
 * as JSON. Next replaces it with the next shelf text, in place, so Back still returns to the shelf.
 */
export default function ReaderRoute() {
  const router = useRouter();
  const { reader } = useApp();
  const readerApi = reader.api;
  const { source: raw } = useLocalSearchParams<{ source: string }>();
  const source = useMemo<ReaderSource | null>(() => {
    try { return JSON.parse(raw) as ReaderSource; } catch { return null; }
  }, [raw]);
  if (!readerApi || !source) return <Redirect href={readerApi ? '/read' : '/read-settings'} />;
  return (
    <Reader
      api={readerApi}
      source={source}
      settings={reader.settings}
      onSettings={reader.setSettings}
      onNext={(next) => router.setParams({ source: JSON.stringify(next) })}
      onDone={() => router.back()}
    />
  );
}
