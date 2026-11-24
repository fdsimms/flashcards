import { Stack, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { ApiError, type Api, type StoryListItem } from '../../reader/api';
import { WorkingMark } from '../WorkingMark';
import { storyNext, storyPlace, storyWriting } from '../../reader/stories';
import { haptic } from '../haptics';
import { Divider, ErrorNote, Group, Help, Icon, Screen, SectionTitle } from '../kit';
import { SkeletonList } from '../Skeleton';
import { readable, space, type, useTheme } from '../theme';
import { HoverPressable } from '../hover';

// While an episode is being written, check back this often.
const POLL_MS = 10_000;

/**
 * Every story in the language being read (docs/read-and-listen/architecture.md, Stories), from the
 * home's Your stories row: running ones, then ended. A row opens the story's page, which plays its
 * next episode and pins, ends or continues it. The + has a new one written.
 */
export function ReadStories({ api, onStory, onNew }: {
  api: Api;
  /** A story's own page. */
  onStory: (storyId: number) => void;
  /** Starts a new story (the + sheet, on Story). */
  onNew: () => void;
}) {
  const [stories, setStories] = useState<StoryListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setStories((await api.stories()).stories);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your series. Pull down to try again.");
    }
  }, [api]);
  // On focus too: a story changed on its page, or an episode read, changes its row.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const writing = !!stories?.some((s) => s.writing);
  useEffect(() => {
    if (!writing) return;
    const id = setTimeout(load, POLL_MS);
    return () => clearTimeout(id);
  }, [stories, writing, load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const running = stories?.filter((s) => s.running) ?? [];
  const ended = stories?.filter((s) => !s.running) ?? [];

  return (
    <Screen
      title="Series"
      toolbar={(
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="plus" accessibilityLabel="Start a new series" onPress={onNew} />
        </Stack.Toolbar>
      )}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.xl, gap: space.s }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {error ? <ErrorNote message={error} onRetry={refresh} /> : null}
        {!stories && !error ? <SkeletonList /> : null}
        {stories ? (
          <>
            <SectionTitle>Running</SectionTitle>
            {running.length > 0 ? (
              <Group>
                {running.map((s, i) => <StoryRow key={s.id} story={s} first={i === 0} onPress={() => onStory(s.id)} />)}
              </Group>
            ) : <Help>No series is running. Tap + to start one.</Help>}
            <Help>Each new episode is written after you read the last one, so a series you leave alone costs nothing.</Help>
            {ended.length > 0 ? (
              <View style={{ gap: space.s, paddingTop: space.m }}>
                <SectionTitle>Ended</SectionTitle>
                <Group>
                  {ended.map((s, i) => <StoryRow key={s.id} story={s} first={i === 0} onPress={() => onStory(s.id)} />)}
                </Group>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function StoryRow({ story, first, onPress }: { story: StoryListItem; first: boolean; onPress: () => void }) {
  const c = useTheme();
  const name = story.title || 'Your series';
  const next = storyNext(story);
  const place = storyPlace(story);
  const writing = storyWriting(story);
  return (
    <HoverPressable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={[name, place, writing ?? next?.text].filter(Boolean).join('. ')}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m, paddingHorizontal: space.l, backgroundColor: pressed ? c.fill : 'transparent' })}
    >
      {first ? null : <Divider inset={space.l} />}
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ ...type.headline, color: c.text }}>{name}</Text>
        <Text style={{ ...type.footnote, color: c.textSecondary }}>{place}</Text>
        {writing ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            <WorkingMark />
            <Text style={{ ...type.footnote, color: c.textSecondary, flexShrink: 1 }}>{writing}</Text>
          </View>
        ) : next ? <Text style={{ ...type.footnote, color: next.ready ? c.countDue : c.textSecondary }}>{next.text}</Text> : null}
      </View>
      <Icon name="chevron.right" size={14} color={c.textTertiary} weight="semibold" />
    </HoverPressable>
  );
}
