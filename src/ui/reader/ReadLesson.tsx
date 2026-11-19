import { setAudioModeAsync, useAudioPlayerStatus } from 'expo-audio';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { ApiError, type Api, type AudioLesson, type Word } from '../../reader/api';
import { glossesOf, glossKey } from '../../reader/cardGlosses';
import { atEnd, clock, progressOf, SKIP_SECONDS, skipTo } from '../../reader/lessons';
import { scriptOf } from '../../reader/lessonScript';
import { CardSentence } from '../CardSentence';
import { haptic } from '../haptics';
import { Button, Divider, ErrorNote, Group, Icon, NavRow, Screen, Tappable } from '../kit';
import { MIN_TAP, radius, space, type, useTheme, readable } from '../theme';
import type { CardGlossing, SentenceGloss } from '../useCardGlosses';
import { lessonAudioMode } from '../useLessonTurns';
import { beginListening, NO_CONTROLS, setListeningLoop, type ListeningControls } from '../listeningActivity';
import { useReaderPlayerHost } from '../useReaderPlayer';
import { useAudioQueue } from '../useAudioQueue';
import { LessonTranscript } from './LessonTranscript';
import { LoopTextIcon, StartOverIcon } from './PlayerIcons';
import { LessonTurnPanel } from './LessonTurnPanel';
import { LessonTurnSettings } from './LessonTurnSettings';

/**
 * A lesson, playing (docs/read-and-listen/architecture.md, Audio lessons): play or pause, skip back
 * or forward 15 seconds to hear a phrase again, and the phrases behind a row, hidden until asked
 * for so the lesson can be heard first. Start over, and Loop, which plays it again from the start
 * each time it ends (useLessonLoop; off each time the lesson opens, unless it's the one playing).
 * The lock screen shows the lesson's controls. It plays on
 * Read & Listen's shared player (useReaderPlayer): leaving while it plays carries it on in the tab
 * bar's mini-player, and opening it from there picks it up where it is. What you say
 * aloud isn't recorded or checked. With Wait for my answer on (the switch here, or Settings, Lessons),
 * it stops at each place you speak and Play becomes Continue (useLessonWaits). Once the phrases show, each is words to tap for their meanings, as a
 * card's example sentence is (the server's glosses; a phrase it has no answer for stays plain text).
 */
