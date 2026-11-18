import { Stack, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { ApiError, type Api, type Language, type PastText, type StoryListItem } from '../../reader/api';
import { bannerOverline } from '../../reader/browse';
import { saidAs } from '../../reader/wordAudio';
import type { EpisodeOrder } from '../../reader/prefs';
import { episodeSections, orderSections, seasonOpen, seasonsFold, seasonSummary, storyPlace, type EpisodeRow } from '../../reader/stories';
import { loadSeasonChoices, prefs, savePrefs, saveSeasonChoices } from '../../reader/storage';
import { haptic } from '../haptics';
import { Button, Divider, ErrorNote, Group, Help, Screen, SectionTitle } from '../kit';
import { SkeletonList } from '../Skeleton';
import { radius, readable, smooth, space, type, useTheme } from '../theme';
import { useCoverTint } from './Cover';
import { PracticeWordPill } from './PracticeWordPill';
import { ReadSeasonHeader } from './ReadSeasonHeader';
import { ReadRecap } from './ReadRecap';
import { GlossPopover, type Tapped } from './Reader';

// While its next episode is being written, check back this often.
const POLL_MS = 10_000;

/**
 * One story's page (docs/read-and-listen/architecture.md, Stories, Browse): a banner with its next
 * episode to play, Last time, and its episodes by season (newest first unless the ••• menu says otherwise, and each season folds), read ones to read again. The ••• in the
 * header pins it to the home's banner, ends it, or continues an ended one.
 */
export function ReadStory({ api, storyId, language, onOpen, onReadAgain, onPlayWord }: {
  api: Api;
  storyId: number;
  language: Language;
  /** Opens the episode waiting to be read. */
  onOpen: (textId: number) => void;
  /** Opens an episode already read, to read or listen to again. */
  onReadAgain: (text: PastText) => void;
  onPlayWord: (word: string, language: Language, say?: string) => void;
}) {
  const c = useTheme();
  const [story, setStory] = useState<StoryListItem | null>(null);
  const [read, setRead] = useState<PastText[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tapped, setTapped] = useState<Tapped | null>(null);
  const tint = useCoverTint(`story:${storyId}`);
  const [order, setOrder] = useState<EpisodeOrder>(() => prefs().episodeOrder);
  // The seasons the reader opened or closed; the rest follow the default (the latest is open).
  const [chosen, setChosen] = useState<Record<number, boolean>>({});
  useEffect(() => {
    let current = true;
    loadSeasonChoices(storyId).then((saved) => { if (current) setChosen((now) => ({ ...saved, ...now })); });
    return () => { current = false; };
  }, [storyId]);

  const load = useCallback(async () => {
    try {
      const [found, episodes] = await Promise.all([api.story(storyId), api.pastTexts(storyId)]);
      setStory(found);
      setRead(episodes);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load this series. Pull down to try again.");
    }
  }, [api, storyId]);
  // On focus too: reading its episode changes what's next.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (!story?.writing) return;
    const id = setTimeout(load, POLL_MS);
    return () => clearTimeout(id);
  }, [story, load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const change = async (send: () => Promise<void>, failed: string) => {
    setError(null);
    try {
      await send();
      haptic.tap();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : failed);
    }
    load();
  };

  const chooseOrder = (next: EpisodeOrder) => {
    setOrder(next);
    savePrefs({ episodeOrder: next });
  };
  const name = story ? story.title || 'Your series' : 'Series';
  const end = () => Alert.alert(`End "${name}"?`, 'No more episodes are written. The ones you have stay on this page, and you can continue it later.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'End series', style: 'destructive', onPress: () => change(() => api.endStory(storyId), "Couldn't end this series. Try again.") },
  ]);

  const next = story?.next ?? null;
  const overline = !story ? '' : !story.running ? 'Series · Ended' : story.pinned ? `${bannerOverline(story)} · Pinned` : bannerOverline(story);

  return (
    <Screen
      title={name}
      largeTitle={false}
      toolbar={story ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel={`More for ${name}`}>
            <Stack.Toolbar.Menu inline title="Episode order">
              <Stack.Toolbar.MenuAction isOn={order === 'newest'} onPress={() => chooseOrder('newest')}>Newest first</Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction isOn={order === 'oldest'} onPress={() => chooseOrder('oldest')}>Oldest first</Stack.Toolbar.MenuAction>
            </Stack.Toolbar.Menu>
            {story.running && !story.pinned ? (
              <Stack.Toolbar.MenuAction icon="pin" onPress={() => change(() => api.pinStory(storyId), "Couldn't pin this series. Try again.")}>Pin to the top</Stack.Toolbar.MenuAction>
            ) : null}
            {story.running ? (
              <Stack.Toolbar.MenuAction icon="stop.circle" destructive onPress={end}>End series</Stack.Toolbar.MenuAction>
            ) : (
              <Stack.Toolbar.MenuAction icon="play.circle" onPress={() => change(() => api.continueStory(storyId), "Couldn't continue this series. Try again.")}>Continue series</Stack.Toolbar.MenuAction>
            )}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : undefined}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.xl, gap: space.m }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {error ? <ErrorNote message={error} onRetry={refresh} /> : null}
        {!story && !error ? <SkeletonList /> : null}
        {story ? (
          <>
            <View style={{ padding: space.l + 4, borderRadius: radius.xl, ...smooth, backgroundColor: tint, gap: space.s }}>
              <Text style={{ ...type.overline, color: c.accentInk }}>{overline}</Text>
              <Text accessibilityRole="header" style={{ fontSize: 32, fontWeight: '800', lineHeight: 36, color: c.text }}>{name}</Text>
              {story.about ? <Text style={{ ...type.subhead, color: c.textSecondary, lineHeight: 21 }}>{story.about}</Text> : null}
              <Text style={{ ...type.subhead, color: c.textSecondary }}>{storyPlace(story)}</Text>
              {next && next.stretch.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, paddingTop: space.xs }}>
                  {next.stretch.map((w) => {
                    const word = next.practice?.find((p) => p.text === w);
                    return <PracticeWordPill key={w} word={w} onPress={word ? (x, y) => setTapped({ word, x, y }) : undefined} />;
                  })}
                </View>
              ) : null}
              {next ? <Button label={`Play episode ${next.episode}`} onPress={() => onOpen(next.id)} style={{ marginTop: space.s }} /> : null}
            </View>

            <ReadRecap
              recap={story.last_recap}
              line={story.last_recap_line}
              language={language}
              tapped={tapped?.word ?? null}
              onTap={(word, x, y) => { haptic.tap(); setTapped({ word, x, y }); }}
            />

            {(() => {
              const sections = episodeSections(story, read);
              const fold = seasonsFold(sections);
              return orderSections(sections, order).map((section) => {
                const title = section.season > 0 ? `Season ${section.season}` : 'Episodes';
                const open = !fold || seasonOpen(sections, section.season, chosen);
                const toggle = () => {
                  const next = { ...chosen, [section.season]: !open };
                  setChosen(next);
                  saveSeasonChoices(storyId, next);
                };
                return (
                  <View key={section.season} style={{ gap: space.s, paddingTop: space.s }}>
                    {fold ? <ReadSeasonHeader title={title} summary={seasonSummary(section)} open={open} onToggle={toggle} /> : <SectionTitle>{title}</SectionTitle>}
                    {open ? (
                      <Group>
                        {section.rows.map((row, i) => <EpisodeLine key={row.episode} row={row} first={i === 0} onOpen={onOpen} onReadAgain={onReadAgain} />)}
                      </Group>
                    ) : null}
                  </View>
                );
              });
            })()}
            {story.running ? <Help>Each episode is written once you've read the one before, so a series you leave alone writes nothing more.</Help> : null}
          </>
        ) : null}
      </ScrollView>
      <GlossPopover
        tapped={tapped}
        language={language}
        grammar={null}
        api={api}
        grammarChosen={{}}
        onGrammarChosen={() => undefined}
        flagged={false}
        onToggleFlag={null}
        onPlay={() => { if (tapped) onPlayWord(tapped.word.text, language, saidAs(language, tapped.word.text, tapped.word.translit)); }}
        onAddToDeck={null}
        onClose={() => setTapped(null)}
      />
    </Screen>
  );
}

