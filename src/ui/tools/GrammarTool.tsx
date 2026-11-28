import { Stack, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import { grammarPoint } from '../../core/grammar';
import { DRILL_POINTS, dueWhen, grammarListGroups, type DrillState, type GrammarAnswer, type GrammarListRow } from '../../core/grammarDrills';
import { ApiError, type GrammarTopicRow, type Language } from '../../reader/api';
import { LANGUAGES, flaggedName } from '../../reader/languages';
import { FLAG_IMAGES } from '../flagImages';
import { topicLine } from '../../reader/topics';
import { toolLanguage } from '../../tools/tools';
import { loadToolPrefs, saveToolPrefs, toolPrefs } from '../../tools/storage';
import { grammarTag } from '../grammarTag';
import { Button, Card, ErrorNote, Group, Help, Loading, NavRow, Screen, SwipeAction, SwipeToReveal, Tag } from '../kit';
import { Reveal } from '../motion';
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
  // Know it only by the catalog's default: listed, not drilled (`scheduledPoints`).
  const [defaults, setDefaults] = useState<string[]>([]);
  const [answers, setAnswers] = useState<GrammarAnswer[]>([]);
  const [hour, setHour] = useState(4);
  // Your topics in the language; null until known, and after a failed request (a server older than topics has none).
  const [topics, setTopics] = useState<{ language: Language; rows: GrammarTopicRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The topic row slid open on its Delete action; one at a time.
  const [openTopic, setOpenTopic] = useState<number | null>(null);
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
      const got = await readerApi.grammarChoices();
      setChoices(got.choices);
      setDefaults(got.defaults ?? []);
      readerApi.topics(language).then((r) => setTopics({ language, rows: r.topics })).catch(() => setTopics(null));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : failureText(e, { what: "Couldn't load your grammar choices.", next: 'Try again.' }));
    }
  }, [repo, readerApi, language]);
  // Again each time the screen comes back into view: a drill or a choice made on a point's page changes what's due.
  useFocusEffect(useCallback(() => { if (!drilling) load(); }, [load, drilling]));

  const confirmDeleteTopic = (t: GrammarTopicRow) => Alert.alert('Delete this topic?', `"${t.title}" and its page are deleted.`, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete', style: 'destructive',
      onPress: async () => {
        try {
          await readerApi?.deleteTopic(t.id);
          setTopics((p) => (p ? { ...p, rows: p.rows.filter((r) => r.id !== t.id) } : p));
        } catch (e) {
          Alert.alert("Couldn't delete the topic", e instanceof ApiError ? e.message : failureText(e, { next: 'Try again.' }));
        }
      },
    },
  ]);

  if (drilling && readerApi) {
    return (
      <GrammarDrill
        api={readerApi}
        repo={repo}
        points={drilling}
        // A grammar lesson opens a short round (`count`); the Grammar tool's own rounds are the usual length.
        count={opened && params.count ? Number(params.count) || undefined : undefined}
        onDone={() => { if (opened) onClose(); else setDrilling(null); }}
      />
    );
  }

  const chooseLanguage = (l: Language) => { setLanguage(l); saveToolPrefs({ language: l }); };
  const now = new Date();
  const groups = choices ? grammarListGroups(language, choices, answers, now, hour, defaults) : null;
  const name = LANGUAGES[language].name;
  const open = (pointId: string) => router.push({ pathname: '/read-grammar-point', params: { id: pointId } });
  // Each point's state is a colored tag; `when` (Coming up's) follows it.
  const rows = (list: GrammarListRow[], when?: (r: GrammarListRow) => string) => (
    <Group>
      {list.map((r, i) => (
        <NavRow key={r.pointId} first={i === 0} label={grammarPoint(r.pointId)?.name ?? r.pointId} badge={grammarTag(c, r.state)} detail={when?.(r)} onPress={() => open(r.pointId)} />
      ))}
    </Group>
  );
  // The sections settle in one after another once the list has loaded.
  const settle = (i: number) => i * 45;

  return (
    <Screen
      title={tool.title}
      largeTitle={false}
      toolbar={(
        <Stack.Toolbar placement="right">
          {tool.languages.length > 1 ? <Stack.Toolbar.Menu title="Language" icon={FLAG_IMAGES[language]} iconRenderingMode="original" accessibilityLabel={`Language: ${name}. Change the language`}>
            {tool.languages.map((l) => (
              <Stack.Toolbar.MenuAction key={l} isOn={l === language} onPress={() => chooseLanguage(l)}>{flaggedName(l)}</Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu> : null}
          <Stack.Toolbar.Button icon="gearshape" accessibilityLabel="Practice settings" onPress={() => router.push({ pathname: '/settings-page', params: { page: 'practice' } })} />
        </Stack.Toolbar>
      )}
      footer={groups?.due.length ? (
        <Button label="Practice now" onPress={() => setDrilling(groups.due.slice(0, DRILL_POINTS).map((r) => r.pointId))} />
      ) : undefined}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l, gap: space.l }}>
        {!readerApi ? (
          <Card>
            <Text style={{ ...type.headline, color: c.text }}>Grammar uses Read & Listen</Text>
            <Help>Turn it on in Settings, Read & Listen.</Help>
          </Card>
        ) : error ? (
          <ErrorNote message={error} onRetry={load} />
        ) : !groups ? (
          <Loading />
        ) : (
          <>
            {groups.due.length ? (
              <Reveal style={{ gap: space.s }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                  <ControlLabel>Due today</ControlLabel>
                  <Tag text={String(groups.due.length)} color={c.violetInk} fill={c.violetFill} />
                </View>
                {rows(groups.due)}
                {groups.due.length > DRILL_POINTS ? <Help>{`Practice now picks ${DRILL_POINTS} grammar points, the ones set to Practice first. Start again for the rest.`}</Help> : null}
              </Reveal>
            ) : (
              <Help>{groups.later.length
                ? `Nothing due today. Next: ${dueWhen(groups.later[0].schedule!.due, now, hour).toLocaleLowerCase()}.`
                : `Nothing to practice yet. Set a ${name} grammar point to Practice or Know it, and it comes back here.`}</Help>
            )}
            {groups.later.length ? (
              <Reveal delay={settle(1)} style={{ gap: space.s }}>
                <ControlLabel>Coming up</ControlLabel>
                {rows(groups.later, (r) => dueWhen(r.schedule!.due, now, hour))}
              </Reveal>
            ) : null}
            {groups.other.length ? (
              <Reveal delay={settle(2)} style={{ gap: space.s }}>
                <ControlLabel>Not practicing</ControlLabel>
                {rows(groups.other)}
              </Reveal>
            ) : null}
            {topics && topics.language === language ? (
              <View style={{ gap: space.s }}>
                <ControlLabel>Your topics</ControlLabel>
                {topics.rows.length ? (
                  <Group>
                    {topics.rows.map((t, i) => (
                      <SwipeToReveal
                        key={t.id}
                        open={openTopic === t.id}
                        onOpenChange={(o) => setOpenTopic(o ? t.id : null)}
                        onFullSwipe={() => confirmDeleteTopic(t)}
                        action={<SwipeAction destructive icon="trash" label="Delete" accessibilityLabel={`Delete ${t.title}`} onPress={() => { setOpenTopic(null); confirmDeleteTopic(t); }} />}
                      >
                        {/* Tapping a row that's slid open closes it, rather than opening the topic. */}
                        <NavRow first={i === 0} label={t.title} detail={topicLine(t, now, hour)} onPress={() => (openTopic === t.id ? setOpenTopic(null) : router.push({ pathname: '/grammar-topic', params: { id: String(t.id) } }))} />
                      </SwipeToReveal>
                    ))}
                  </Group>
                ) : null}
                <Button label="New topic" variant="secondary" onPress={() => router.push({ pathname: '/grammar-topic-new', params: { language } })} />
                <Help>Topics are pages Claude writes for you. They aren't checked against a grammar book.</Help>
              </View>
            ) : null}
            <Help>Tap a grammar point to read about it and practice it. This doesn't change your cards.</Help>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
