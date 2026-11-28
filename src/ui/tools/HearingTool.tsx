import { Stack } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { hasThai, japaneseFont, thaiTextStyle } from '../../core/script';
import {
  drawHearing, HEARING, hearingPatterns, targetsFor, questionKey, ROUND_LENGTH, roundResults, soundById, soundOf, validFocus, weakestSound,
  type HearingAnswer, type HearingFocus, type HearingLanguage, type HearingQuestion, type HearingWord, type SoundResult,
} from '../../tools/hearing';
import { toneOfRoman, TONE_NAMES, type Tone } from '../../tools/thai/script';
import { useLanguageFont } from '../AppFont';
import { haptic } from '../haptics';
import { Button, Card, Help, Icon, Meter, Tappable } from '../kit';
import type { CardMotion } from '../SwipeCard';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from '../theme';
import type { ToolScreenProps } from './index';
import { ListenPrompt, PracticeCard } from './PracticeCard';
import { ToneContour, ToneContours } from './ToneContour';
import { PlayButton, Status, ToolLanguage, ToolScreen, useToolLanguage, useToolPref } from './ToolScreen';
import { LANGUAGES } from '../../reader/languages';
import { useHearingAudio, type HeardIn } from './useHearingAudio';
import { useMarks } from './useMarks';
import { useRetries } from './useRetries';

/** An answer: the word picked (its index in the set), the tone picked, or null for I don't know. */
type Picked = { choice: number | Tone | null };

/** What the line under the play button says about the voice. */
function voiceLine(heard: HeardIn | null): string | undefined {
  if (!heard) return undefined;
  if (heard.kind === 'voice') return heard.of > 1 ? `Voice ${heard.index + 1} of ${heard.of}. Play it again for another voice.` : undefined;
  if (heard.kind === 'none') return "Couldn't play this word: it needs its recording, and Read & Listen couldn't be reached. Choose I don't know to go on.";
  if (heard.why === 'off') return "Only the phone's voice. Turn on Read & Listen to hear each word in 3 or 4 voices.";
  if (heard.why === 'unreachable') return "Only the phone's voice: Read & Listen couldn't be reached. Words recorded before still play in their voices.";
  return "Only the phone's voice: Read & Listen has no voices for this language.";
}

/**
 * Hearing sounds (src/tools/hearing.ts), as Review's card (PracticeCard.tsx): a word is played and
 * the footer lists the words it could have been, or for a Thai tone question the five tones. Each
 * play of a question is the next of the language's voices (useHearingAudio). Which sounds are
 * practiced is in the header's menu. After `ROUND_LENGTH` answers the round's results show by
 * sound, with the weakest offered on its own. A miss comes back a few questions later, and each
 * answer is tallied against its sound (useMarks), so the sounds missed lately come up more. Nothing
 * here grades a card.
 */
