import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { ScrollView } from 'react-native';
import { LANGUAGES } from '../../../reader/languages';
import { lessonsOffered } from '../../../reader/lessons';
import { useApp } from '../../../ui/AppContext';
import { Help, Screen } from '../../../ui/kit';
import { LessonLanguageMenu, useLessonLanguage } from '../../../ui/reader/LessonLanguageMenu';
import { ReadLessons } from '../../../ui/reader/ReadLessons';
import { readable, space } from '../../../ui/theme';
import { useNarrator } from '../../../ui/useNarrator';
import { useParticle } from '../../../ui/useParticle';

/**
 * The Lessons tab: audio lessons, guided phrases to say aloud, in the language Read & Listen is
 * reading (it was a row on that tab's home until it became browsing stories and texts). Made by
 * Read & Listen's server, so it's there only while that's signed in.
 */
export default function LessonsRoute() {
  const router = useRouter();
  const { reader } = useApp();
  const narrator = useNarrator();
  const [particle, setParticle] = useParticle();
  const pick = useLessonLanguage(reader.api, reader.setSettings);
  if (!reader.api) return <Redirect href="/read-settings" />;
  const language = reader.settings?.language ?? 'fr';
  const toolbar = <LessonLanguageMenu language={language} onPick={pick} />;
  if (!lessonsOffered(language)) {
    return (
      <Screen title="Audio lessons" toolbar={toolbar}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l }}>
          <Help>{`Audio lessons aren't made in ${LANGUAGES[language].name}. Pick a language they're made in from the flag at the top, and its lessons show here.`}</Help>
        </ScrollView>
      </Screen>
    );
  }
  return (
    <ReadLessons
      api={reader.api}
      language={language}
      toolbar={toolbar}
      narrator={narrator}
      defaultNarrator={reader.settings?.voices?.en?.male}
      particle={particle}
      onNarrator={() => router.push('/read-narrator')}
      onParticle={setParticle}
      onOpen={(lesson) => router.push({ pathname: '/read-lesson', params: { lesson: JSON.stringify(lesson) } })}
    />
  );
}
