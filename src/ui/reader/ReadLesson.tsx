import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { ApiError, type Api, type AudioLesson, type Word } from '../../reader/api';
import { glossesOf, glossKey } from '../../reader/cardGlosses';
import { atEnd, clock, SKIP_SECONDS, skipTo } from '../../reader/lessons';
import { CardSentence } from '../CardSentence';
import { haptic } from '../haptics';
import { Button, Divider, ErrorNote, Group, Icon, NavRow, Screen, Tappable } from '../kit';
import { MIN_TAP, radius, space, type, useTheme, readable } from '../theme';
import type { CardGlossing, SentenceGloss } from '../useCardGlosses';
import { useReaderPlayerHost } from '../useReaderPlayer';

// Background playback is on once a lesson plays, so it goes on with the screen locked, and is
// turned off again on the way out (Review's card audio doesn't need it).
const LESSON_AUDIO_MODE = { playsInSilentMode: true, shouldPlayInBackground: true };

/**
 * A lesson, playing (docs/read-and-listen/architecture.md, Audio lessons): play or pause, skip back
 * or forward 15 seconds to hear a phrase again, and the phrases behind a row, hidden until asked
 * for so the lesson can be heard first. The lock screen shows the lesson's controls. What you say
 * aloud isn't recorded or checked. Once the phrases show, each is words to tap for their meanings, as a
 * card's example sentence is (the server's glosses; a phrase it has no answer for stays plain text).
 */
export function ReadLesson({ api, lesson, onDeleted, onPlayWord, onAddWord }: {
  api: Api; lesson: AudioLesson; onDeleted: () => void;
} & Pick<CardGlossing, 'onPlayWord' | 'onAddWord'>) {
  const c = useTheme();
  const player = useAudioPlayer(null, { keepAudioSessionActive: true });
  const status = useAudioPlayerStatus(player);
  const [showPhrases, setShowPhrases] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Play all carried on by the mini-player keeps going while a lesson is only open; the lesson takes
  // over (stops it, and has the lock screen and background playback) once it plays, and gives them
  // up on the way out only then, so leaving a lesson never stops Play all with the phone locked.
  const host = useReaderPlayerHost();
  const playing = useRef(false);
  // Each phrase's and line's words by `glossKey`, asked for once the phrases are opened.
  const [glossed, setGlossed] = useState<Map<string, Word[]>>(new Map());
  useEffect(() => {
    if (!showPhrases) return;
    const request = {
      language: lesson.language,
      sentences: [...lesson.phrases, ...lesson.dialogue].map((l) => ({ text: l.text, english: l.english })),
    };
    let current = true;
    api.glosses(request.language, request.sentences).then((answer) => {
      if (current && answer.ready) setGlossed(glossesOf(request, answer.sentences));
    }, () => undefined);
    return () => { current = false; };
  }, [api, lesson, showPhrases]);
  const glossFor = (text: string): SentenceGloss | null => {
    const words = glossed.get(glossKey(lesson.language, text));
    return words ? { api, onPlayWord, onAddWord, language: lesson.language, words } : null;
  };

  useEffect(() => {
    playing.current = false;
    player.replace(api.lessonAudio(lesson.id));
    return () => {
      player.pause();
      if (!playing.current) return;
      player.clearLockScreenControls();
      setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false }).catch(() => undefined);
    };
  }, [api, lesson.id]); // eslint-disable-line react-hooks/exhaustive-deps -- the player is stable; the lesson is what changes

  const takeOver = async () => {
    if (playing.current) return;
    playing.current = true;
    host.claim();
    await setAudioModeAsync(LESSON_AUDIO_MODE).catch(() => undefined);
    player.setActiveForLockScreen(true, { title: lesson.title, artist: 'Franki', albumTitle: 'Audio lessons' });
  };

  const duration = status.duration > 0 ? status.duration : lesson.duration_ms / 1000;
  const progress = duration > 0 ? Math.min(1, status.currentTime / duration) : 0;

  const toggle = async () => {
    haptic.tap();
    if (status.playing) {
      player.pause();
      return;
    }
    await takeOver();
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
          <View style={{ height: 6, borderRadius: radius.pill, backgroundColor: c.fill, overflow: 'hidden' }}>
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
                <PhraseRow key={`${p.text}-${i}`} first={i === 0} text={p.text} english={p.english} gloss={glossFor(p.text)} />
              ))}
            </Group>
            <Group>
              {lesson.dialogue.map((l, i) => (
                <PhraseRow key={`${l.text}-${i}`} first={i === 0} text={l.text} english={l.english} speaker={l.speaker} gloss={glossFor(l.text)} />
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

function PhraseRow({ text, english, speaker, first, gloss }: { text: string; english: string; speaker?: 'A' | 'B'; first?: boolean; gloss: SentenceGloss | null }) {
  const c = useTheme();
  const look = { ...type.body, color: c.text };
  return (
    <View style={{ paddingVertical: space.m, paddingHorizontal: space.l, gap: 2 }}>
      {first ? null : <Divider inset={space.l} />}
      {gloss ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          {speaker ? <Text style={[look, { paddingBottom: 5 }]}>{`${speaker}: `}</Text> : null}
          <View style={{ flex: 1 }}><CardSentence gloss={gloss} style={look} /></View>
        </View>
      ) : <Text style={look}>{speaker ? `${speaker}: ${text}` : text}</Text>}
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{english}</Text>
    </View>
  );
}
