import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import React, { useEffect } from 'react';
import { Image, Text, View } from 'react-native';
import type { PodcastRef } from '../../reader/api';
import { videoLength } from '../../reader/video';
import { haptic } from '../haptics';
import { Icon, Tappable } from '../kit';
import { IDLE_MODE, LISTENING_MODE } from '../listeningAudio';
import { radius, space, type, useTheme } from '../theme';
import { useOutputWake } from '../useOutputWake';
import type { Media } from './VideoPane';

/** The lock screen's skip buttons, as an audio lesson's: 15 seconds back, 30 forward. */
const BACK_SECONDS = 15;
const FORWARD_SECONDS = 30;

/**
 * Watch's podcast episode (docs/read-and-listen/architecture.md, "Podcasts"): the episode's audio,
 * played from the show's own site, with its artwork, a progress bar, and back 15 and forward 30. It
 * keeps playing with the screen locked, with the lock screen's controls, while Watch is open, and
 * stops when Watch closes. The screen drives it through `bind` and hears its time through `onTime`.
 */
export function EpisodePane({ episode, title, bind, onTime, onPlaying }: {
  episode: PodcastRef & { audio: string };
  title: string;
  bind: (media: Media) => void;
  onTime: (ms: number) => void;
  onPlaying: (playing: boolean) => void;
}) {
  const c = useTheme();
  const player = useAudioPlayer({ uri: episode.audio }, { updateInterval: 200 });
  const status = useAudioPlayerStatus(player);
  // A Play after quiet waits for Bluetooth headphones, which lose its first words otherwise (useOutputWake).
  const wake = useOutputWake();

  useEffect(() => {
    bind({
      seek: (seconds) => { void player.seekTo(Math.max(0, seconds)); },
      play: () => { void wake().then(() => player.play()); },
      pause: () => player.pause(),
      rate: (r) => player.setPlaybackRate(r, 'high'),
    });
  }, [player, bind, wake]);

  // Plays on with the screen locked while Watch is open, then lets other apps' sound mix again.
  useEffect(() => {
    setAudioModeAsync(LISTENING_MODE).catch(() => undefined);
    player.setActiveForLockScreen(true, { title, artist: episode.show, albumTitle: 'Read & Listen', artworkUrl: episode.artwork || undefined }, {
      showSeekBackward: true, showSeekForward: true, seekBackwardIntervalSeconds: BACK_SECONDS, seekForwardIntervalSeconds: FORWARD_SECONDS,
    });
    return () => {
      player.pause();
      player.clearLockScreenControls();
      setAudioModeAsync(IDLE_MODE).catch(() => undefined);
    };
  }, [player]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { onTime(Math.round(status.currentTime * 1000)); }, [status.currentTime]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onPlaying(status.playing); }, [status.playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const skip = (seconds: number) => {
    haptic.select();
    void player.seekTo(Math.max(0, Math.min(status.duration || Infinity, status.currentTime + seconds)));
  };
  const toggle = () => {
    haptic.tap();
    if (status.playing) player.pause(); else void wake().then(() => player.play());
  };
  const share = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;

  return (
    <View style={{ paddingHorizontal: space.l, paddingTop: space.m, gap: space.s, alignItems: 'center' }}>
      {episode.artwork ? (
        <Image source={{ uri: episode.artwork }} accessibilityIgnoresInvertColors style={{ width: 132, height: 132, borderRadius: radius.l, backgroundColor: c.fill }} />
      ) : null}
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{episode.show}</Text>
      <View style={{ width: '100%', gap: 4 }}>
        <View accessible accessibilityRole="progressbar" accessibilityLabel={`${videoLength(status.currentTime)} of ${videoLength(status.duration)}`} style={{ height: 4, borderRadius: 2, backgroundColor: c.fill, overflow: 'hidden' }}>
          <View style={{ width: `${Math.round(share * 1000) / 10}%`, height: 4, backgroundColor: c.accent }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ ...type.caption, color: c.textTertiary, fontVariant: ['tabular-nums'] }}>{videoLength(status.currentTime)}</Text>
          <Text style={{ ...type.caption, color: c.textTertiary, fontVariant: ['tabular-nums'] }}>{status.duration ? videoLength(status.duration) : ''}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xl }}>
        <Tappable onPress={() => skip(-BACK_SECONDS)} accessibilityRole="button" accessibilityLabel={`Back ${BACK_SECONDS} seconds`} style={{ padding: space.s }}>
          <Icon name="gobackward.15" size={24} color={c.text} />
        </Tappable>
        <Tappable
          onPress={toggle}
          accessibilityRole="button"
          accessibilityLabel={status.playing ? 'Pause' : 'Play'}
          style={{ width: 58, height: 58, borderRadius: radius.pill, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name={status.playing ? 'pause.fill' : 'play.fill'} size={22} color={c.onAccent} />
        </Tappable>
        <Tappable onPress={() => skip(FORWARD_SECONDS)} accessibilityRole="button" accessibilityLabel={`Forward ${FORWARD_SECONDS} seconds`} style={{ padding: space.s }}>
          <Icon name="goforward.30" size={24} color={c.text} />
        </Tappable>
      </View>
    </View>
  );
}
