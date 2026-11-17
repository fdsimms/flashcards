import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { failureText } from '../core/failure';
import { explanationParagraphs } from '../core/grammar';
import { ApiError, type Api, type GrammarTopic } from '../reader/api';
import { TOPIC_POLL_MS, topicWriting } from '../reader/topics';
import { GrammarExamples } from './GrammarExamples';
import { Button, Card, ErrorNote, Group, Help, NavRow, Screen, SectionTitle } from './kit';
import { MakingCard } from './MakingCard';
import { hairline, radius, space, type, useTheme, readable, smooth } from './theme';

/**
 * A grammar topic's page (Your topics): what Claude wrote for the topic, laid out as a point's page is, with
 * a notice that it isn't checked against a grammar book (code only checks the vocabulary and format). While
 * it's being written the screen asks the server again every few seconds. Practice is Situations with the
 * topic as its focus. Nothing here grades a card, schedules anything or counts as exposure.
 */
export function GrammarTopicPage({ api, id, onSituations, onDeleted }: {
  api: Api;
  id: number;
  /** Opens Situations practicing this topic. */
  onSituations: (topic: GrammarTopic) => void;
  /** Leaves after the topic is deleted. */
  onDeleted: () => void;
}) {
  const c = useTheme();
  const [topic, setTopic] = useState<GrammarTopic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const acting = useRef(false);

  const fail = (e: unknown, what: string) => setError(e instanceof ApiError ? e.message : failureText(e, { what, next: 'Try again.' }));

  const load = useCallback(async () => {
    try {
      setTopic(await api.topic(id));
      setError(null);
    } catch (e) {
      fail(e, "Couldn't load this topic.");
    }
  }, [api, id]);
  useEffect(() => { load(); }, [load]);

  // New examples replace the old: translations opened on the old ones start closed on the new.
  const examplesKey = topic?.examples.map((e) => e.line).join('|') ?? '';
  useEffect(() => { setGeneration((g) => g + 1); }, [examplesKey]);

  // While the server is writing, ask again until it's done.
  const writing = !!topic && topicWriting(topic);
  useEffect(() => {
    if (!writing) return;
    const timer = setTimeout(load, TOPIC_POLL_MS);
    return () => clearTimeout(timer);
  }, [writing, topic, load]);

  const start = async (call: () => Promise<GrammarTopic>, what: string) => {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError(null);
    try {
      setTopic(await call());
    } catch (e) {
      fail(e, what);
    } finally {
      acting.current = false;
      setBusy(false);
    }
  };

  const rewrite = () => Alert.alert('Write this page again?', 'The page and its examples are replaced.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Write again', onPress: () => start(() => api.rewriteTopic(id), "Couldn't start the page again.") },
  ]);
  const remove = () => Alert.alert('Delete this topic?', topic ? `"${topic.title}" and its page are deleted.` : '', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete', style: 'destructive',
      onPress: async () => { try { await api.deleteTopic(id); onDeleted(); } catch (e) { fail(e, "Couldn't delete the topic."); } },
    },
  ]);

  const written = topic?.created_at ? new Date(topic.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  const hasPage = !!topic && topic.lead.length > 0;

  return (
    <Screen title={topic?.title ?? ''} largeTitle={false}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.l }}>
        {error ? <ErrorNote message={error} onRetry={load} /> : null}
        {!topic && !error ? <ActivityIndicator color={c.accent} /> : null}

        {topic && !hasPage && topic.status === 'writing' ? (
          <MakingCard title={topic.title} detail="Writing the page. Each example is checked against the words you know." />
        ) : null}

        {topic && !hasPage && topic.status === 'failed' ? (
          <Card>
            <Text style={{ ...type.headline, color: c.text }}>The page couldn't be written</Text>
            <Help>{topic.note ?? 'Try again, or name the topic another way.'}</Help>
            <Button label="Write the page" onPress={() => start(() => api.rewriteTopic(id), "Couldn't start the page again.")} busy={busy} />
            <Button label="Delete topic" variant="destructive" onPress={remove} />
          </Card>
        ) : null}

        {topic && hasPage ? (
          <>
            <View style={{ backgroundColor: c.accentFill, borderRadius: radius.l, ...smooth, padding: space.l, gap: space.xs }}>
              <Text style={{ ...type.subhead, color: c.text }}>{`Written by Claude on ${written}. It isn't checked against a grammar book, so check it against what you hear and read.`}</Text>
              {topic.note ? <Text style={{ ...type.subhead, color: c.danger }}>{topic.note}</Text> : null}
            </View>

            <View style={{ gap: space.s }}>
              <SectionTitle>About it</SectionTitle>
              <Card style={{ gap: space.m }}>
                <Text style={{ ...type.headline, color: c.text, lineHeight: 24 }}>{topic.lead}</Text>
                <View style={{ height: hairline, backgroundColor: c.border }} />
                {explanationParagraphs(topic.explanation).map((para, i) => (
                  <Text key={i} style={{ ...type.body, color: c.text, lineHeight: 24 }}>
                    {para.map((run, j) => (run.language
                      ? <Text key={j} style={{ fontWeight: '600', color: c.accent }}>{run.text}</Text>
                      : run.text))}
                  </Text>
                ))}
              </Card>
            </View>

            <View style={{ gap: space.s }}>
              <SectionTitle>Examples</SectionTitle>
              <GrammarExamples
                examples={topic.examples.map((e) => ({ ...e, source: { label: 'Written for this topic' } }))}
                generation={generation}
                action={{ label: 'More examples', onPress: () => start(() => api.moreTopicExamples(id), "Couldn't get more examples."), busy: busy || writing }}
              />
            </View>

            <View style={{ gap: space.s }}>
              <SectionTitle>Practice</SectionTitle>
              <Group>
                <NavRow first label="Situations" detail="Act out a scene that needs it. Claude checks it." onPress={() => onSituations(topic)} />
              </Group>
            </View>

            <View style={{ gap: space.s }}>
              <Button label="Write the page again" variant="secondary" onPress={rewrite} disabled={busy || writing} />
              <Button label="Delete topic" variant="destructive" onPress={remove} />
            </View>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
