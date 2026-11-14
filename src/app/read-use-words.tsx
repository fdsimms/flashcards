import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import type { Language } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import type { WordToUse } from '../reader/production';
import { useApp } from '../ui/AppContext';
import { ReadUseWords } from '../ui/ReadUseWords';
import { usePhoneSpeech } from '../ui/usePhoneSpeech';

/** Use today's words, opened from a review session's end with the words learned in it (`words`, JSON). */
export default function ReadUseWordsRoute() {
  const router = useRouter();
  const { reader, repo } = useApp();
  const speech = usePhoneSpeech(repo);
  const params = useLocalSearchParams<{ language: string; words: string }>();
  const language = params.language && params.language in LANGUAGES ? (params.language as Language) : null;
  const words = useMemo<WordToUse[]>(() => {
    try { return JSON.parse(params.words ?? '[]') as WordToUse[]; } catch { return []; }
  }, [params.words]);
  if (!reader.api || !language) return <Redirect href="/read-settings" />;
  return (
    <ReadUseWords
      api={reader.api}
      language={language}
      words={words}
      onPlay={(text) => speech.sayWord(text, LANGUAGES[language].speech)}
      onDone={() => router.back()}
    />
  );
}
