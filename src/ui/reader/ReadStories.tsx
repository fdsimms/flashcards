import { Stack, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { ApiError, MAX_STORY_ABOUT_CHARS, type Api, type StoryListItem } from '../../reader/api';
import { storyNext, storyPlace } from '../../reader/stories';
import { haptic } from '../haptics';
import { Divider, ErrorNote, Group, Help, Icon, Screen, SectionTitle, Tag, Tappable } from '../kit';
import { SkeletonList } from '../Skeleton';
import { MIN_TAP, readable, space, type, useTheme } from '../theme';

// While an episode is being written, check back this often.
const POLL_MS = 10_000;

/**
 * Every story in the language being read (docs/read-and-listen/architecture.md, Stories), from the
 * shelf's Library. Several run at once, each writing its next episode once the last is read; one
 * is pinned to the shelf's card. A row opens its next episode, or its past ones once it's ended;
 * its ••• has the rest (pin, past episodes, end, continue). The + starts a new story.
 */
export function ReadStories({ api, onOpen, onEpisodes }: {
  api: Api;
  /** Opens an episode waiting to be read. */
  onOpen: (textId: number) => void;
  /** Lists a story's episodes, first to last. */
  onEpisodes: (storyId: number) => void;
}) {
  const c = useTheme();
  const [stories, setStories] = useState<StoryListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setStories((await api.stories()).stories);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your stories. Pull down to try again.");
    }
  }, [api]);
  // On focus too: an episode read in the reader opened from here changes its story's row.
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

  // A change is sent, then the list read again, so it shows what the server now has.
  const busy = useRef(false);
  const change = async (send: () => Promise<void>, failed: string) => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await send();
      haptic.tap();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : failed);
    } finally {
      busy.current = false;
    }
    load();
  };

  const start = () => {
    Alert.prompt(
      'Start a new story',
      "What should it be about? Leave it empty and the writer chooses. Its first episode is written now, and the story on the shelf stays there.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Start', onPress: (about?: string) => change(() => api.startStory((about ?? '').trim().slice(0, MAX_STORY_ABOUT_CHARS)), "Couldn't start a story. Try again.") },
      ],
      'plain-text',
    );
  };

  const menu = (story: StoryListItem) => {
    const name = story.title || 'Your story';
    const actions: { label: string; run: () => void; destructive?: boolean }[] = story.running
      ? [
        ...(story.next ? [{ label: `Read episode ${story.next.episode}`, run: () => onOpen(story.next!.id) }] : []),
        ...(story.pinned ? [] : [{ label: 'Pin to the shelf', run: () => change(() => api.pinStory(story.id), "Couldn't pin that story. Try again.") }]),
        ...(story.read > 0 ? [{ label: 'Past episodes', run: () => onEpisodes(story.id) }] : []),
        {
          label: 'End story',
          destructive: true,
          run: () => Alert.alert(`End "${name}"?`, 'No more episodes are written. The ones you have stay in Past texts, and you can continue it later.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'End story', style: 'destructive', onPress: () => change(() => api.endStory(story.id), "Couldn't end that story. Try again.") },
          ]),
        },
      ]
      : [
        { label: 'Continue story', run: () => change(() => api.continueStory(story.id), "Couldn't continue that story. Try again.") },
        ...(story.read > 0 ? [{ label: 'Past episodes', run: () => onEpisodes(story.id) }] : []),
      ];
    const destructive = actions.findIndex((a) => a.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      { title: name, options: [...actions.map((a) => a.label), 'Cancel'], cancelButtonIndex: actions.length, destructiveButtonIndex: destructive >= 0 ? destructive : undefined },
      (i) => { if (i < actions.length) actions[i].run(); },
    );
  };

  const running = stories?.filter((s) => s.running) ?? [];
  const ended = stories?.filter((s) => !s.running) ?? [];

  return (
    <Screen
      title="Stories"
      toolbar={(
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="plus" accessibilityLabel="Start a new story" onPress={start} />
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
                {running.map((s, i) => <StoryRow key={s.id} story={s} first={i === 0} onPress={() => (s.next ? onOpen(s.next.id) : s.read > 0 ? onEpisodes(s.id) : menu(s))} onMore={() => menu(s)} />)}
              </Group>
            ) : <Help>No story is running. Tap + to start one.</Help>}
            <Help>Tap a story to read its next episode. Each one writes its next episode once you've read the last, so a story you leave alone costs nothing.</Help>
            {ended.length > 0 ? (
              <View style={{ gap: space.s, paddingTop: space.m }}>
                <SectionTitle>Ended</SectionTitle>
                <Group>
                  {ended.map((s, i) => <StoryRow key={s.id} story={s} first={i === 0} onPress={() => (s.read > 0 ? onEpisodes(s.id) : menu(s))} onMore={() => menu(s)} />)}
                </Group>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function StoryRow({ story, first, onPress, onMore }: { story: StoryListItem; first: boolean; onPress: () => void; onMore: () => void }) {
  const c = useTheme();
  const name = story.title || 'Your story';
  const next = storyNext(story);
  const place = storyPlace(story);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: space.s }}>
      {first ? null : <Divider inset={space.l} />}
      <Pressable
        onPress={() => { haptic.tap(); onPress(); }}
        accessibilityRole="button"
        accessibilityLabel={[name, story.pinned ? 'On the shelf' : null, place, next?.text].filter(Boolean).join('. ')}
        accessibilityActions={[{ name: 'more', label: 'More for this story' }]}
        onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'more') onMore(); }}
        style={({ pressed }) => ({ flex: 1, gap: 3, paddingVertical: space.m, paddingLeft: space.l, opacity: pressed ? 0.6 : 1 })}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s }}>
          <Text style={{ ...type.headline, color: c.text }}>{name}</Text>
          {story.pinned ? <Tag text="On the shelf" color={c.accentInk} fill={c.accentFill} /> : null}
        </View>
        <Text style={{ ...type.footnote, color: c.textSecondary }}>{place}</Text>
        {next ? <Text style={{ ...type.footnote, color: next.ready ? c.countDue : c.textSecondary }}>{next.text}</Text> : null}
      </Pressable>
      <Tappable
        onPress={() => { haptic.select(); onMore(); }}
        accessibilityRole="button"
        accessibilityLabel={`More for ${name}`}
        style={{ width: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="ellipsis" size={18} color={c.textSecondary} />
      </Tappable>
    </View>
  );
}
