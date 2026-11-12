import { Redirect } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { ReadGrammar } from '../ui/ReadGrammar';

export default function ReadGrammarRoute() {
  const { reader: { api: readerApi } } = useApp();
  if (!readerApi) return <Redirect href="/read-settings" />;
  return <ReadGrammar api={readerApi} />;
}
