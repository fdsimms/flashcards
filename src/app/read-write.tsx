import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { ReadWrite } from '../ui/reader/ReadWrite';

/** Writing a text for the shelf, from its + button, as a sheet over it. */
export default function ReadWriteRoute() {
  const router = useRouter();
  const { reader } = useApp();
  if (!reader.api) return <Redirect href="/read-settings" />;
  return <ReadWrite api={reader.api} language={reader.settings?.language} onDone={() => router.back()} />;
}