function EpisodeLine({ row, first, onOpen, onReadAgain }: { row: EpisodeRow; first: boolean; onOpen: (textId: number) => void; onReadAgain: (text: PastText) => void }) {
  const c = useTheme();
  const ready = row.kind === 'next' && row.ready;
  const tappable = row.kind === 'read' || row.textId !== null;
  const detail = row.kind === 'read' ? 'Read' : row.status;
  return (
    <Pressable
      disabled={!tappable}
      onPress={() => {
        haptic.tap();
        if (row.kind === 'read') onReadAgain(row.text);
        else if (row.textId !== null) onOpen(row.textId);
      }}
      accessibilityRole="button"
      accessibilityState={{ disabled: !tappable }}
      accessibilityLabel={`Episode ${row.episode}. ${row.title}. ${detail}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m, paddingHorizontal: space.l, backgroundColor: pressed ? c.fill : 'transparent', opacity: tappable ? 1 : 0.6 })}
    >
      {first ? null : <Divider inset={space.l + 30 + space.m} />}
      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: ready ? c.accent : c.fill, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ ...type.subhead, fontWeight: '700', color: ready ? c.onAccent : c.textSecondary }}>{row.episode}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.headline, color: c.text }}>{row.title}</Text>
        <Text style={{ ...type.footnote, color: ready ? c.countDue : c.textSecondary }}>{detail}</Text>
      </View>
    </Pressable>
  );
}