export function HearingTool({ tool, repo, readerApi, params }: ToolScreenProps) {
  const c = useTheme();
  const [savedLanguage, setLanguage] = useToolLanguage(tool);
  // Opened from Review's session end on a language and group (Thai tones): those, until another is chosen here.
  const opened = useMemo(() => tool.languages.find((l) => l === params.language), [tool.languages, params.language]);
  const [openedLanguage, setOpenedLanguage] = useState(opened);
  const language = openedLanguage ?? savedLanguage;
  const def = HEARING[language] as HearingLanguage;
  const [groups, setGroups] = useToolPref('hearingGroups');
  // A focus not saved as the language's choice: the group Review opened on, or one sound from a
  // round's results. Cleared by choosing sounds in the menu or another language.
  const [override, setOverride] = useState<{ language: string; focus: HearingFocus } | null>(
    () => (opened && params.group ? { language: opened, focus: { kind: 'group', id: params.group } } : null),
  );
  const focus: HearingFocus = validFocus(def, override?.language === language
    ? override.focus
    : groups[language] ? { kind: 'group', id: groups[language]! } : { kind: 'all' });
  const scope = `${language}|${focus.kind}:${focus.kind === 'all' ? '' : focus.id}`;

  const audio = useHearingAudio(repo, readerApi, language);
  // Only the phone's voice: a set it can't say (Russian stress) isn't asked.
  const recorded = audio.voiceCount > 0;
  const marks = useMarks(tool.id, language);
  const retries = useRetries<HearingQuestion>();
  const [question, setQuestion] = useState<HearingQuestion | undefined>();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [answers, setAnswers] = useState<HearingAnswer[]>([]);
  const [results, setResults] = useState<SoundResult[] | null>(null);
  const [heard, setHeard] = useState<HeardIn | null>(null);
  // Which voice the next play is in: each play moves on one, from a random start for each question.
  const turn = useRef(0);

  const set = question ? def.sets[question.set] : undefined;
  const target = set && question ? set.words[question.target] : undefined;

  const play = (word: HearingWord, next = true) => {
    const t = turn.current;
    if (next) turn.current++;
    void audio.play(word, t).then((h) => setHeard(h));
  };

  const ask = (current: HearingQuestion | undefined) => {
    const previous = current ? questionKey(current) : undefined;
    if (!targetsFor(def, focus, recorded).length) { setQuestion(undefined); return; }
    const draw = () => marks.pick(() => drawHearing(def, focus, previous, Math.random, recorded) as HearingQuestion, (q) => hearingPatterns(def, q), questionKey);
    const q = retries.next(scope, previous, draw);
    setQuestion(q);
    setPicked(null);
    turn.current = Math.floor(Math.random() * 4);
    const word = q ? def.sets[q.set]?.words[q.target] : undefined;
    if (word) play(word);
  };
  // A new round whenever the language or what's practiced changes, once the voices are known.
  useEffect(() => {
    if (!audio.ready) return;
    setAnswers([]);
    setResults(null);
    ask(undefined);
  }, [scope, audio.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const rightTone = target ? toneOfRoman(target.roman) : undefined;
  const choose = (choice: number | Tone | null) => {
    if (!question || !set || !target || picked) return;
    const right = question.kind === 'tone' ? choice === rightTone : choice === question.target;
    setPicked({ choice });
    marks.mark(hearingPatterns(def, question), right);
    setAnswers((a) => [...a, { sound: soundOf(set, target), right }]);
    if (right) haptic.success();
    else {
      haptic.answer();
      retries.missed(scope, questionKey(question), question);
    }
  };
  const roundDone = answers.length >= ROUND_LENGTH;
  const next = () => {
    if (roundDone) { setResults(roundResults(def, answers)); return; }
    ask(question);
  };
  const newRound = (f: HearingFocus) => {
    setAnswers([]);
    setResults(null);
    if (f.kind === 'sound') setOverride({ language, focus: f });
    else {
      setOverride(null);
      const nextGroups = { ...groups };
      if (f.kind === 'group') nextGroups[language] = f.id;
      else delete nextGroups[language];
      setGroups(nextGroups);
    }
    // The same focus asks no new question by itself (the effect only follows a change): ask here.
    const same = f.kind === focus.kind && (f.kind === 'all' || (focus.kind !== 'all' && f.id === focus.id));
    if (same) ask(question);
  };

  const motion = useRef<CardMotion | null>(null);
  const answered = !!picked;
  const right = !!picked && (question?.kind === 'tone' ? picked.choice === rightTone : picked.choice === question?.target);
  const sound = set && target ? soundById(def, soundOf(set, target)) : undefined;
  const line = voiceLine(heard);

  const menu = [
    <Stack.Toolbar.Menu key="sounds" inline title="Sounds">
      <Stack.Toolbar.MenuAction isOn={focus.kind === 'all'} onPress={() => newRound({ kind: 'all' })}>All sounds</Stack.Toolbar.MenuAction>
      {def.groups.map((g) => (
        <Stack.Toolbar.MenuAction key={g.id} isOn={focus.kind === 'group' && focus.id === g.id} onPress={() => newRound({ kind: 'group', id: g.id })}>{g.label}</Stack.Toolbar.MenuAction>
      ))}
      {focus.kind === 'sound' ? <Stack.Toolbar.MenuAction isOn onPress={() => {}}>{soundById(def, focus.id)?.label ?? ''}</Stack.Toolbar.MenuAction> : null}
    </Stack.Toolbar.Menu>,
  ];

  let body: React.ReactNode;
  let footer: React.ReactNode;
  if (results) {
    const firstTry = answers.filter((a) => a.right).length;
    const weakest = weakestSound(results);
    body = <RoundResults results={results} right={firstTry} asked={answers.length} weakest={weakest} />;
    footer = (
      <View style={{ gap: space.s }}>
        <Button label="Another round" onPress={() => newRound(focus)} />
        {weakest ? <Button variant="secondary" label={`Practice ${weakest.label.replace(/^./, (ch) => ch.toLowerCase())}`} onPress={() => newRound({ kind: 'sound', id: weakest.sound })} /> : null}
      </View>
    );
  } else if (question && set && target) {
    const isTone = question.kind === 'tone';
    const front = (
      <ListenPrompt wave label="Play the word again" hint={isTone ? 'Which tone did you hear?' : 'Which did you hear?'} onPlay={() => play(target)}>
        {line ? <Help>{line}</Help> : null}
      </ListenPrompt>
    );
    const back = answered ? (
      <View style={{ gap: space.m }}>
        <View style={{ alignItems: 'center' }}>
          {right
            ? <Status tone="good">{isTone && rightTone ? `Right. ${TONE_NAMES[rightTone]} tone.` : 'Right.'}</Status>
            : <Status tone="bad">{isTone && rightTone ? `Incorrect. It's ${TONE_NAMES[rightTone].toLowerCase()}.` : `Incorrect. It was ${target.word}.`}</Status>}
        </View>
        {isTone && rightTone ? (
          <View style={{ alignItems: 'center', gap: space.s }}>
            <ToneContour tone={rightTone} width={64} />
            <WordLines word={target} centered />
            <PlayButton label={`Play ${target.word}`} onPress={() => play(target)} />
          </View>
        ) : null}
        {!right && sound ? (
          <View style={{ gap: space.xs, borderTopWidth: hairline, borderTopColor: c.border, paddingTop: space.m }}>
            <Text style={{ ...type.overline, color: c.textSecondary }}>{sound.label}</Text>
            <Text style={{ ...type.subhead, color: c.text }}>{sound.tip}</Text>
            {!isTone ? <Text style={{ ...type.subhead, color: c.textSecondary }}>Play each word below to compare them.</Text> : null}
          </View>
        ) : null}
      </View>
    ) : undefined;
    body = (
      <PracticeCard
        questionKey={`${questionKey(question)}|${scope}|${answers.length}`}
        cardKey={`${questionKey(question)}|${scope}|${answers.length}|${String(picked?.choice)}`}
        swipe={false}
        motion={motion}
        onMark={() => {}}
        front={front}
        back={back}
      />
    );
    footer = (
      <View style={{ gap: space.s }}>
        {isTone && rightTone
          ? <ToneContours tone={rightTone} picked={picked ? { tone: picked.choice as Tone | null } : null} onChoose={(t) => choose(t)} />
          : set.words.map((w, i) => (
            <Choice
              key={`${w.word}|${i}`}
              word={w}
              state={!picked ? 'open' : i === question.target ? 'right' : i === picked.choice ? 'wrong' : 'other'}
              onPress={() => choose(i)}
              onPlay={picked ? () => play(w, false) : undefined}
            />
          ))}
        {answered
          ? <Button label={roundDone ? 'See how you did' : 'Next'} onPress={next} />
          : <Button variant="secondary" label="I don't know" onPress={() => choose(null)} />}
        <Text style={{ ...type.caption, color: c.textSecondary, textAlign: 'center' }}>{`${Math.min(answers.length + (answered ? 0 : 1), ROUND_LENGTH)} of ${ROUND_LENGTH}`}</Text>
      </View>
    );
  } else if (audio.ready) {
    // Nothing to ask: the sounds chosen are ones only Azure's recordings can say.
    body = (
      <View style={{ padding: space.l }}>
        <Card><Help>{"These sounds need Azure's recordings, since the phone's voice can't say them apart. Turn on Read & Listen, or choose other sounds in the menu."}</Help></Card>
      </View>
    );
    footer = <View />;
  } else {
    body = <View />;
    footer = <View />;
  }

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={(l) => { setLanguage(l); setOpenedLanguage(undefined); setOverride(null); }}
      shown={answered}
      onRandomize={() => { if (!results) next(); }}
      onShow={() => choose(null)}
      onMark={() => next()}
      fill
      footer={footer}
      menu={menu}
    >
      {body}
    </ToolScreen>
  );
}

/** A word's romanization and meaning, under it. */
function WordLines({ word, centered }: { word: HearingWord; centered?: boolean }) {
  const c = useTheme();
  const language = React.useContext(ToolLanguage);
  const font = useLanguageFont(language);
  const align = centered ? 'center' as const : 'left' as const;
  const wordStyle = { ...(hasThai(word.word) ? { ...thaiTextStyle('large'), fontSize: 26 } : { ...type.title, fontWeight: '400' as const }), ...japaneseFont(word.word, 'ja', font) };
  return (
    <View style={{ gap: 2 }}>
      <Text accessibilityLanguage={language ? LANGUAGES[language].speech : undefined} style={{ ...wordStyle, color: c.text, textAlign: align }}>{word.word}</Text>
      <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: align }}>{`${word.roman} · ${word.meaning}`}</Text>
    </View>
  );
}

