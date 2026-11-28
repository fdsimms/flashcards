import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { Language } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { SOUND_GUIDES } from '../tools/soundGuides';
import { TOOLS } from '../tools/tools';
import { markSoundsSeen } from './fromZeroActions';
import { Card, Group, Help, NavRow, Screen, Tappable } from './kit';
import { readable, space, type, useTheme } from './theme';
import { TOOL_SCREENS } from './tools';
import { PlayDot } from './PlayCircle';

/** The tools that teach a language's letters one by one, offered after its guide where they come in it. */
const LETTER_TOOLS = ['script', 'hearing', 'writing'] as const;

/**
 * How a language sounds (src/tools/soundGuides.ts): the letters and sounds that aren't read the way English
 * reads them, each with a word the phone's voice reads on a tap, what holds for every word, and the Practice
 * tools that drill its letters. On the path of a language started from zero (`SoundGuideScreen`) and as the
 * Practice tab's How it sounds (SoundsTool.tsx). Opening it counts the path's first step done.
 */
export function SoundGuide({ language, onSay }: { language: Language; onSay: (word: string) => void }) {
  const c = useTheme();
  const router = useRouter();
  const info = LANGUAGES[language];
  const guide = SOUND_GUIDES[language];
  useEffect(() => { void markSoundsSeen(language); }, [language]);
  const tools = TOOLS.filter((t) => (LETTER_TOOLS as readonly string[]).includes(t.id) && t.languages.includes(language));
  return (
    <View style={{ gap: space.m }}>
      {!guide ? <Help>{`There's no guide for ${info.name} yet.`}</Help> : (
        <>
          <Help>{"The sounds that aren't read the way English reads them. Tap one to hear its word."}</Help>
          <Card style={{ paddingVertical: space.xs, gap: 0 }}>
            {guide.rows.map((row, i) => (
              <Tappable
                key={`${row.spelled}|${row.example}`}
                onPress={() => onSay(row.example)}
                accessibilityRole="button"
                accessibilityLabel={`${row.spelled}. ${row.hint} Play ${row.example}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m, borderTopWidth: i ? 1 : 0, borderTopColor: c.border }}
              >
                <Text style={{ ...type.title, color: c.text, width: 72, textAlign: 'center' }} accessibilityLanguage={info.speech} adjustsFontSizeToFit numberOfLines={2}>{row.spelled}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ ...type.headline, color: c.text }} accessibilityLanguage={info.speech}>{row.example}</Text>
                  <Text style={{ ...type.subhead, color: c.textSecondary }}>{row.hint}</Text>
                </View>
                <PlayDot />
              </Tappable>
            ))}
          </Card>
          {guide.notes.map((n) => <Help key={n}>{n}</Help>)}
        </>
      )}
      {tools.length ? (
        <Group>
          {tools.map((t, i) => (
            <NavRow
              key={t.id}
              first={i === 0}
              icon={{ name: TOOL_SCREENS[t.id].icon, color: TOOL_SCREENS[t.id].color(c) }}
              label={t.title}
              detail={t.summary}
              onPress={() => router.push({ pathname: '/tool', params: { id: t.id } })}
            />
          ))}
        </Group>
      ) : null}
    </View>
  );
}

/** The guide as its own screen, from a language's path on Today. */
export function SoundGuideScreen({ language, onSay }: { language: Language; onSay: (word: string) => void }) {
  return (
    <Screen title={`How ${LANGUAGES[language].name} sounds`} largeTitle={false}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.xl }}>
        <SoundGuide language={language} onSay={onSay} />
      </ScrollView>
    </Screen>
  );
}
