import { Stack } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import { hasThai, japaneseFont, thaiTextStyle } from '../../core/script';
import type { Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { MIXUP_MODES, mixupQuestion, mixupSet, nextMixup, type MixupMode, type MixupQuestion, type MixupSet, type MixupWord } from '../../tools/mixups';
import { haptic } from '../haptics';
import { Button, Card, ErrorNote, Help, Icon, Loading, Tappable } from '../kit';
import type { CardMotion } from '../SwipeCard';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from '../theme';
import { useFont } from '../AppFont';
import { useWordAudio } from '../useWordAudio';
import type { ToolScreenProps } from './index';
import { ListenPrompt, PracticeCard } from './PracticeCard';
import { PlayButton, Status, ToolScreen, useToolLanguage, useToolPref } from './ToolScreen';
import { useRetries } from './useRetries';

/** The three ways, in the header's menu. */
const MODES: { value: MixupMode; label: string }[] = [{ value: 'meaning', label: 'By meaning' }, { value: 'ear', label: 'By ear' }, { value: 'pairs', label: 'Your pairs' }];

/** A word's romanization (or reading) and meaning as one string, for the spoken label; shown on separate lines. */
const detail = (w: MixupWord) => [w.roman, w.meaning].filter(Boolean).join(' · ');

/**
 * Similar words (src/tools/mixups.ts), as Review's card (PracticeCard.tsx): the question is the card,
 * the choices are footer buttons, and Tell them apart is in the header's menu. A meaning and the word for it among its look-alikes or the
 * words linked to it as ones you mix up, or a word played and which of its sound-alikes it was.
 * Opened from Review's session end with the words just missed (`notes`, a JSON list of note ids, and `mode`), it asks those first. A miss
 * comes back a few questions later. Nothing here grades a card.
 */
export function MixupsTool({ tool, repo, params }: ToolScreenProps) {
  const c = useTheme();
  const [savedLanguage, setLanguage] = useToolLanguage(tool);
  const [savedMode, setMode] = useToolPref('mixupMode');
  // Opened with words to practice: their language and mode, until another is chosen here.
  const opened = useMemo(() => {
    let focus: string[] = [];
    try { focus = JSON.parse(params.notes ?? '[]') as string[]; } catch { /* none */ }
    const mode = MIXUP_MODES.find((m) => m === params.mode);
    const language = tool.languages.find((l) => l === params.language);
    return { focus, mode, language };
  }, [params.notes, params.mode, params.language, tool.languages]);
  const [override, setOverride] = useState(opened);
  const language = override.language ?? savedLanguage;
  const mode = override.mode ?? savedMode;
  const focus = override.language === language && override.mode === mode ? override.focus : [];

  const [set, setSet] = useState<MixupSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    (async () => {
      const [notes, cards, linked] = await Promise.all([repo.listNotes(), repo.listCards(), repo.listConfusedPairs()]);
      // Studied: a card of the note has been answered, wherever (its state is past new).
      const studied = new Set(cards.filter((card) => card.sched.state !== 0 && !card.retired).map((card) => card.noteId));
      if (live) setSet(mixupSet(notes, studied, linked));
    })().catch((e) => { if (live) setError(failureText(e, { what: "Couldn't read your decks.", next: 'Try again.' })); });
    return () => { live = false; };
  }, [repo, loads]);

  const play = useWordAudio(repo);
  const retries = useRetries<string | undefined>();
  const asked = useRef<string[]>([]);
  const [question, setQuestion] = useState<MixupQuestion | undefined>();
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const scope = `${language}|${mode}`;

  const ask = (s: MixupSet, current: string | undefined) => {
    const draw = () => nextMixup(s, mode, language, focus, asked.current, Math.random);
    const id = retries.next(scope, current, draw) ?? draw();
    const q = id ? mixupQuestion(s, mode, id, Math.random) : undefined;
    if (id) asked.current = [...asked.current, id];
    setQuestion(q);
    setPicked(undefined);
    if (q && mode === 'ear') void play(q.target.word, language);
  };
  // A new question whenever the words load or the language or mode changes.
  useEffect(() => {
    asked.current = [];
    if (set) ask(set, undefined);
  }, [set, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (noteId: string | null) => {
    if (!question || picked !== undefined) return;
    const right = noteId === question.target.noteId;
    setPicked(noteId);
    if (right) haptic.success();
    else {
      haptic.answer();
      retries.missed(scope, question.target.noteId, question.target.noteId);
    }
    if (mode !== 'ear') void play(question.target.word, language);
  };
  const next = () => { if (set) ask(set, question?.target.noteId); };

  const owed = focus.filter((id) => !asked.current.includes(id)).length;
  const motion = useRef<CardMotion | null>(null);
  const answered = picked !== undefined;
  const missed = answered && !!question && picked !== question.target.noteId;

  let front: React.ReactNode;
  let back: React.ReactNode;
  let footer: React.ReactNode;
  if (question) {
    const meaning = question.target.meaning ?? '';
    front = (
      <View style={{ gap: space.l }}>
        {mode !== 'ear' ? (
          <View style={{ alignItems: 'center', gap: space.m }}>
            <Text style={{ ...type.overline, color: c.textSecondary }}>Which one means</Text>
            <Text selectable maxFontSizeMultiplier={1.5} style={{ ...type.largeTitle, fontSize: meaning.length > 28 ? 28 : 40, fontWeight: '700', color: c.text, textAlign: 'center' }}>{meaning}</Text>
            <View style={{ width: 36, height: 3, borderRadius: 2, backgroundColor: c.accent }} />
            {question.target.partOfSpeech ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{question.target.partOfSpeech}</Text> : null}
          </View>
        ) : (
          <ListenPrompt wave label="Play the word again" hint="Which did you hear?" onPlay={() => void play(question.target.word, language)} />
        )}
        {owed ? <Help>{`From your last session: ${owed} more ${owed === 1 ? 'word' : 'words'} to go.`}</Help> : null}
      </View>
    );
    back = answered ? (
      <View style={{ gap: space.s, alignItems: 'center' }}>
        {picked === question.target.noteId
          ? <Status tone="good">Right.</Status>
          : <Status tone="bad">{`Not quite. It's ${question.target.word}.`}</Status>}
        {missed && mode === 'ear' ? <Help>Play each word to compare how they sound.</Help> : null}
      </View>
    ) : undefined;
    footer = (
      <View style={{ gap: space.s }}>
        {question.choices.map((w) => (
          <Choice
            key={w.noteId}
            word={w}
            state={picked === undefined ? 'open' : w.noteId === question.target.noteId ? 'right' : w.noteId === picked ? 'wrong' : 'other'}
            onPress={() => choose(w.noteId)}
            onPlay={picked === undefined ? undefined : () => void play(w.word, language)}
          />
        ))}
        {answered ? <Button label="Next" onPress={next} /> : <Button variant="secondary" label="I don't know" onPress={() => choose(null)} />}
      </View>
    );
  } else {
    footer = <View />;
  }

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={(l: Language) => { setLanguage(l); setOverride((o) => ({ ...o, language: undefined })); }}
      shown={false}
      onRandomize={next}
      onShow={() => choose(null)}
      onMark={() => next()}
      fill
      footer={footer}
      menu={[
        <Stack.Toolbar.Menu key="1" inline title="Tell them apart">
          {MODES.map((m) => <Stack.Toolbar.MenuAction key={m.value} isOn={m.value === mode} onPress={() => { if (m.value !== mode) { setMode(m.value); setOverride((o) => ({ ...o, mode: undefined })); } }}>{m.label}</Stack.Toolbar.MenuAction>)}
        </Stack.Toolbar.Menu>,
      ]}
    >
      {error ? <View style={{ padding: space.l }}><ErrorNote message={error} onRetry={() => setLoads((n) => n + 1)} /></View> : !set ? <View style={{ padding: space.l }}><Loading /></View> : !question ? (
        <View style={{ padding: space.l }}>
          <Card>
            <Help>
              {mode === 'ear'
                ? `None of the ${LANGUAGES[language].name} words you're studying sound like another one in your deck.`
                : mode === 'pairs'
                  ? `You haven't linked any ${LANGUAGES[language].name} words you're studying yet. When you mix two up in Review, touch and hold Again and choose Mixed up with another word, or Link a confusing word in the ⋯ menu.`
                  : `None of the ${LANGUAGES[language].name} words you're studying look like another one with a different meaning.`}
            </Help>
          </Card>
        </View>
      ) : (
        <PracticeCard
          questionKey={`${question.target.noteId}|${scope}`}
          cardKey={`${question.target.noteId}|${scope}|${String(picked)}`}
          swipe={false}
          motion={motion}
          onMark={() => {}}
          front={front}
          back={back}
        />
      )}
    </ToolScreen>
  );
}

