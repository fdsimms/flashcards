import { Stack } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { japaneseFont } from '../../core/script';
import { LANGUAGES } from '../../reader/languages';
import type { Phrase } from '../../tools/phrase';
import { randomWord, type ScriptMode } from '../../tools/script';
import { toolPrefs } from '../../tools/storage';
import { SYLLABLES, TONE_NAMES, toneOf, toneSteps, type Tone } from '../../tools/thai/script';
import { SCRIPTS, toolLanguage } from '../../tools/tools';
import { haptic } from '../haptics';
import { Button } from '../kit';
import type { CardMotion } from '../SwipeCard';
import { hairline, space, type, useTheme } from '../theme';
import { useFont } from '../AppFont';
import type { ToolScreenProps } from './index';
import { AnswerContent, Status, ToolScreen, useAnswer, useToolLanguage, useToolPref } from './ToolScreen';
import { LetterDrill } from './LetterDrill';
import { PracticeCard, SayFooter, useSwipeSetting } from './PracticeCard';
import { ToneContour, ToneContours } from './ToneContour';
import { drawFromBag } from '../../tools/drillSeenStorage';
import { useMarks } from './useMarks';
import { useRetries } from './useRetries';

const MODES: { value: ScriptMode; label: string }[] = [{ value: 'tone', label: 'Name the tone' }, { value: 'read', label: 'Read it aloud' }, { value: 'consonants', label: 'Consonants' }, { value: 'vowels', label: 'Vowels' }];

/** Reading the script's exercises as the header menu's Practice section (Thai only), for ScriptTool and LetterDrill. */
export function practiceMenu(mode: ScriptMode, onChange: (m: ScriptMode) => void): React.ReactNode[] {
  return [(
    <Stack.Toolbar.Menu key="practice" inline title="Practice">
      {MODES.map((m) => <Stack.Toolbar.MenuAction key={m.value} isOn={m.value === mode} onPress={() => { if (m.value !== mode) onChange(m.value); }}>{m.label}</Stack.Toolbar.MenuAction>)}
    </Stack.Toolbar.Menu>
  )];
}

/**
 * Reading the script, as Review's card (PracticeCard.tsx): Practice is in the header's gear menu. A word in the language's own letters. Read it aloud, then show the answer
 * (with its stress, or tone, and a romanization) and mark it Missed it or Got it; a miss shows
 * what's worth knowing to read it. In Thai, Name the tone asks for the syllable's tone, worked
 * out from how it's written (thai/script.ts), and shows the steps; Consonants and Vowels are
 * LetterDrill's. A new word leans toward the
 * letters and tone rules missed lately (useMarks), and one missed comes back a few words later.
 */
