import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { sounding } from '../../core/sounding';
import {
  heardAll, hearing, listen, LISTEN_DELAY_MS, pause, replied, REVIEW_MS, sent, SOUND_START_MS, START, withEnglish,
  type HandsFree, type PauseReason,
} from '../../reader/handsFree';
import { useSpokenAnswer } from '../useSpokenAnswer';

const KEEP_AWAKE_TAG = 'situations-hands-free';

/**
 * Hands-free Situations (src/reader/handsFree.ts): after their line has played, the microphone opens in the
 * scene's language and a pause ends the owner's line; it's sent after `REVIEW_MS` unless tapped to fix, and
 * their reply plays and the microphone opens again. Say it in English, held, listens in English and puts the
 * word in [brackets]. The screen stays awake while it runs, and it pauses when the app leaves the screen,
 * since iOS opens no microphone for an app in the background. `on` false runs nothing.
 */
export function useHandsFree({ on, speech, onSend, onFix }: {
  on: boolean;
  /** The scene's language as the recognizer takes it (th-TH). */
  speech: string;
  /** Sends the owner's line, as typing it and tapping Send does; false when it wasn't sent. */
  onSend: (line: string) => boolean;
  /** The line goes in the box to be fixed and sent by hand. */
  onFix: (line: string) => void;
}) {
  const [state, setState] = useState<HandsFree>(START);
  const stateRef = useRef(state);
  stateRef.current = state;
  // A final result arrived for the microphone now open; without one, its close means nothing was heard.
  const heardFinal = useRef<string | null>(null);
  const english = useRef('');
  // Say it in English is held (a ref for the recognizer's callbacks, state so the microphone reopens on letting go).
  const holdingEnglish = useRef(false);
  const [held, setHeld] = useState(false);
  const hold = (on_: boolean) => { holdingEnglish.current = on_; setHeld(on_); };
  // English listening waits for the scene's microphone to have closed: the recognizer is shared, and a
  // session started before the old one's end arrives would take that end as its own.
  const englishWaiting = useRef(false);
  // The scene's microphone was closed by this hook (Pause, a fix, Say it in English), not by a pause in speech.
  const closedOnPurpose = useRef(false);
  const closeTarget = () => { if (target.listening) closedOnPurpose.current = true; target.cancel(); };
  const latest = useRef({ onSend, onFix });
  latest.current = { onSend, onFix };

  const target = useSpokenAnswer(speech, {
    onHeard: (text, final) => {
      if (holdingEnglish.current) return;
      if (final) heardFinal.current = text;
      setState((s) => (s.step === 'listening' ? hearing(s, text) : s));
    },
  });
  const inEnglish = useSpokenAnswer('en-US', {
    continuous: true,
    onHeard: (text) => { english.current = text; },
  });

  // The microphone closed by itself (a pause): what it heard ends the line, or counts as silence.
  const wasListening = useRef(false);
  useEffect(() => {
    if (target.listening) { wasListening.current = true; return; }
    if (!wasListening.current) return;
    wasListening.current = false;
    const onPurpose = closedOnPurpose.current;
    closedOnPurpose.current = false;
    if (englishWaiting.current && holdingEnglish.current) { englishWaiting.current = false; void inEnglish.start(); return; }
    if (onPurpose || holdingEnglish.current || stateRef.current.step !== 'listening') return;
    const heard = heardFinal.current ?? '';
    heardFinal.current = null;
    setState((s) => heardAll(s, heard));
  }, [target.listening]); // eslint-disable-line react-hooks/exhaustive-deps

  // Say it in English, let go: once its microphone has closed, the word goes in and the scene's opens again.
  const englishWas = useRef(false);
  useEffect(() => {
    if (inEnglish.listening) { englishWas.current = true; return; }
    if (!englishWas.current) return;
    englishWas.current = false;
    hold(false);
    const word = english.current;
    english.current = '';
    setState((s) => withEnglish(s, word));
  }, [inEnglish.listening]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listening: the scene's microphone opens, a beat after whatever played.
  useEffect(() => {
    if (!on || state.step !== 'listening' || target.listening || held) return;
    const t = setTimeout(() => { heardFinal.current = null; void target.start(); }, LISTEN_DELAY_MS);
    return () => clearTimeout(t);
  }, [on, state.step, state.committed, state.silent, held, target.listening]); // eslint-disable-line react-hooks/exhaustive-deps

  // Their line: once it has sounded and gone quiet (or never started), the microphone opens.
  useEffect(() => {
    if (!on || state.step !== 'theirs') return;
    let began = sounding.quietSince() === null;
    const check = () => {
      if (sounding.quietSince() === null) { began = true; return; }
      if (began) setState((s) => (s.step === 'theirs' ? listen(s) : s));
    };
    const unsubscribe = sounding.subscribe(check);
    const fallback = setTimeout(() => { if (!began) setState((s) => (s.step === 'theirs' ? listen(s) : s)); }, SOUND_START_MS);
    return () => { unsubscribe(); clearTimeout(fallback); };
  }, [on, state.step]);

  // Review: sent after the wait, unless a tap fixes it first.
  useEffect(() => {
    if (!on || state.step !== 'review') return;
    const line = state.line;
    const t = setTimeout(() => {
      if (latest.current.onSend(line)) { setState((s) => (s.step === 'review' ? sent(s) : s)); return; }
      // Not sent (their reply is still coming, or the conversation is too long): the line goes in the box.
      latest.current.onFix(line);
      setState((s) => pause({ ...s, line: '', committed: '' }, 'fixing'));
    }, REVIEW_MS);
    return () => clearTimeout(t);
  }, [on, state.step, state.line]);

  const stopAll = useCallback(() => {
    closeTarget();
    inEnglish.cancel();
    englishWaiting.current = false;
    hold(false);
  }, [target, inEnglish]); // eslint-disable-line react-hooks/exhaustive-deps

  const pauseFor = useCallback((reason: PauseReason) => {
    stopAll();
    setState((s) => pause(s, reason));
  }, [stopAll]);

  // The app went to the background: iOS won't open a microphone there. (Not 'inactive', which the
  // microphone's own permission alert and Control Center cause.)
  useEffect(() => {
    if (!on) return;
    const sub = AppState.addEventListener('change', (next) => { if (next === 'background') pauseFor('away'); });
    return () => sub.remove();
  }, [on, pauseFor]);

  // The screen stays awake while the loop runs.
  useEffect(() => {
    if (!on) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    return () => { deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined); };
  }, [on]);

  // Turned off (or the conversation left): nothing stays listening.
  useEffect(() => { if (!on) { stopAll(); setState(START); } }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => stopAll(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    state,
    /** The scene's language can be heard (Answer by speaking on, its locale on the phone): hands-free can run. */
    available: target.available,
    problem: target.problem ?? inEnglish.problem,
    /** Their reply arrived (and is being played): the microphone opens once it's done. */
    replied: () => setState((s) => replied(s)),
    /** A line was sent (by the loop, or typed after a fix): their reply is awaited. */
    sent: () => setState((s) => (s.step === 'waiting' ? s : sent(s))),
    /** Sending failed: the loop waits for the owner, whose line is back in the box. */
    failed: () => pauseFor('fixing'),
    pause: () => pauseFor('tapped'),
    resume: () => { stopAll(); setState((s) => listen({ ...s, committed: '', line: '' })); },
    /** A tap on the line while it waits to be sent: it goes in the box to be fixed. */
    fix: () => {
      const s = stateRef.current;
      if (s.step !== 'review' && s.step !== 'listening') return;
      stopAll();
      latest.current.onFix(s.line);
      setState((x) => pause({ ...x, line: '', committed: '' }, 'fixing'));
    },
    englishStart: () => {
      if (!on || !inEnglish.available || stateRef.current.step !== 'listening') return;
      hold(true);
      english.current = '';
      if (target.listening) { englishWaiting.current = true; closeTarget(); } else void inEnglish.start();
    },
    englishEnd: () => {
      if (!holdingEnglish.current) return;
      inEnglish.stop();
      // Let go before English listening began (a quick tap, or still waiting): nothing to put in, so the scene's microphone opens again.
      if (!inEnglish.listening) { englishWaiting.current = false; hold(false); }
    },
    englishAvailable: inEnglish.available,
  };
}