/** One choice: the word, and once answered its romanization and meaning, marked right or wrong, with a play button. */
function Choice({ word, state, onPress, onPlay }: {
  word: MixupWord;
  state: 'open' | 'right' | 'wrong' | 'other';
  onPress: () => void;
  onPlay?: () => void;
}) {
  const c = useTheme();
  const marked = state === 'right' || state === 'wrong';
  const tint = state === 'right' ? c.countDue : state === 'wrong' ? c.danger : c.border;
  const font = useFont();
  const wordStyle = { ...(hasThai(word.word) ? { ...thaiTextStyle('large'), fontSize: 26 } : { ...type.title, fontWeight: '400' as const }), ...japaneseFont(word.word, word.language, font) };
  return (
    <Tappable
      onPress={onPress}
      disabled={state !== 'open'}
      accessibilityRole="button"
      accessibilityLabel={`${word.word}${state === 'open' ? '' : `, ${detail(word)}`}${state === 'right' ? ', right' : state === 'wrong' ? ', your pick, wrong' : ''}`}
      accessibilityState={{ disabled: state !== 'open' }}
      scaleTo={0.98}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: MIN_TAP + 16, paddingHorizontal: space.l, paddingVertical: space.s,
        backgroundColor: state === 'right' ? c.goodFill : state === 'wrong' ? c.dangerFill : c.surface,
        borderRadius: radius.m + 2, ...smooth, borderWidth: marked ? 1.5 : hairline, borderColor: tint,
      }}
    >
      {state === 'right' ? <Icon name="checkmark.circle.fill" size={20} color={c.countDue} /> : null}
      {state === 'wrong' ? <Icon name="xmark.circle.fill" size={20} color={c.danger} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...wordStyle, color: c.text }}>{word.word}</Text>
        {state === 'open' ? null : (
          <>
            {word.roman ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{word.roman}</Text> : null}
            {word.meaning ? <Text style={{ ...type.subhead, color: c.text }}>{word.meaning}</Text> : null}
          </>
        )}
      </View>
      {onPlay ? <PlayButton label={`Play ${word.word}`} onPress={onPlay} /> : null}
    </Tappable>
  );
}