export function ScriptTool({ tool, repo }: ToolScreenProps) {
  const c = useTheme();
  const font = useFont();
  const [language, setLanguage] = useToolLanguage(tool);
  const answer = useAnswer(repo, language);
  const marks = useMarks(tool.id, language);
  const retries = useRetries<number>();
  const [savedMode, setMode] = useToolPref('scriptMode');
  // Only Thai has tones to name and letters to place; the other languages are read aloud.
  const mode: ScriptMode = language === 'th' ? savedMode : 'read';
  const practice = language === 'th' ? practiceMenu(mode, (m) => { setMode(m); answer.hide(); }) : undefined;
  const script = SCRIPTS[language];
  const [held, setHeld] = useState(() => {
    const l = toolLanguage(tool, toolPrefs().language);
    return { language: l, word: drawFromBag(language, tool.id, () => randomWord(SCRIPTS[l]?.words.length ?? 1), String) };
  });
  const index = held.language === language ? held.word : undefined;
  useEffect(() => {
    if (held.language !== language && script) setHeld({ language, word: marks.pick(() => randomWord(script.words.length), (i) => script.patterns(i), String) });
  }, [held.language, language, script]);

  const word = index !== undefined ? script?.words[index] : undefined;
  const rule = index !== undefined ? script?.rule(index) : undefined;
  const key = `${language}|${index}`;
  /** Read aloud as written: a stress mark isn't something a voice reads. */
  const spoken: Phrase | undefined = word && { text: word.shown };

  const [picked, setPicked] = useState<{ key: string; tone: Tone | null } | null>(null);
  const pick = picked?.key === key ? picked : null;
  const [marked, setMarked] = useState<string | null>(null);
  const mark = (right: boolean) => {
    if (index === undefined || !script || marked === key) return;
    setMarked(key);
    marks.mark(script.patterns(index), right);
    if (!right) retries.missed(language, String(index), index);
  };
  const next = () => {
    if (!script) return;
    answer.hide();
    setPicked(null);
    setMarked(null);
    const draw = () => marks.pick(() => randomWord(script.words.length, index), (i) => script.patterns(i), String);
    setHeld({ language, word: retries.next(language, index === undefined ? undefined : String(index), draw) });
  };

  const syllable = language === 'th' && index !== undefined ? SYLLABLES[index] : undefined;
  const tone = useMemo(() => (syllable ? toneOf(syllable) : undefined), [syllable]);
  const chooseTone = (t: Tone | null) => {
    if (pick || !tone) return;
    setPicked({ key, tone: t });
    mark(t === tone);
    if (t) haptic.answer();
    if (spoken) answer.speak(spoken);
  };

  const swipeOn = useSwipeSetting(repo);
  const motion = useRef<CardMotion | null>(null);
  const reading = mode === 'read';

  if (mode === 'consonants' || mode === 'vowels') {
    return <LetterDrill tool={tool} repo={repo} language={language} onLanguage={setLanguage} mode={mode} practice={practice} />;
  }

  // A mark, from a button or a swipe: Missed it with a rule keeps the answer up with the rule until Next.
  const markAndMove = (right: boolean) => {
    haptic.answer();
    motion.current?.flash(right ? 3 : 1);
    mark(right);
    if (!right && rule) answer.miss();
    else next();
  };
  const showAnswer = () => answer.show(spoken);
  const swipe = swipeOn && reading && answer.shown && !answer.missed;
  const answered = reading ? answer.shown : !!pick;

  const front = (
    <View style={{ alignItems: 'center', gap: space.xs }}>
      <Text selectable maxFontSizeMultiplier={1.5} style={{ ...type.cardFront, fontSize: language === 'th' ? 56 : 40, lineHeight: language === 'th' ? 80 : 52, ...japaneseFont(word?.shown ?? '', 'ja', font), color: c.text, textAlign: 'center' }}>{word?.shown}</Text>
      <Text style={{ ...type.subhead, color: c.textSecondary }}>{mode === 'tone' ? 'Which tone?' : word?.meaning}</Text>
    </View>
  );

  let back: React.ReactNode;
  let footer: React.ReactNode;
  if (mode === 'tone' && syllable && tone && word) {
    back = pick ? (
      <View style={{ gap: space.m }}>
        {pick.tone === null ? null : (
          <View style={{ alignItems: 'center' }}>
            {pick.tone === tone
              ? <Status tone="good">{`Right. ${TONE_NAMES[tone]} tone.`}</Status>
              : <Status tone="bad">{`Not quite. It's ${TONE_NAMES[tone].toLowerCase()}.`}</Status>}
          </View>
        )}
        <View style={{ alignItems: 'center' }}><ToneContour tone={tone} width={64} /></View>
        <View style={{ gap: space.xs }}>
          <Text style={{ ...type.cardBack, color: c.text, textAlign: 'center' }}>{word.answer.roman}</Text>
          <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>{word.meaning}</Text>
        </View>
        <View style={{ gap: space.s, borderTopWidth: hairline, borderTopColor: c.border, paddingTop: space.m }}>
          <Text style={{ ...type.overline, color: c.textSecondary }}>How to tell</Text>
          {toneSteps(syllable).map((step) => <Text key={step} style={{ ...type.subhead, color: c.text }}>{step}</Text>)}
        </View>
      </View>
    ) : undefined;
    footer = (
      <View style={{ gap: space.s }}>
        <ToneContours tone={tone} picked={pick} onChoose={chooseTone} />
        {pick ? <Button label="Next" onPress={next} /> : <Button variant="secondary" label="Show answer" onPress={() => chooseTone(null)} />}
      </View>
    );
  } else {
    back = answer.shown && word ? <AnswerContent centered answer={{ everyday: word.answer, also: [] }} rule={answer.missed ? rule : undefined} onPlay={answer.speak} /> : undefined;
    footer = <SayFooter shown={answer.shown} missed={answer.missed} onShow={showAnswer} onNext={next} onMark={markAndMove} />;
  }

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={(l) => { setLanguage(l); answer.hide(); }}
      shown={answer.shown}
      onRandomize={next}
      onShow={showAnswer}
      onMark={markAndMove}
      fill
      lockGesture={swipe}
      footer={footer}
      menu={practice}
    >
      <PracticeCard
        questionKey={key}
        cardKey={`${key}|${answer.shown}|${answer.missed}|${String(pick?.tone ?? '')}`}
        swipe={swipe}
        motion={motion}
        onMark={markAndMove}
        onTap={reading && !answer.shown ? showAnswer : undefined}
        onPlay={answered && spoken ? () => answer.speak(spoken) : undefined}
        speech={LANGUAGES[language].speech}
        front={front}
        back={back}
      />
    </ToolScreen>
  );
}
