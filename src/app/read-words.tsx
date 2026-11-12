import { Redirect } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { ReadWords } from '../ui/ReadWords';

export default function ReadWordsRoute() {
  const { readerApi } = useApp();
  if (!readerApi) return <Redirect href="/read-settings" />;
  return <ReadWords api={readerApi} />;
}
