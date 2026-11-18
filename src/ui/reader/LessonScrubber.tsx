import { useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import { clock, progressOf, scrubTo } from '../../reader/lessons';
import { haptic } from '../haptics';
import { radius, space, useTheme } from '../theme';

/** The touch area; the line itself is thinner and sits at its bottom. */
const TOUCH_HEIGHT = 16;

/**
 * The seek line along the bottom edge of the mini-player while an audio lesson is on it. It shows
 * how far into the lesson the player is, and grows a thumb while a finger is on it. The player seeks
 * when the finger lifts, not on every move, so a drag doesn't stutter the stream. `onScrub` gives the
 * position under the finger (null once it lifts) for the pill to show as a time. It reads the
 * player's own status, so only this line redraws as the lesson plays.
 */
export function LessonScrubber({ player, fallbackDuration, onScrub, onSeek }: {
  player: AudioPlayer;
  /** Called as the line seeks, before the player moves: a lesson waiting at a pause lets the wait go (useLessonWaits.moved). */
  onSeek?: () => void;
  /** The lesson's length from the server, for before the player knows it. */
  fallbackDuration: number;
  onScrub: (position: number | null) => void;
}) {
  const c = useTheme();
  const status = useAudioPlayerStatus(player);
  const duration = status.duration > 0 ? status.duration : fallbackDuration;
  const [dragAt, setDragAt] = useState<number | null>(null);
  const width = useRef(0);
  // The pan handlers outlive a render, so what they need is read from here.
  const latest = useRef({ duration, onScrub, onSeek, player });
  latest.current = { duration, onScrub, onSeek, player };

  const pan = useMemo(() => {
    const at = (x: number) => scrubTo(x, width.current, latest.current.duration);
    const move = (x: number) => { const p = at(x); setDragAt(p); latest.current.onScrub(p); };
    const end = (x: number | null) => {
      const { player: p, onScrub: report, onSeek: seeking } = latest.current;
      setDragAt(null);
      report(null);
      if (x !== null) { seeking?.(); p.seekTo(at(x)).catch(() => undefined); }
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // The pill is on the tab bar's accessory: once a finger is on the line it keeps the drag.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => { haptic.tap(); move(e.nativeEvent.locationX); },
      onPanResponderMove: (e) => move(e.nativeEvent.locationX),
      onPanResponderRelease: (e) => end(e.nativeEvent.locationX),
      onPanResponderTerminate: () => end(null),
    });
  }, []);

  const progress = progressOf(dragAt ?? status.currentTime, duration);
  const dragging = dragAt !== null;
  const line = dragging ? 6 : 3;
  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => { width.current = e.nativeEvent.layout.width; }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Position in the lesson"
      accessibilityValue={{ text: `${clock(status.currentTime)} of ${clock(duration)}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const by = e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1;
        onSeek?.();
        player.seekTo(Math.min(1, Math.max(0, progress + by)) * duration).catch(() => undefined);
      }}
      style={{ position: 'absolute', left: space.l, right: space.l, bottom: 0, height: TOUCH_HEIGHT, justifyContent: 'flex-end', paddingBottom: space.xs }}
    >
      <View pointerEvents="none" style={{ height: line, borderRadius: radius.pill, backgroundColor: c.fill }}>
        <View style={{ width: `${progress * 100}%`, height: '100%', borderRadius: radius.pill, backgroundColor: c.accent }} />
        {dragging ? (
          <View style={{ position: 'absolute', left: `${progress * 100}%`, top: -3, marginLeft: -6, width: 12, height: 12, borderRadius: radius.pill, backgroundColor: c.accent }} />
        ) : null}
      </View>
    </View>
  );
}