/** One word to choose: its romanization and meaning are shown before answering too, since telling the sounds apart is the question, not reading. */
function Choice({ word, state, onPress, onPlay }: {
  word: HearingWord;
  state: 'open' | 'right' | 'wrong' | 'other';
  onPress: () => void;
  onPlay?: () => void;
}) {
  const c = useTheme();
  const marked = state === 'right' || state === 'wrong';
  return (
    <Tappable
      onPress={onPress}
      disabled={state !== 'open'}
      accessibilityRole="button"
      accessibilityLabel={`${word.word}, ${word.roman}, ${word.meaning}${state === 'right' ? ', right' : state === 'wrong' ? ', your pick, wrong' : ''}`}
      accessibilityState={{ disabled: state !== 'open' }}
      scaleTo={0.98}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: MIN_TAP + 16, paddingHorizontal: space.l, paddingVertical: space.s,
        backgroundColor: state === 'right' ? c.goodFill : state === 'wrong' ? c.dangerFill : c.surface,
        borderRadius: radius.m + 2, ...smooth, borderWidth: marked ? 1.5 : hairline, borderColor: state === 'right' ? c.countDue : state === 'wrong' ? c.danger : c.border,
      }}
    >
      {state === 'right' ? <Icon name="checkmark.circle.fill" size={20} color={c.countDue} /> : null}
      {state === 'wrong' ? <Icon name="xmark.circle.fill" size={20} color={c.danger} /> : null}
      <View style={{ flex: 1 }}><WordLines word={word} /></View>
      {onPlay ? <PlayButton label={`Play ${word.word}`} onPress={onPlay} /> : null}
    </Tappable>
  );
}

