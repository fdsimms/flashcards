import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { LANGUAGE_ORDER } from '../reader/languages';
import { useApp } from '../ui/AppContext';
import { GrammarTopicNew } from '../ui/GrammarTopicNew';

/** Asking for a grammar topic in the language named by the `language` parameter (Your topics). */
export default function GrammarTopicNewRoute() {
  const router = useRouter();
  const { reader } = useApp();
  const { language } = useLocalSearchParams<{ language: string }>();
  const known = LANGUAGE_ORDER.find((l) => l === language);
  if (!reader.api || !known) return <Redirect href="/read-settings" />;
  return (
    // Replaces this screen, so Back from the page returns to the Grammar list.
    <GrammarTopicNew api={reader.api} language={known} onWriting={(topic) => router.replace({ pathname: '/grammar-topic', params: { id: String(topic.id) } })} />
  );
}
