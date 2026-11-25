import { useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import { Stack, useRouter } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import React, { useEffect, useState } from 'react';
import { ActionSheetIOS, Image, ScrollView, Text, View } from 'react-native';
import { itemDetail, languageOf, nextRepeat, repeatLabel, sleepIn, sleepLabel, SLEEP_MINUTES, titleOf } from '../../reader/audioQueue';
import { LANGUAGES } from '../../reader/languages';
import { clock, SKIP_SECONDS } from '../../reader/lessons';
import { NORMAL_RATE, SLOW_RATE } from '../../reader/playbackRate';
import { FLAG_IMAGES } from '../flagImages';
import { haptic } from '../haptics';
import { Button, ErrorNote, Help, Icon, Screen, Tappable } from '../kit';
import { MIN_TAP, radius, readable, smooth, space, type, useTheme } from '../theme';
import { useAudioQueue } from '../useAudioQueue';
import { useReaderPlayerHost } from '../useReaderPlayer';
import { LessonScrubber } from './LessonScrubber';
import { LineScrubber } from './LineScrubber';
import type { ReaderSource } from './Reader';
import { PlayCircle } from './PlayCircle';

/**
 * Now Playing, opened from the tab bar's player: what Up Next is playing (useAudioQueue.ts), with
 * the previous and next item on the outside, the previous and next line (or 15 seconds back and
 * forward in a lesson) on the inside, and Play in the middle. Under them: the speed (Normal or Slow,
 * for a text in a language that offers Slow), a sleep timer, repeat (off, the whole queue, this
 * one), and Up Next. Stop takes the one playing out of the queue. A text opens in the reader and a
 * lesson on its own screen from here, which take the player over as they always have.
 */
export function NowPlaying() {
  const c = useTheme();
  const router = useRouter();
  const queue = useAudioQueue();
  const host = useReaderPlayerHost();
  const now = queue.queue.now;
  // The line under a finger on the text's scrubber, shown in the label until it lifts.
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  // The sleep timer's minutes count down on screen.
  const [clockNow, setClockNow] = useState(Date.now());
  useEffect(() => {
    if (queue.sleep?.kind !== 'minutes') return;
    const timer = setInterval(() => setClockNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [queue.sleep]);

  // Emptied (Stop on the last one, or Clear): nothing to show, so the sheet closes.
  useEffect(() => { if (!now && router.canGoBack()) router.back(); }, [now]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!now) return <Screen title="Now Playing" largeTitle={false}><View /></Screen>;

  const language = languageOf(now);
  const lesson = now.kind === 'lesson' ? now.lesson : null;
  const yourTurn = queue.live && lesson !== null && host.waits.held;
  const tap = (run: () => void) => () => { haptic.tap(); run(); };

  const open = () => {
    router.back();
    if (now.kind === 'lesson') router.push({ pathname: '/read-lesson', params: { lesson: JSON.stringify(now.lesson) } });
    else {
      // Where it is now if it's playing, else where Up Next stopped it: the reader plays on from that line.
      const at = host.position();
      const line = at?.kind === 'text' && at.textId === now.textId ? at.line : now.resume;
      const resume = line !== undefined && line > 0 ? { resume: line } : {};
      const source: ReaderSource = now.past ? { kind: 'past', text: now.past, ...resume } : { kind: 'shelf', textId: now.textId, order: [now.textId], ...resume };
      router.push({ pathname: '/reader', params: { source: JSON.stringify(source) } });
    }
  };

  const chooseSleep = () => {
    const options = [...SLEEP_MINUTES.map((m) => `${m} minutes`), 'End of this item', ...(queue.sleep ? ['Turn off'] : []), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Pause playing after', options, cancelButtonIndex: options.length - 1, ...(queue.sleep ? { destructiveButtonIndex: options.length - 2 } : {}) },
      (i) => {
        if (i < SLEEP_MINUTES.length) queue.setSleep(sleepIn(SLEEP_MINUTES[i], Date.now()));
        else if (i === SLEEP_MINUTES.length) queue.setSleep({ kind: 'item' });
        else if (queue.sleep && i === SLEEP_MINUTES.length + 1) queue.setSleep(null);
        else return;
        setClockNow(Date.now());
        haptic.tap();
      },
    );
  };

  const control = (icon: SFSymbol, label: string, onPress: () => void, disabled = false) => (
    <Tappable
      onPress={tap(onPress)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      scaleTo={0.88}
      style={{ width: MIN_TAP + space.s, height: MIN_TAP + space.s, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }}
    >
      <Icon name={icon} size={24} color={c.text} weight="semibold" />
    </Tappable>
  );

  return (
    <Screen
      title="Now Playing"
      largeTitle={false}
      toolbar={(
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="stop.fill" accessibilityLabel="Stop and remove from Up Next" onPress={() => { haptic.tap(); queue.stopNow(); }} />
        </Stack.Toolbar>
      )}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.xl, paddingTop: space.l, paddingBottom: space.xxl, gap: space.l }}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ alignSelf: 'center', width: 168, height: 168, borderRadius: radius.xl, ...smooth, backgroundColor: c.accentFill, alignItems: 'center', justifyContent: 'center', gap: space.s }}
        >
          <Image source={FLAG_IMAGES[language]} style={{ width: 48, height: 48, borderRadius: radius.pill }} />
          <Icon name={lesson ? 'waveform' : 'book.fill'} size={26} color={c.accentInk} />
        </View>

        <Tappable onPress={tap(open)} accessibilityRole="button" accessibilityHint={lesson ? 'Opens the lesson' : 'Opens the text in Read & Listen'} scaleTo={0.98} style={{ gap: space.xs, alignItems: 'center' }}>
          <Text style={{ ...type.title, color: c.text, textAlign: 'center' }}>{titleOf(now)}</Text>
          <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>{`${LANGUAGES[language].name} · ${lesson ? 'Audio lesson' : 'Read & Listen'}`}</Text>
        </Tappable>

        {queue.shown ? (
          <View style={{ backgroundColor: c.fill, borderRadius: radius.m, ...smooth, paddingVertical: space.m, paddingHorizontal: space.l, gap: space.xs }}>
            <Text style={{ fontSize: LANGUAGES[language].fontSize, lineHeight: LANGUAGES[language].fontSize * LANGUAGES[language].lineHeight, color: c.text, textAlign: 'center' }}>{queue.shown.text}</Text>
            {queue.shown.english ? <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>{queue.shown.english}</Text> : null}
          </View>
        ) : null}

        {queue.problem ? <ErrorNote message={queue.problem} onRetry={queue.toggle} /> : null}

        <View style={{ gap: space.s }}>
          {queue.live && lesson ? (
            <>
              <View style={{ height: 22, marginHorizontal: -space.l }}>
                <LessonScrubber player={host.player} fallbackDuration={lesson.duration_ms / 1000} onScrub={() => undefined} onSeek={host.waits.moved} />
              </View>
              <LessonTimes player={host.player} fallback={lesson.duration_ms / 1000} />
            </>
          ) : queue.line ? (
            <>
              <LineScrubber current={queue.line.n - 1} total={queue.line.of} onDrag={setScrubbing} onSeek={host.seekLine} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ ...type.caption, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{`Line ${(scrubbing ?? queue.line.n - 1) + 1}`}</Text>
                <Text style={{ ...type.caption, color: c.textSecondary }}>{`of ${queue.line.of}`}</Text>
              </View>
            </>
          ) : (
            <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>{itemDetail(now)}</Text>
          )}
          {yourTurn ? <Text style={{ ...type.subhead, fontWeight: '600', color: c.accentInk, textAlign: 'center' }}>Your turn</Text> : null}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {control('backward.fill', 'Previous item', queue.previous)}
          {lesson
            ? control('gobackward.15', `Back ${SKIP_SECONDS} seconds`, () => host.skip(-1), !queue.live)
            : control('chevron.left', 'Previous line', () => host.skip(-1), !queue.live)}
          <PlayCircle playing={queue.playing && !yourTurn} onPress={tap(queue.toggle)} accessibilityLabel={yourTurn ? 'Continue' : queue.playing ? 'Pause' : 'Play'} />
          {lesson
            ? control('goforward.15', `Forward ${SKIP_SECONDS} seconds`, () => host.skip(1), !queue.live)
            : control('chevron.right', 'Next line', () => host.skip(1), !queue.live)}
          {control('forward.fill', 'Next item', queue.next, queue.queue.next.length === 0 && queue.queue.repeat !== 'all')}
        </View>

        <View style={{ flexDirection: 'row', gap: space.s }}>
          {queue.speed?.slowOffered ? (
            <Chip
              icon="tortoise"
              label={queue.speed.rate < NORMAL_RATE ? 'Slow' : 'Normal'}
              on={queue.speed.rate < NORMAL_RATE}
              accessibilityLabel={`Speed: ${queue.speed.rate < NORMAL_RATE ? 'slow' : 'normal'}. Changes to ${queue.speed.rate < NORMAL_RATE ? 'normal' : 'slow'}`}
              onPress={() => queue.setRate(queue.speed!.rate < NORMAL_RATE ? NORMAL_RATE : SLOW_RATE)}
            />
          ) : null}
          <Chip icon="moon.zzz" label={sleepLabel(queue.sleep, clockNow)} on={queue.sleep !== null} accessibilityLabel={`Sleep timer: ${queue.sleep ? sleepLabel(queue.sleep, clockNow) : 'off'}`} onPress={chooseSleep} />
          <Chip
            icon={queue.queue.repeat === 'one' ? 'repeat.1' : 'repeat'}
            label={repeatLabel(queue.queue.repeat)}
            on={queue.queue.repeat !== 'off'}
            accessibilityLabel={`${repeatLabel(queue.queue.repeat)}${queue.queue.repeat === 'off' ? ': off' : ''}. Changes to ${repeatLabel(nextRepeat(queue.queue.repeat)).toLowerCase()}${nextRepeat(queue.queue.repeat) === 'off' ? ' off' : ''}`}
            onPress={() => queue.setRepeat(nextRepeat(queue.queue.repeat))}
          />
          <Chip icon="list.bullet" label="Up Next" on={false} accessibilityLabel={`Up Next: ${queue.queue.next.length} after this`} onPress={() => router.push('/up-next')} />
        </View>

        <Button label={lesson ? 'Open the lesson' : 'Open in Read & Listen'} variant="secondary" onPress={open} />
        {now.kind === 'text' && now.from === 'shelf' ? <Help>Play a shelf text to the end and it counts as read.</Help> : null}
      </ScrollView>
    </Screen>
  );
}

function LessonTimes({ player, fallback }: { player: AudioPlayer; fallback: number }) {
  const c = useTheme();
  const status = useAudioPlayerStatus(player);
  const duration = status.duration > 0 ? status.duration : fallback;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ ...type.caption, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{clock(status.currentTime)}</Text>
      <Text style={{ ...type.caption, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{`-${clock(Math.max(0, duration - status.currentTime))}`}</Text>
    </View>
  );
}

/** A setting under the controls: a symbol over a short label, tinted while it's on. */
function Chip({ icon, label, on, accessibilityLabel, onPress }: { icon: SFSymbol; label: string; on: boolean; accessibilityLabel: string; onPress: () => void }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      scaleTo={0.94}
      style={{ flex: 1, minHeight: MIN_TAP + space.m, borderRadius: radius.m, ...smooth, paddingVertical: space.s, alignItems: 'center', justifyContent: 'center', gap: space.xs, backgroundColor: on ? c.accentFill : 'transparent' }}
    >
      <Icon name={icon} size={18} color={on ? c.accentInk : c.textSecondary} />
      <Text numberOfLines={1} style={{ ...type.caption, color: on ? c.accentInk : c.textSecondary }}>{label}</Text>
    </Tappable>
  );
}