/** A round's end: how many were heard right, and each sound's share, the weakest first. */
function RoundResults({ results, right, asked, weakest }: { results: SoundResult[]; right: number; asked: number; weakest: SoundResult | undefined }) {
  const c = useTheme();
  return (
    <View style={{ padding: space.l, gap: space.m }}>
      <Card>
        <Text style={{ ...type.overline, color: c.textSecondary }}>Round done</Text>
        <Text style={{ ...type.title, color: c.text, fontVariant: ['tabular-nums'] }}>{`${right} of ${asked} right`}</Text>
      </Card>
      <Card>
        <Text style={{ ...type.overline, color: c.textSecondary }}>By sound</Text>
        <View style={{ gap: space.m }}>
          {results.map((r) => (
            <View key={r.sound} style={{ gap: space.xs }} accessible accessibilityLabel={`${r.label}: ${r.right} of ${r.asked} right`}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s }}>
                <Text style={{ ...type.subhead, color: c.text, flex: 1 }}>{r.label}</Text>
                <Text style={{ ...type.subhead, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{`${r.right} / ${r.asked}`}</Text>
              </View>
              <Meter value={r.right / r.asked} color={r === weakest ? c.danger : c.countDue} />
            </View>
          ))}
        </View>
        {weakest ? <Help>{`${weakest.label} will come up more often until you get it right more.`}</Help> : null}
      </Card>
    </View>
  );
}
