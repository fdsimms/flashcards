import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { FormsPractice } from '../ui/FormsPractice';

/** Practicing one pattern's forms across the deck named by the `deck` parameter. */
export default function FormsPracticeRoute() {
  const router = useRouter();
  const { repo, reader } = useApp();
  const { deck } = useLocalSearchParams<{ deck: string }>();
  return <FormsPractice repo={repo} readerApi={reader.api} deck={deck} onStart={(request) => router.push({ pathname: '/forms-drill', params: { request: JSON.stringify(request) } })} />;
}
