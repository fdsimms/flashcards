import { setAudioModeAsync, type AudioMode } from 'expo-audio';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState } from 'react';
import { bestHeard, recognitionLocale, speakingErrorText } from '../core/speaking';
import { useApp } from './AppContext';
import { haptic } from './haptics';

/** The locales iOS can recognize, read once. */
let locales: Promise<string[]> | null = null;
export const supportedLocales = () => {
  locales ??= ExpoSpeechRecognitionModule.getSupportedLocales({}).then((r) => r.locales).catch(() => []);
  return locales;
};

/** Which hook started the recognizer: there's one recognizer, and every hook hears its events. */
let owner = 0;
let nextId = 1;

/** The audio session the app keeps when it isn't listening (AppContext's): recording off, playing in silent mode. */
const PLAYBACK = { playsInSilentMode: true, allowsRecording: false } as const;

/**
 * Answer by speaking (src/core/speaking.ts) for one place on a screen: whether it's on (Settings,
 * Speaking) and the language can be heard, `start` and `stop`, what's been heard so far, and a
 * message when something went wrong. `onHeard` gets the text as it comes, and again once it's
 * final (the guess closest to `expected`, when there is one). Recognition stops by itself on a
 * pause; the audio session goes back to playback as soon as it does.
 */
export function useSpokenAnswer(speechTag: string | undefined, opts: {
  onHeard: (text: string, final: boolean) => void;
  expected?: string;
  /** Called before listening starts, so the screen can stop its own audio. */
  onBeforeListen?: () => void;
  /** Runs until stopped (hold to talk) rather than stopping on a pause. */
  continuous?: boolean;
  /** The screen's own audio mode, put back once listening stops (the reader's plays in the background). */
  mode?: Partial<AudioMode>;
}) {
  // The setting is read from the app's repo, so a Read & Listen screen needn't be handed one.
  const { repo } = useApp();
  const id = useRef(0);
  if (!id.current) id.current = nextId++;
  const [on, setOn] = useState(false);
  const [locale, setLocale] = useState<string | undefined>();
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef(opts);
  latest.current = opts;
  // A stop that comes while permission is still being asked (a hold let go at once): start doesn't go on.
  const stopAsked = useRef(false);

  useEffect(() => {
    let live = true;
    repo.answerBySpeaking().then(async (enabled) => {
      if (!live) return;
      setOn(enabled);
      if (enabled) {
        const found = recognitionLocale(speechTag, await supportedLocales());
        if (live) setLocale(found);
      }
    }).catch(() => undefined);
    return () => { live = false; };
  }, [repo, speechTag]);

  const mine = () => owner === id.current;
  useSpeechRecognitionEvent('result', (e) => {
    if (!mine()) return;
    const guesses = e.results.map((r) => r.transcript);
    latest.current.onHeard(e.isFinal ? bestHeard(guesses, latest.current.expected) : guesses[0]?.trim() ?? '', e.isFinal);
  });
  useSpeechRecognitionEvent('error', (e) => {
    if (!mine()) return;
    const text = speakingErrorText(e.error);
    if (text) setProblem(text);
  });
  useSpeechRecognitionEvent('end', () => {
    if (!mine()) return;
    owner = 0;
    setListening(false);
    setAudioModeAsync({ ...PLAYBACK, ...latest.current.mode }).catch(() => undefined);
  });
  // Leaving the screen mid-sentence stops the recognizer it started.
  useEffect(() => () => { if (owner === id.current) { owner = 0; ExpoSpeechRecognitionModule.abort(); } }, []);

  const start = useCallback(async () => {
    if (!locale || listening) return;
    stopAsked.current = false;
    setProblem(null);
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync().catch(() => null);
    if (!permission?.granted) {
      setProblem(speakingErrorText('not-allowed') ?? null);
      return;
    }
    if (stopAsked.current) return;
    latest.current.onBeforeListen?.();
    haptic.tap();
    owner = id.current;
    setListening(true);
    ExpoSpeechRecognitionModule.start({
      lang: locale,
      interimResults: true,
      maxAlternatives: 5,
      // Kept on the phone where iOS can for this language; otherwise iOS uses Apple's servers.
      requiresOnDeviceRecognition: true,
      continuous: !!latest.current.continuous,
      addsPunctuation: false,
    });
  }, [locale, listening]);

  const stop = useCallback(() => { stopAsked.current = true; if (mine()) ExpoSpeechRecognitionModule.stop(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cancel = useCallback(() => { stopAsked.current = true; if (mine()) ExpoSpeechRecognitionModule.abort(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { available: on && !!locale, listening, problem, start, stop, cancel, clearProblem: () => setProblem(null) };
}
