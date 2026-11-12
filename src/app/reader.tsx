import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { useApp } from '../ui/AppContext';
import { Reader, type ReaderSource } from '../ui/Reader';

/** The reader. Its `source` parameter is the topic to write a text for, or a past text, as JSON. */
export default function ReaderRoute() {
  const router = useRouter();
  const { reader: { api: readerApi } } = useApp();
  const { source: raw } = useLocalSearchParams<{ source: string }>();
  const source = useMemo<ReaderSource | null>(() => {
    try { return JSON.parse(raw) as ReaderSource; } catch { return null; }
  }, [raw]);
  if (!readerApi || !source) return <Redirect href={readerApi ? '/read' : '/read-settings'} />;
  return <Reader api={readerApi} source={source} onDone={() => router.back()} />;
}
