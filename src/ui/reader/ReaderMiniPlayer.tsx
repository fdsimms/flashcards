import { useRouter } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { itemDetail, moreAfter, titleOf } from '../../reader/audioQueue';
import { clock } from '../../reader/lessons';
import { haptic } from '../haptics';
import { Icon, Tappable } from '../kit';
import { LessonScrubber } from './LessonScrubber';
import { MIN_TAP, space, type, useTheme } from '../theme';
import { useAudioQueue } from '../useAudioQueue';
import { useReaderPlayerHost } from '../useReaderPlayer';

/**
 * What the tab bar's bottom accessory holds while Up Next has something (useAudioQueue.ts): the
 * title, where it is ("Line 6 of 18", or an audio lesson's seek line along the bottom edge,
 * LessonScrubber) and how many come after it, with Play or Pause and the next item. Something paused
 * where it stopped, or waiting for Play, shows here too, so the queue is always one tap away. A tap
 * on the title opens Now Playing. A lesson stopped at a pause for the learner's answer says "Your
 * turn", and its Play goes on. Drawn on the system's glass, so it has no background of its own; the
 * compact form (`inline`, once the tab bar shrinks as a list scrolls) keeps only the title.
 */
export function ReaderMiniPlayer() {
  const c = useTheme();
  const router = useRouter();
  const host = useReaderPlayerHost();
  const queue = useAudioQueue();
  const placement = NativeTabs.BottomAccessory.usePlacement();
  // Where the finger is on the lesson's seek line, shown in place of the subtitle while it drags.
  const [scrubAt, setScrubAt] = useState<number | null>(null);
  const now = queue.queue.now;
  if (!now) return null;
  const compact = placement === 'inline';
  const lesson = now.kind === 'lesson' ? now.lesson : null;
  // A lesson stopped at a pause for the learner's answer (Wait for my answer): Play goes on.
  const yourTurn = queue.live && lesson !== null && host.waits.held;
  const more = moreAfter(queue.queue);
  const where = queue.problem ? "Couldn't play this. Tap to see why"
    : !queue.live ? itemDetail(now)
    : queue.line ? `Line ${queue.line.n} of ${queue.line.of}`
    : scrubAt !== null && lesson ? `${clock(scrubAt)} of ${clock(lesson.duration_ms / 1000)}`
    : 'Audio lesson';
  const subtitle = more && scrubAt === null ? `${where} · ${more}` : where;
  const button = (icon: 'pause.fill' | 'play.fill' | 'forward.fill', label: string, onPress: () => void) => (
    <Tappable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={label}
      scaleTo={0.9}
      style={{ width: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name={icon} size={18} color={c.text} weight="semibold" />
    </Tappable>
  );
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: space.l, paddingRight: space.xs, gap: space.s }}>
      <Tappable
        onPress={() => router.push('/now-playing')}
        accessibilityRole="button"
        accessibilityLabel={`${titleOf(now)}, ${yourTurn ? 'your turn' : subtitle}`}
        accessibilityHint="Opens Now Playing"
        scaleTo={0.98}
        style={{ flex: 1, minHeight: MIN_TAP, justifyContent: 'center' }}
      >
        <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: '600', color: c.text }}>{titleOf(now)}</Text>
        {compact ? null : yourTurn && scrubAt === null
          ? <Text numberOfLines={1} style={{ ...type.caption, fontWeight: '600', color: c.accentInk }}>Your turn</Text>
          : <Text numberOfLines={1} style={{ ...type.caption, color: queue.problem ? c.danger : c.textSecondary }}>{subtitle}</Text>}
      </Tappable>
      {button(queue.playing && !yourTurn ? 'pause.fill' : 'play.fill', yourTurn ? 'Continue' : queue.playing ? 'Pause' : 'Play', queue.toggle)}
      {queue.queue.next.length > 0 || queue.queue.repeat === 'all' ? button('forward.fill', 'Next item', queue.next) : null}
      {queue.live && lesson ? <LessonScrubber player={host.player} fallbackDuration={lesson.duration_ms / 1000} onScrub={setScrubAt} onSeek={host.waits.moved} /> : null}
    </View>
  );
}
