import { Stack, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import { grammarPoint } from '../../core/grammar';
import { DRILL_POINTS, dueWhen, grammarListGroups, type DrillState, type GrammarAnswer, type GrammarListRow } from '../../core/grammarDrills';
import { ApiError, type GrammarTopicRow, type Language } from '../../reader/api';
import { grammarStateWord } from '../../reader/grammar';
import { LANGUAGES, flaggedName } from '../../reader/languages';
import { topicLine } from '../../reader/topics';
import { toolLanguage } from '../../tools/tools';
import { loadToolPrefs, saveToolPrefs, toolPrefs } from '../../tools/storage';
import { Button, Card, ErrorNote, Group, Help, NavRow, Screen } from '../kit';
import { space, type, useTheme, readable } from '../theme';
import { GrammarDrill } from './GrammarDrill';
import type { ToolScreenProps } from './index';
import { ControlLabel } from './ToolScreen';

/**
 * The Grammar screen (docs/grammar.md, steps 4 and 5): a language's points, in the language chosen in
 * the header's menu, grouped as due today, coming up and not practiced (src/core/grammarDrills.ts, worked
 * out from the phone's answers). A point opens its page, where it's read about and practiced; Practice now
 * starts a drill on those due today. Opened with `points` (from a point's page), it goes straight to a
 * drill on them and closes after.
 */
export function GrammarTool({ tool, repo, readerApi, params, onClose }: ToolScreenProps) {
  const c = useTheme();
  const router = useRouter();
  const [language, setLanguage] = useState<Language>(() => toolLanguage(tool, toolPrefs().language));
  const [choices, setChoices] = useState<Record<string, DrillState> | null>(null);
  const [answers, setAnswers] = useState<GrammarAnswer[]>([]);
  const [hour, setHour] = useState(4);
  // Your topics in the language; null until known, and after a failed request (a server older than topics has none).
  const [topics, setTopics] = useState<{ language: Language; rows: GrammarTopicRow[] } | null>(null);
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
    try {
      const [mine, settings] = await Promise.all([repo.listGrammarAnswers(), repo.collectionSettings()]);
      setAnswers(mine);
      setHour(settings.dayStartsAtHour);
      if (!readerApi) return;
      setChoices((await readerApi.grammarChoices()).choices);
      readerApi.topics(language).then((r) => setTopics({ language, rows: r.topics })).catch(() => setTopics(null));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : failureText(e, { what: "Couldn't load your grammar choices.", next: 'Try again.' }));
    }
  }, [repo, readerApi, language]);
  // Again each time the screen comes back into view: a drill or a choice made on a point's page changes what's due.
  useFocusEffect(useCallback(() => { if (!drilling) load(); }, [load, drilling]));

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
  const groups = choices ? grammarListGroups(language, choices, answers, now, hour) : null;
  const name = LANGUAGES[language].name;
  const open = (pointId: string) => router.push({ pathname: '/read-grammar-point', params: { id: pointId } });
  const rows = (list: GrammarListRow[], detail: (r: GrammarListRow) => string) => (
    <Group>
      {list.map((r, i) => (
        <NavRow key={r.pointId} first={i === 0} label={grammarPoint(r.pointId)?.name ?? r.pointId} detail={detail(r)} onPress={() => open(r.pointId)} />
      ))}
    </Group>
  );

  return (
    <Screen
      title={tool.title}
      largeTitle={false}
      toolbar={tool.languages.length > 1 ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu title="Language" accessibilityLabel={`Language: ${name}. Change the language`}>
            <Stack.Toolbar.Label>{flaggedName(language)}</Stack.Toolbar.Label>
            {tool.languages.map((l) => (
              <Stack.Toolbar.MenuAction key={l} isOn={l === language} onPress={() => chooseLanguage(l)}>{flaggedName(l)}</Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : undefined}
      footer={groups?.due.length ? (
        <Button label="Practice now" onPress={() => setDrilling(groups.due.slice(0, DRILL_POINTS).map((r) => r.pointId))} />
      ) : undefined}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l, gap: space.l }}>
        {!readerApi ? (
          <Card>
            <Text style={{ ...type.headline, color: c.text }}>Grammar needs Read & Listen</Text>
            <Help>Which grammar you're practicing, and the questions, come from Read & Listen's server. Turn it on in Settings, Read & Listen.</Help>
          </Card>
        ) : error ? (
          <ErrorNote message={error} onRetry={load} />
        ) : !groups ? (
          <ActivityIndicator color={c.accent} />
        ) : (
          <>
            {groups.due.length ? (
              <View style={{ gap: space.s }}>
                <ControlLabel>Due today</ControlLabel>
                {rows(groups.due, (r) => grammarStateWord(r.state))}
                {groups.due.length > DRILL_POINTS ? <Help>{`Practice now mixes ${DRILL_POINTS} grammar points, Practice ones first. Start again for the rest.`}</Help> : null}
              </View>
            ) : (
              <Help>{groups.later.length
                ? `Nothing due today. Next: ${dueWhen(groups.later[0].schedule!.due, now, hour).toLocaleLowerCase()}.`
                : `Nothing to practice yet. Set a ${name} grammar point to Practice or Know it, and it comes back here.`}</Help>
            )}
            {groups.later.length ? (
              <View style={{ gap: space.s }}>
                <ControlLabel>Coming up</ControlLabel>
                {rows(groups.later, (r) => `${grammarStateWord(r.state)} · ${dueWhen(r.schedule!.due, now, hour)}`)}
              </View>
            ) : null}
            {groups.other.length ? (
              <View style={{ gap: space.s }}>
                <ControlLabel>Not practicing</ControlLabel>
                {rows(groups.other, (r) => grammarStateWord(r.state))}
              </View>
            ) : null}
            {topics && topics.language === language ? (
              <View style={{ gap: space.s }}>
                <ControlLabel>Your topics</ControlLabel>
                {topics.rows.length ? (
                  <Group>
                    {topics.rows.map((t, i) => (
                      <NavRow key={t.id} first={i === 0} label={t.title} detail={topicLine(t, now, hour)} onPress={() => router.push({ pathname: '/grammar-topic', params: { id: String(t.id) } })} />
                    ))}
                  </Group>
                ) : null}
                <Button label="New topic" variant="secondary" onPress={() => router.push({ pathname: '/grammar-topic-new', params: { language } })} />
                <Help>Topics are pages Claude writes for you. They aren't checked against a grammar book.</Help>
              </View>
            ) : null}
            <Help>Tap a grammar point to read about it and practice it. Practice here never changes your flashcards.</Help>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
