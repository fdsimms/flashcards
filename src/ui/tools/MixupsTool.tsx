import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import { hasThai, thaiTextStyle } from '../../core/script';
import type { Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { MIXUP_MODES, mixupQuestion, mixupSet, nextMixup, type MixupMode, type MixupQuestion, type MixupSet, type MixupWord } from '../../tools/mixups';
import { haptic } from '../haptics';
import { Card, ErrorNote, Help, Icon, Loading, Tappable } from '../kit';
import { Reveal } from '../motion';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from '../theme';
import { useWordAudio } from '../useWordAudio';
import type { ToolScreenProps } from './index';
import { ChipChoice, PlayButton, Status, ToolScreen, useToolLanguage, useToolPref, type ToolActions } from './ToolScreen';
import { useRetries } from './useRetries';

const MODES: { value: MixupMode; label: string }[] = [{ value: 'meaning', label: 'By meaning' }, { value: 'ear', label: 'By ear' }];

/** How a word's choice is shown once answered: its romanization (or reading) and meaning. */
const detail = (w: MixupWord) => [w.roman, w.meaning].filter(Boolean).join(' · ');

/**
 * Words you mix up (src/tools/mixups.ts): a meaning and the word for it among its look-alikes, or
 * a word played and which of its sound-alikes it was. Opened from Review's session end with the
 * words just missed (`notes`, a JSON list of note ids, and `mode`), it asks those first. A miss
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
      const [notes, cards] = await Promise.all([repo.listNotes(), repo.listCards()]);
      // Studied: a card of the note has been answered, wherever (its state is past new).
      const studied = new Set(cards.filter((card) => card.sched.state !== 0 && !card.retired).map((card) => card.noteId));
      if (live) setSet(mixupSet(notes, studied));
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
    if (mode === 'meaning') void play(question.target.word, language);
  };
  const next = () => { if (set) ask(set, question?.target.noteId); };

  const owed = focus.filter((id) => !asked.current.includes(id)).length;
  const actions: ToolActions = picked !== undefined
    ? { primary: { label: 'Next', onPress: next } }
    : { secondary: { label: 'Another word', onPress: next }, primary: { label: "I don't know", onPress: () => choose(null), disabled: !question } };

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={(l: Language) => { setLanguage(l); setOverride((o) => ({ ...o, language: undefined })); }}
      shown={false}
      onRandomize={next}
      onShow={() => choose(null)}
      onMark={() => next()}
      actions={actions}
    >
      {error ? <ErrorNote message={error} onRetry={() => setLoads((n) => n + 1)} /> : !set ? <Loading /> : !question ? (
        <Card>
          <Help>
            {mode === 'ear'
              ? `None of the ${LANGUAGES[language].name} words you're studying sound like another one in your deck.`
              : `None of the ${LANGUAGES[language].name} words you're studying look like another one with a different meaning.`}
          </Help>
        </Card>
      ) : (
        <>
          <Card style={{ alignItems: 'center', gap: space.s, paddingVertical: space.xl }}>
            {mode === 'meaning' ? (
              <>
                <Text style={{ ...type.subhead, color: c.textSecondary }}>Which one means</Text>
                <Text selectable style={{ ...type.cardBack, color: c.text, textAlign: 'center' }}>{question.target.meaning}</Text>
                {question.target.partOfSpeech ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{question.target.partOfSpeech}</Text> : null}
              </>
            ) : (
              <>
                <Text style={{ ...type.subhead, color: c.textSecondary }}>Which did you hear?</Text>
                <PlayButton label="Play the word again" onPress={() => void play(question.target.word, language)} />
              </>
            )}
          </Card>
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
          </View>
          {picked !== undefined ? (
            <Reveal>
              {picked === question.target.noteId
                ? <Status tone="good">Right.</Status>
                : <Status tone="bad">{`Not quite. It's ${question.target.word}.${mode === 'ear' ? ' Play each one to hear the difference.' : ''} It comes back in a few words.`}</Status>}
            </Reveal>
          ) : null}
          {owed ? <Help>{`From your last session: ${owed} more ${owed === 1 ? 'word' : 'words'} to go.`}</Help> : null}
        </>
      )}
      <ChipChoice label="Tell them apart" options={MODES} value={mode} onChange={(m) => { setMode(m); setOverride((o) => ({ ...o, mode: undefined })); }} />
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
  const wordStyle = hasThai(word.word) ? { ...thaiTextStyle('large'), fontSize: 26 } : { ...type.title, fontWeight: '400' as const };
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
        borderRadius: radius.m, ...smooth, borderWidth: marked ? 1.5 : hairline, borderColor: tint,
      }}
    >
      {state === 'right' ? <Icon name="checkmark.circle.fill" size={20} color={c.countDue} /> : null}
      {state === 'wrong' ? <Icon name="xmark.circle.fill" size={20} color={c.danger} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...wordStyle, color: c.text }}>{word.word}</Text>
        {state === 'open' ? null : <Text style={{ ...type.subhead, color: c.textSecondary }}>{detail(word)}</Text>}
      </View>
      {onPlay ? <PlayButton label={`Play ${word.word}`} onPress={onPlay} /> : null}
    </Tappable>
  );
}
