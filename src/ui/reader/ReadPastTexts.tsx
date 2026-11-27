import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { ApiError, type Api, type PastText, type Rating } from '../../reader/api';
import { pastItem } from '../../reader/audioQueue';
import { isGlossOnly } from '../../reader/languages';
import { useApp } from '../AppContext';
import { ErrorNote, Group, Help, Loading, NavRow, Screen, SwipeAction, SwipeToReveal } from '../kit';
import { useAudioQueue } from '../useAudioQueue';
import { useQueueMenu } from '../useQueueMenu';
import { space, readable } from '../theme';

/**
 * Texts read to the end, newest first. Opening
 * one reads it again in the reader, with nothing logged (docs/read-and-listen/architecture.md, Client).
 * A swipe on a row puts it next in Up Next (a full swipe does it at once); nothing here deletes a text.
 */

const RATING_TEXT: Record<Rating, string> = { too_easy: 'Too easy', about_right: 'About right', too_hard: 'Too hard' };

/** "Oct 26", from the server's timestamp. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ReadPastTexts({ api, onOpen, onListen }: { api: Api; onOpen: (text: PastText) => void; onListen: (text: PastText) => void }) {
  const [texts, setTexts] = useState<PastText[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const queueMenu = useQueueMenu();
  const queue = useAudioQueue();
  // The row slid open on its Play Next action; one at a time.
  const [openText, setOpenText] = useState<number | null>(null);
  // Past texts are the reader's language's (the server lists that language's).
  const language = useApp().reader.settings?.language;
  // A language with no voices (Toki Pona) has nothing to play: no queue, no listening without the text.
  const heard = language ? !isGlossOnly(language) : true;

  const load = useCallback(async () => {
    try {
      setTexts(await api.pastTexts());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your past texts.");
    }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen title="Reread">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        {error ? <ErrorNote message={error} onRetry={load} /> : null}
        {texts === null && !error ? <Loading /> : null}
        {texts !== null && texts.length === 0 ? (
          <Help>No past texts yet. Texts you finish show up here, to read or listen to again.</Help>
        ) : null}
        {texts !== null && texts.length > 0 ? (
          <>
            <Group>
              {texts.map((t, i) => (
                <SwipeToReveal
                  key={t.id}
                  open={openText === t.id}
                  onOpenChange={(o) => setOpenText(o ? t.id : null)}
                  onFullSwipe={language && heard ? () => queue.playNext(pastItem(t, language)) : undefined}
                  action={language && heard ? <SwipeAction icon="text.line.first.and.arrowtriangle.forward" label="Play Next" accessibilityLabel={`Play ${t.title} next`} onPress={() => { setOpenText(null); queue.playNext(pastItem(t, language)); }} /> : null}
                >
                  <NavRow
                    first={i === 0}
                    label={t.title}
                    detail={[t.topic, t.episode ? `Episode ${t.episode}` : null, t.form === 'story' && !t.episode ? 'Story' : null, shortDate(t.read_at), t.rating ? RATING_TEXT[t.rating] : null].filter(Boolean).join(' · ')}
                    // Tapping a row that's slid open closes it, rather than opening the text.
                    onPress={() => (openText === t.id ? setOpenText(null) : onOpen(t))}
                    onLongPress={language && heard ? () => queueMenu(pastItem(t, language)) : undefined}
                    action={heard ? { icon: 'headphones', label: `Listen to ${t.title} without the text`, onPress: () => onListen(t) } : undefined}
                  />
                </SwipeToReveal>
              ))}
            </Group>
            <Help>Rereading a text doesn't count as reading it again or change how hard new texts are. The headphones button plays it with the words hidden. Swipe a text, or touch and hold it, to add it to Up Next.</Help>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