export function ReadLesson({ api, lesson, onDeleted, onAddToDeck, onPlayWord, onAddWord }: {
  api: Api; lesson: AudioLesson; onDeleted: () => void;
  /** Opens Add to deck for the lesson's phrases; left out when the language has no deck. */
  onAddToDeck?: () => void;
} & Pick<CardGlossing, 'onPlayWord' | 'onAddWord'>) {
  const c = useTheme();
  const host = useReaderPlayerHost();
  const player = host.player;
  // Where Up Next stopped this lesson, if it's the one there: Play starts from it.
  const queued = useAudioQueue().queue.now;
  const resumeAt = queued?.kind === 'lesson' && queued.lesson.id === lesson.id ? queued.resume ?? 0 : 0;
  const live = useAudioPlayerStatus(player);
  const [showPhrases, setShowPhrases] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const script = scriptOf(lesson);
  const turns = host.turns;
  const [error, setError] = useState<string | null>(null);
  // Whatever the shared player carries on in the mini-player (Play all, or this lesson) keeps going
  // while a lesson is only open; the lesson takes the player over (stops that one, and has the lock
  // screen and background playback) once it plays, and gives it up on the way out only then, so
  // leaving a lesson never stops Play all with the phone locked. `owned` is whether the player is
  // this lesson's: until then the screen shows a lesson at its start, not what the player holds.
  const owned = useRef(false);
  const [mine, setMine] = useState(false);
  // Stopped at a pause for the learner's answer (Wait for my answer, useLessonWaits); read on the way
  // out, so a lesson left while it waits carries on in the mini-player rather than stopping.
  const waits = host.waits;
  const held = mine && waits.held;
  const heldNow = useRef(false);
  heldNow.current = held;
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
    // Opened from the mini-player: this lesson is already on the player, and plays on.
    const resumed = host.resumeLesson(lesson.id);
    owned.current = resumed;
    setMine(resumed);
    if (resumed) showActivity(); else host.lessonLoop.clear(lesson.id);
    return () => {
      if (!owned.current) return;
      owned.current = false;
      // Playing carries on in the mini-player; a paused or finished lesson stops, as the reader's does,
      // and Up Next keeps where it stopped if it's the lesson there.
      if (player.playing || heldNow.current) host.handOffLesson(lesson);
      else host.putDown({ kind: 'lesson', id: lesson.id, seconds: Math.max(0, player.currentTime) });
    };
  }, [lesson.id]); // eslint-disable-line react-hooks/exhaustive-deps -- the host and its player are stable; the lesson is what changes

  // The lock screen's and Dynamic Island's activity, with this screen answering its buttons (through the ref, so they act on the latest render).
  const buttons = useRef<ListeningControls>(NO_CONTROLS);
  const showActivity = () => beginListening({ kind: 'lesson', title: lesson.title, detail: '', looping: host.lessonLoop.isOn(lesson.id) }, () => buttons.current);
  const looping = host.lessonLoop.isOn(lesson.id);

  const takeOver = async () => {
    if (owned.current) return;
    owned.current = true;
    setMine(true);
    host.claim();
    host.watchLesson(lesson, api);
    player.replace(api.lessonAudio(lesson.id));
    // Play all leaves the player at its line's speed.
    player.setPlaybackRate(1, 'high');
    // Background playback is on once a lesson plays, so it goes on with the screen locked, and recording
    // too while a microphone setting needs it. The player host turns both off when the lesson stops.
    await setAudioModeAsync(lessonAudioMode(turns.wantsRecording())).catch(() => undefined);
    player.setActiveForLockScreen(true, { title: lesson.title, artist: 'Franki', albumTitle: 'Audio lessons' });
    showActivity();
    if (resumeAt > 0) {
      await player.seekTo(resumeAt).catch(() => undefined);
      waits.moved();
    }
  };

  const status = mine ? live : { playing: false, currentTime: 0, duration: 0 };
  const duration = status.duration > 0 ? status.duration : lesson.duration_ms / 1000;
  const progress = progressOf(status.currentTime, duration);

  const toggle = async () => {
    haptic.tap();
    if (held) {
      waits.goOn();
      return;
    }
    if (mine && status.playing) {
      player.pause();
      return;
    }
    await takeOver();
    if (atEnd(status.currentTime, status.duration)) await player.seekTo(0);
    player.play();
  };
  const skip = (by: number) => {
    haptic.tap();
    if (!owned.current) return;
    waits.moved();
    player.seekTo(skipTo(status.currentTime, by, status.duration)).catch(() => undefined);
  };

  const startOver = async () => {
    haptic.tap();
    await takeOver();
    host.lessonLoop.startOver();
  };
  const toggleLoop = () => {
    haptic.select();
    const on = host.lessonLoop.toggle(lesson.id);
    // The activity is this lesson's only once it plays; before that, another one may be carrying on.
    if (owned.current) setListeningLoop(on);
  };

  buttons.current = {
    startOver: () => { void startOver(); },
    previous: () => skip(-SKIP_SECONDS),
    toggle: () => { void toggle(); },
    next: () => skip(SKIP_SECONDS),
    loop: toggleLoop,
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
            // A deleted lesson isn't carried on in the mini-player.
            if (owned.current) { owned.current = false; setMine(false); host.stop(); }
            onDeleted();
          } catch (e) {
            setError(e instanceof ApiError ? e.message : "Couldn't delete the lesson. Try again.");
          }
        },
      },
    ]);
  };

  const round = { width: MIN_TAP + space.s, height: MIN_TAP + space.s, alignItems: 'center' as const, justifyContent: 'center' as const };
  // Start over and Loop, on either side of the skip buttons, as in the reader's player bar.
  const chip = { width: MIN_TAP, height: MIN_TAP, borderRadius: radius.pill, alignItems: 'center' as const, justifyContent: 'center' as const };
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

        {held ? (
          <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>
            <Text style={{ fontWeight: '600', color: c.text }}>Your turn.</Text>{turns.recording && turns.listen ? ' Say it.' : ' Say it, then tap Continue.'}
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.l }}>
          {/* Held at a pause, Continue takes the room these two would need. */}
          {held ? null : (
            <Tappable onPress={startOver} accessibilityRole="button" accessibilityLabel="Start over" scaleTo={0.92} style={{ ...chip, backgroundColor: c.fill }}>
              <StartOverIcon color={c.textSecondary} />
            </Tappable>
          )}
          <Tappable onPress={() => skip(-SKIP_SECONDS)} accessibilityRole="button" accessibilityLabel={`Back ${SKIP_SECONDS} seconds`} style={round}>
            <Icon name="gobackward.15" size={30} color={c.text} />
          </Tappable>
          {held ? (
            <Tappable
              onPress={toggle}
              accessibilityRole="button"
              accessibilityLabel="Continue"
              accessibilityHint="Plays the answer and goes on with the lesson"
              style={{ minHeight: 68, paddingHorizontal: space.xl, borderRadius: radius.pill, backgroundColor: c.accent, flexDirection: 'row', alignItems: 'center', gap: space.s }}
            >
              <Text style={{ ...type.headline, color: c.onAccent }}>Continue</Text>
              <Icon name="play.fill" size={16} color={c.onAccent} />
            </Tappable>
          ) : (
            <Tappable
              onPress={toggle}
              accessibilityRole="button"
              accessibilityLabel={status.playing ? 'Pause' : 'Play'}
              style={{ width: 68, height: 68, borderRadius: radius.pill, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name={status.playing ? 'pause.fill' : 'play.fill'} size={30} color={c.onAccent} />
            </Tappable>
          )}
          <Tappable onPress={() => skip(SKIP_SECONDS)} accessibilityRole="button" accessibilityLabel={`Forward ${SKIP_SECONDS} seconds`} style={round}>
            <Icon name="goforward.15" size={30} color={c.text} />
          </Tappable>
          {held ? null : (
            <Tappable
              onPress={toggleLoop}
              accessibilityRole="button"
              accessibilityLabel="Loop lesson"
              accessibilityValue={{ text: looping ? 'On' : 'Off' }}
              scaleTo={0.92}
              style={{ ...chip, backgroundColor: looping ? c.accent : c.fill }}
            >
              <LoopTextIcon color={looping ? c.onAccent : c.textSecondary} />
            </Tappable>
          )}
        </View>
        {looping && !held ? (
          <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>Looping the whole lesson</Text>
        ) : null}

        {mine ? <LessonTurnPanel turns={turns} held={held} /> : null}
        {mine && onAddToDeck && atEnd(status.currentTime, status.duration) ? (
          <Button label="Add these phrases to your deck" onPress={onAddToDeck} />
        ) : null}

        <Group>
          <LessonTurnSettings lesson={lesson} waits={waits} turns={turns} />
          <NavRow
            label={showTranscript ? 'Hide the transcript' : 'Show the transcript'}
            detail={script ? 'What has been said so far' : 'Not kept for lessons made before transcripts'}
            disabled={!script}
            onPress={() => setShowTranscript((v) => !v)}
          />
          {onAddToDeck ? <NavRow label="Add phrases to your deck" detail="Each opens in the note editor" onPress={onAddToDeck} /> : null}
          <NavRow
            label={showPhrases ? 'Hide the phrases' : 'Show the phrases'}
            detail={`${lesson.phrases.length} phrases and the conversation`}
            onPress={() => setShowPhrases((v) => !v)}
          />
        </Group>

        {showTranscript && script ? (
          <LessonTranscript entries={script} seconds={status.currentTime} onSeek={(ms) => {
            if (!owned.current) return;
            waits.moved();
            player.seekTo(ms / 1000).catch(() => undefined);
          }} />
        ) : null}

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
