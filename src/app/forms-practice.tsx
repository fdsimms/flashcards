import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { FormsPractice } from '../ui/FormsPractice';

/**
 * Practicing one pattern's forms across the deck named by the `deck` parameter. `groups` (JSON), from
 * a grammar point's page, is the kinds of form to start with.
 */
export default function FormsPracticeRoute() {
  const router = useRouter();
  const { repo, reader } = useApp();
  const { deck, groups } = useLocalSearchParams<{ deck: string; groups?: string }>();
  let start: string[] | undefined;
  try { start = groups ? (JSON.parse(groups) as string[]) : undefined; } catch { start = undefined; }
  return <FormsPractice repo={repo} readerApi={reader.api} deck={deck} startGroups={start} onStart={(request) => router.push({ pathname: '/forms-drill', params: { request: JSON.stringify(request) } })} />;
}
