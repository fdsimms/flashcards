import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { saveToolPrefs } from '../tools/storage';
import { topicFocus } from '../reader/topics';
import { useApp } from '../ui/AppContext';
import { GrammarTopicPage } from '../ui/GrammarTopicPage';
import { leaveScreen } from '../ui/leaveScreen';
import { READ_PATH } from '../ui/tabPaths';

/** A grammar topic's page, for the topic named by the `id` parameter (Your topics). */
export default function GrammarTopicRoute() {
  const router = useRouter();
  const { reader } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const topicId = Number(id);
  if (!reader.api) return <Redirect href="/read-settings" />;
  if (!Number.isInteger(topicId)) return <Redirect href="/read-settings" />;
  return (
    <GrammarTopicPage
      api={reader.api}
      id={topicId}
      onSituations={(topic) => {
        // Situations opens in the language it was last used in, so set it to the topic's.
        saveToolPrefs({ language: topic.language });
        router.push({ pathname: '/tool', params: { id: 'situations', focus: JSON.stringify(topicFocus(topic)) } });
      }}
      onDeleted={() => leaveScreen(router, READ_PATH)}
    />
  );
}
