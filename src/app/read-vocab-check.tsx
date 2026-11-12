import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { useApp } from '../ui/AppContext';
import { ReadVocabCheck } from '../ui/ReadVocabCheck';
import { useWordAudio } from '../ui/useWordAudio';

/** The current Read & Listen language's vocabulary check, from its settings page. */
export default function ReadVocabCheckRoute() {
  const router = useRouter();
  const { reader, repo } = useApp();
  const playWord = useWordAudio(repo);
  const language = reader.settings?.language;
  const current = language ? reader.settings?.common?.[language] : undefined;
  // Thai has no common words setting, and a server older than the setting doesn't send it.
  if (!reader.api || !language || current === undefined) return <Redirect href={reader.api ? '/read-language' : '/read-settings'} />;
  return (
    <ReadVocabCheck
      api={reader.api}
      language={language}
      current={current}
      onSettings={reader.setSettings}
      onPlayWord={playWord}
      onDone={() => router.back()}
    />
  );
}
