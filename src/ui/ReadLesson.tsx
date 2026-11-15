import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { ApiError, type Api, type AudioLesson } from '../reader/api';
import { atEnd, clock, SKIP_SECONDS, skipTo } from '../reader/lessons';
import { haptic } from './haptics';
import { Button, ErrorNote, Group, Help, Icon, NavRow, Screen, Tappable } from './kit';
import { MIN_TAP, radius, space, type, useTheme, readable } from './theme';

// Background playback is on while a lesson is open, so it goes on with the screen locked, and is
// turned off again on the way out (Review's card audio doesn't need it).
const LESSON_AUDIO_MODE = { playsInSilentMode: true, shouldPlayInBackground: true };

/**
 * A lesson, playing (docs/read-and-listen/architecture.md, Audio lessons): play or pause, skip back
 * or forward 15 seconds to hear a phrase again, and the phrases behind a row, hidden until asked
 * for so the lesson can be heard first. The lock screen shows the lesson's controls. What you say
 * aloud isn't recorded or checked.
 */
export function ReadLesson({ api, lesson, onDeleted }: { api: Api; lesson: AudioLesson; onDeleted: () => void }) {
  const c = useTheme();
  const player = useAudioPlayer(null, { keepAudioSessionActive: true });
  const status = useAudioPlayerStatus(player);
  const [showPhrases, setShowPhrases] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAudioModeAsync(LESSON_AUDIO_MODE).catch(() => undefined);
    player.replace(api.lessonAudio(lesson.id));
    player.setActiveForLockScreen(true, { title: lesson.title, artist: 'Franki', albumTitle: 'Audio lessons' });
    return () => {
      player.pause();
      player.clearLockScreenControls();
      setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false }).catch(() => undefined);
    };
  }, [api, lesson.id]); // eslint-disable-line react-hooks/exhaustive-deps -- the player is stable; the lesson is what changes

  const duration = status.duration > 0 ? status.duration : lesson.duration_ms / 1000;
  const progress = duration > 0 ? Math.min(1, status.currentTime / duration) : 0;

  const toggle = async () => {
    haptic.tap();
    if (status.playing) {
      player.pause();
      return;
    }
    if (atEnd(status.currentTime, status.duration)) await player.seekTo(0);
    player.play();
  };
  const skip = (by: number) => {
    haptic.tap();
    player.seekTo(skipTo(status.currentTime, by, status.duration)).catch(() => undefined);
  };

  const confirmDelete = () => {
    Alert.alert('Delete this lesson?', `"${lesson.title}" and its recording are removed from the server.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteLesson(lesson.id);
            onDeleted();
          } catch (e) {
            setError(e instanceof ApiError ? e.message : "Couldn't delete the lesson. Try again.");
          }
        },
      },
    ]);
  };

  const round = { width: MIN_TAP + space.s, height: MIN_TAP + space.s, alignItems: 'center' as const, justifyContent: 'center' as const };
  return (
    <Screen title={lesson.title}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l, gap: space.l }}>
        <View style={{ gap: space.xs }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: c.fill, overflow: 'hidden' }}>
            <View style={{ width: `${progress * 100}%`, height: '100%', backgroundColor: c.accent }} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ ...type.footnote, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{clock(status.currentTime)}</Text>
            <Text style={{ ...type.footnote, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{clock(duration)}</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.xl }}>
          <Tappable onPress={() => skip(-SKIP_SECONDS)} accessibilityRole="button" accessibilityLabel={`Back ${SKIP_SECONDS} seconds`} style={round}>
            <Icon name="gobackward.15" size={30} color={c.text} />
          </Tappable>
          <Tappable
            onPress={toggle}
            accessibilityRole="button"
            accessibilityLabel={status.playing ? 'Pause' : 'Play'}
            style={{ width: 68, height: 68, borderRadius: radius.pill, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name={status.playing ? 'pause.fill' : 'play.fill'} size={30} color={c.onAccent} />
          </Tappable>
          <Tappable onPress={() => skip(SKIP_SECONDS)} accessibilityRole="button" accessibilityLabel={`Forward ${SKIP_SECONDS} seconds`} style={round}>
            <Icon name="goforward.15" size={30} color={c.text} />
          </Tappable>
        </View>

        <Help>Keeps playing with the screen locked. Say each phrase aloud in the spaces. What you say isn't recorded or checked.</Help>

        <Group>
          <NavRow
            first
            label={showPhrases ? 'Hide the phrases' : 'Show the phrases'}
            detail={`${lesson.phrases.length} phrases and the conversation`}
            onPress={() => setShowPhrases((v) => !v)}
          />
        </Group>

        {showPhrases ? (
          <>
            <Group>
              {lesson.phrases.map((p, i) => (
                <PhraseRow key={`${p.text}-${i}`} first={i === 0} text={p.text} english={p.english} />
              ))}
            </Group>
            <Group>
              {lesson.dialogue.map((l, i) => (
                <PhraseRow key={`${l.text}-${i}`} first={i === 0} text={l.text} english={l.english} speaker={l.speaker} />
              ))}
            </Group>
          </>
        ) : null}

        {error ? <ErrorNote message={error} /> : null}
        <Button label="Delete this lesson" variant="destructive" onPress={confirmDelete} />
      </ScrollView>
    </Screen>
  );
}

function PhraseRow({ text, english, speaker, first }: { text: string; english: string; speaker?: 'A' | 'B'; first?: boolean }) {
  const c = useTheme();
  return (
    <View style={{ paddingVertical: space.m, paddingHorizontal: space.l, gap: 2, borderTopWidth: first ? 0 : 1, borderTopColor: c.border }}>
      <Text style={{ ...type.body, color: c.text }}>{speaker ? `${speaker}: ${text}` : text}</Text>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{english}</Text>
    </View>
  );
}
