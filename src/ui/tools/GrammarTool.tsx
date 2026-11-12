import { Stack } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { grammarPoint } from '../../core/grammar';
import { DRILL_POINTS, DRILL_QUESTIONS, duePoints, dueWhen, scheduledPoints, type DrillState, type GrammarAnswer } from '../../core/grammarDrills';
import { ApiError, type Language } from '../../reader/api';
import { grammarStateWord } from '../../reader/grammar';
import { LANGUAGES } from '../../reader/languages';
import { toolLanguage } from '../../tools/tools';
import { loadToolPrefs, saveToolPrefs, toolPrefs } from '../../tools/storage';
import { Button, Card, ErrorNote, Group, Help, NavRow, Screen } from '../kit';
import { space, type, useTheme } from '../theme';
import { GrammarDrill } from './GrammarDrill';
import type { ToolScreenProps } from './index';

/**
 * Grammar drills (docs/grammar.md, step 5): the points set to Practice or Know it in Read & Listen,
 * in the language chosen in the header's menu, with when each is next due (worked out from the
 * phone's answers, src/core/grammarDrills.ts), and Start for those due today. Opened with `points`
 * (from a point's page), it goes straight to a drill on them and closes after.
 */
export function GrammarTool({ tool, repo, readerApi, params, onClose }: ToolScreenProps) {
  const c = useTheme();
  const [language, setLanguage] = useState<Language>(() => toolLanguage(tool, toolPrefs().language));
  const [choices, setChoices] = useState<Record<string, DrillState> | null>(null);
  const [answers, setAnswers] = useState<GrammarAnswer[]>([]);
  const [hour, setHour] = useState(4);
  const [error, setError] = useState<string | null>(null);
  const [drilling, setDrilling] = useState<string[] | null>(() => {
    try { return params.points ? (JSON.parse(params.points) as string[]) : null; } catch { return null; }
  });
  const opened = !!params.points;

  useEffect(() => {
    let live = true;
    loadToolPrefs().then((p) => { if (live) setLanguage(toolLanguage(tool, p.language)); });
    return () => { live = false; };
  }, [tool]);

  const load = useCallback(async () => {
    setError(null);
    const [mine, settings] = await Promise.all([repo.listGrammarAnswers(), repo.collectionSettings()]);
    setAnswers(mine);
    setHour(settings.dayStartsAtHour);
    if (!readerApi) return;
    try {
      setChoices((await readerApi.grammarChoices()).choices);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your grammar choices.");
    }
  }, [repo, readerApi]);
  useEffect(() => { if (!drilling) load(); }, [load, drilling]);

  if (drilling && readerApi) {
    return (
      <GrammarDrill
        api={readerApi}
        repo={repo}
        points={drilling}
        onDone={() => { if (opened) onClose(); else setDrilling(null); }}
      />
    );
  }

  const chooseLanguage = (l: Language) => { setLanguage(l); saveToolPrefs({ language: l }); };
  const now = new Date();
  const due = choices ? duePoints(language, choices, answers, now, hour) : [];
  const scheduled = choices ? scheduledPoints(language, choices, answers, now, hour) : [];
  const name = LANGUAGES[language].name;

  return (
    <Screen
      title={tool.title}
      largeTitle={false}
      toolbar={tool.languages.length > 1 ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu title="Language" accessibilityLabel={`Language: ${name}. Change the language`}>
            <Stack.Toolbar.Label>{name}</Stack.Toolbar.Label>
            {tool.languages.map((l) => (
              <Stack.Toolbar.MenuAction key={l} isOn={l === language} onPress={() => chooseLanguage(l)}>{LANGUAGES[l].name}</Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : undefined}
      footer={due.length ? (
        <Button label={`Start: ${DRILL_QUESTIONS} questions`} onPress={() => setDrilling(due.slice(0, DRILL_POINTS).map((s) => s.pointId))} />
      ) : undefined}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l, gap: space.l }}>
        {!readerApi ? (
          <Card>
            <Text style={{ ...type.headline, color: c.text }}>Grammar drills need Read & Listen</Text>
            <Help>Which grammar you're practicing, and the questions, come from Read & Listen's server. Turn it on in Settings, Read & Listen.</Help>
          </Card>
        ) : error ? (
          <ErrorNote message={error} onRetry={load} />
        ) : !choices ? (
          <ActivityIndicator color={c.accent} />
        ) : !scheduled.length ? (
          <Card>
            <Text style={{ ...type.headline, color: c.text }}>{`No ${name} grammar to drill yet`}</Text>
            <Help>{`Set a ${name} grammar point to Practice or Know it on Read & Listen's Grammar screen, and it's drilled here: Practice ones after 1, 3, 7, 14 and 30 days, Know it ones less often.`}</Help>
          </Card>
        ) : (
          <>
            <Card style={{ gap: space.xs }}>
              <Text style={{ ...type.headline, color: c.text }}>
                {due.length ? `${due.length} due today` : `Nothing due today. Next: ${dueWhen(scheduled[0].due, now, hour).toLocaleLowerCase()}`}
              </Text>
              <Help>
                {due.length > DRILL_POINTS
                  ? `A drill mixes ${DRILL_POINTS} points, Practice ones first; start another for the rest.`
                  : "A point that goes well (8 in 10 right) comes back later each time; one that doesn't comes back tomorrow."}
              </Help>
            </Card>
            <View style={{ gap: space.s }}>
              <Text style={{ ...type.overline, color: c.textSecondary, paddingHorizontal: space.xs }}>Drilled</Text>
              <Group>
                {scheduled.map((s, i) => (
                  <NavRow
                    key={s.pointId}
                    first={i === 0}
                    label={grammarPoint(s.pointId)?.name ?? s.pointId}
                    detail={`${grammarStateWord(s.state)} · ${dueWhen(s.due, now, hour)}`}
                    onPress={() => setDrilling([s.pointId])}
                  />
                ))}
              </Group>
              <Help>Tap a point to drill it now. Answers stay on this phone and never change a card.</Help>
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
