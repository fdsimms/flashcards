import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { ReadGrammar } from '../ui/ReadGrammar';

export default function ReadGrammarRoute() {
  const router = useRouter();
  const { reader: { api: readerApi, dayStartsAtHour } } = useApp();
  if (!readerApi) return <Redirect href="/read-settings" />;
  return <ReadGrammar api={readerApi} dayStartsAtHour={dayStartsAtHour} onOpenPoint={(id) => router.push({ pathname: '/read-grammar-point', params: { id } })} />;
}
