import { Stack } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { choiceText, COUNT_MAXES, countChoices, countKey, knownCountNouns, missingCounters, nounGloss, randomCount, type CountMode, type CountQuestion } from '../../tools/counting';
import { languageHeadwords } from '../../tools/skills';
import type { Phrase } from '../../tools/phrase';
import { toolPrefs } from '../../tools/storage';
import { COUNTING, toolLanguage } from '../../tools/tools';
import { haptic } from '../haptics';
import { Button, Icon, Tappable } from '../kit';
import type { CardMotion } from '../SwipeCard';
import { hairline, radius, smooth, space, type, useTheme } from '../theme';
import type { ToolScreenProps } from './index';
import { PracticeCard, SayFooter, useSwipeSetting } from './PracticeCard';
import { AnswerContent, RuleLine, Status, ToolScreen, useAnswer, useToolLanguage, useToolPref } from './ToolScreen';
import { drawFromBag } from '../../tools/drillSeenStorage';
import { useMarks } from './useMarks';
import { useRetries } from './useRetries';
import { withThaiLineHeight } from '../../core/script';

const MODES: { value: CountMode; label: string }[] = [{ value: 'say', label: 'Say it' }, { value: 'pick', label: 'Pick' }];

/**
 * Counting things: a number and a noun, to say together in the chosen language (counting.ts), as
 * Review's card: tap it for the answer, then Missed it or Got it (swiped too, when swipe is on),
 * and the next question follows, an infinite deck. Answer by and Numbers up to are in the header's
 * menu. Say it shows the answer, marked Missed it or Got it as in the other tools; Pick offers it among
 * three wrong ones that look right (another classifier, case or plural), and the first pick is the
 * mark. A miss shows the rule behind the answer. A new question leans toward the counters, cases
 * and nouns missed lately (useMarks), and one missed comes back once a few questions later.
 */
export function CountingTool({ tool, repo }: ToolScreenProps) {
  const c = useTheme();
  const [language, setLanguage] = useToolLanguage(tool);
  const answer = useAnswer(repo, language);
  const marks = useMarks(tool.id, language);
  const retries = useRetries<CountQuestion>();
  const [mode, setMode] = useToolPref('countMode');
  const [max, setMax] = useToolPref('countMax');
  const counting = COUNTING[language];
  // The headwords of this language's settled cards: Counting asks only about counters the deck knows (`knownCountNouns`).
  const [knownWords, setKnownWords] = useState<{ language: Language; words: string[] } | undefined>();
  useEffect(() => {
    let live = true;
    void Promise.all([repo.listNotes(), repo.listCards()]).then(([notes, cards]) => {
      if (live) setKnownWords({ language, words: languageHeadwords(language, notes, cards) });
    });
    return () => { live = false; };
  }, [repo, language]);
  const known = knownWords?.language === language ? knownWords.words : undefined;
  const pool = useMemo(() => (counting && known ? knownCountNouns(counting, known) : undefined), [counting, known]);
  const missing = useMemo(() => (counting && known ? missingCounters(counting, known) : []), [counting, known]);
  /** The question, with the language its noun is from, so another language's noun is never shown. */
  const [held, setHeld] = useState<{ language: Language; question?: CountQuestion }>(() => ({ language: toolLanguage(tool, toolPrefs().language) }));
  const question = held.language === language ? held.question : undefined;
  useEffect(() => {
    if (!counting || !pool?.length || (held.language === language && held.question && pool.includes(held.question.noun))) return;
    setHeld({ language, question: drawFromBag(language, tool.id, () => randomCount(counting.nouns.length, max, undefined, Math.random, pool), countKey) });
  }, [held, language, counting, pool, max, tool.id]);

  const saying = useMemo(() => (question && counting ? counting.say(question.noun, question.n) : undefined), [counting, question]);
  const rule = question && counting ? counting.rule(question.noun, question.n) : undefined;
  const key = question ? `${language}|${countKey(question)}` : '';
  const { choices, correct } = useMemo(
    () => (question && counting && saying
      ? countChoices(saying.everyday, counting.wrong(question.noun, question.n), Math.random, (p) => choiceText(p, counting.pickByReading))
      : { choices: [], correct: -1 }),
    [question, counting, saying],
  );

  const [picked, setPicked] = useState<{ key: string; index: number | null } | null>(null);
  const pick = picked?.key === key ? picked : null;
  const [marked, setMarked] = useState<string | null>(null);
  const motion = useRef<CardMotion | null>(null);
  const swipeOn = useSwipeSetting(repo);

  const mark = (right: boolean) => {
    if (!question || !counting || marked === key) return;
    setMarked(key);
    marks.mark(counting.patterns(question.noun, question.n), right);
    if (!right) retries.missed(`${language}|${max}`, countKey(question), question);
  };
  const next = (m = max) => {
    if (!counting || !pool?.length) return;
    answer.hide();
    setPicked(null);
    setMarked(null);
    const draw = () => marks.pick(() => randomCount(counting.nouns.length, m, question, Math.random, pool), (q) => counting.patterns(q.noun, q.n), countKey);
    // A missed question comes back only in the same language and range.
    setHeld({ language, question: retries.next(`${language}|${m}`, question && countKey(question), draw) });
  };
  const choose = (index: number) => {
    if (pick || !saying) return;
    setPicked({ key, index });
    mark(index === correct);
    haptic.answer();
    answer.speak(saying.everyday);
  };
  const revealPick = () => {
    if (pick || !saying) return;
    setPicked({ key, index: null });
    mark(false);
    answer.speak(saying.everyday);
  };

  const noun = question && counting ? counting.nouns[question.noun] : undefined;
    const answered = mode === 'pick' ? !!pick : answer.shown;
  const missedPick = !!pick && pick.index !== null && pick.index !== correct;

  // A mark, from a button or a swipe: Missed it with a rule keeps the answer up with the rule until Next.
  const markAndMove = (right: boolean) => {
    haptic.answer();
    motion.current?.flash(right ? 3 : 1);
    mark(right);
    if (!right && rule) answer.miss();
    else next();
  };
  const showAnswer = () => answer.show(saying?.everyday);

  const front = (
    <View style={{ alignItems: 'center', gap: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.l }}>
        <Text maxFontSizeMultiplier={1.5} style={{ ...type.largeTitle, fontSize: 48, fontVariant: ['tabular-nums'], color: c.text }}>{question?.n}</Text>
        {noun ? <Text selectable accessibilityLanguage={LANGUAGES[language].speech} style={{ ...withThaiLineHeight(type.cardFront, noun.cue.text), color: c.text, flexShrink: 1 }}>{noun.cue.text}</Text> : null}
      </View>
      {noun?.cue.roman ? <Text accessibilityLanguage={LANGUAGES[language].speech} style={{ ...type.subhead, color: c.textSecondary }}>{noun.cue.roman}</Text> : null}
      {noun ? <Text style={{ ...type.subhead, color: c.text }}>{nounGloss(noun)}</Text> : null}
    </View>
  );

  let back: React.ReactNode;
  if (mode === 'say') {
    back = answer.shown && saying ? <AnswerContent centered answer={{ everyday: saying.everyday, also: saying.also }} rule={answer.missed ? rule : undefined} onPlay={answer.speak} /> : undefined;
  } else if (pick) {
    back = (
      <View style={{ gap: space.m }}>
        {pick.index !== null ? (missedPick ? <Status tone="bad">{`Incorrect. It's ${choiceText(choices[correct], !!counting?.pickByReading)}.`}</Status> : <Status tone="good">Right.</Status>) : null}
        {(missedPick || pick.index === null) && rule ? <RuleLine rule={rule} /> : null}
      </View>
    );
  }

  let footer: React.ReactNode;
  if (mode === 'pick') {
    footer = (
      <View style={{ gap: space.s }}>
        <Choices speech={LANGUAGES[language].speech} choices={choices} correct={correct} picked={pick} byReading={!!counting?.pickByReading} onChoose={choose} />
        {pick ? <Button label="Next" onPress={() => next()} /> : <Button variant="secondary" label="Show answer" onPress={revealPick} />}
      </View>
    );
  } else footer = <SayFooter shown={answer.shown} missed={answer.missed} onShow={showAnswer} onNext={() => next()} onMark={markAndMove} />;

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={(l) => { setLanguage(l); answer.hide(); }}
      shown={answer.shown}
      onRandomize={() => next()}
      onShow={showAnswer}
      onMark={markAndMove}
      fill
      lockGesture={swipeOn && mode === 'say' && answer.shown && !answer.missed}
      footer={footer}
      menu={[
        <Stack.Toolbar.Menu key="1" inline title="Answer by">
          {MODES.map((m) => <Stack.Toolbar.MenuAction key={m.value} isOn={m.value === mode} onPress={() => { if (m.value !== mode) { setMode(m.value); answer.hide(); } }}>{m.label}</Stack.Toolbar.MenuAction>)}
        </Stack.Toolbar.Menu>,
        <Stack.Toolbar.Menu key="2" inline title="Numbers up to">
          {COUNT_MAXES.map((m) => <Stack.Toolbar.MenuAction key={m} isOn={m === max} onPress={() => { if (m !== max) { setMax(m); next(m); } }}>{String(m)}</Stack.Toolbar.MenuAction>)}
        </Stack.Toolbar.Menu>,
      ]}
    >
      {pool && !pool.length ? (
        <View style={{ flex: 1, justifyContent: 'center', gap: space.s, paddingHorizontal: space.l }}>
          <Text style={{ ...type.headline, color: c.text, textAlign: 'center' }}>No counters to practice yet</Text>
          <Text style={{ ...type.body, color: c.textSecondary, textAlign: 'center' }}>
            {`Counting things asks only about counters your deck knows. Learn one first, such as ${missing.slice(0, 3).join(', ')}, and it shows up here once its card has settled.`}
          </Text>
        </View>
      ) : <PracticeCard
        questionKey={key}
        cardKey={`${key}|${answer.shown}|${answer.missed}`}
        swipe={swipeOn && mode === 'say' && answer.shown && !answer.missed}
        motion={motion}
        onMark={markAndMove}
        onTap={mode === 'say' && !answer.shown ? showAnswer : undefined}
        onPlay={answered && saying ? () => answer.speak(saying.everyday) : undefined}
        speech={LANGUAGES[language].speech}
        front={front}
        back={back}
      />}
    </ToolScreen>
  );
}

/** Pick: the four choices in the footer, the right one marked once answered (the card above says whether the pick was right, and the rule after a miss). */
function Choices({ speech, choices, correct, picked, byReading, onChoose }: {
  /** The language's speech tag, so the choices draw in its font. */
  speech: string;
  choices: Phrase[];
  /** Show each by its reading, and its text under it once answered (Japanese). */
  byReading: boolean;
  correct: number;
  picked: { index: number | null } | null;
  onChoose: (index: number) => void;
}) {
  const c = useTheme();
  const answered = !!picked;
  return (
    <View style={{ gap: space.s }}>
      {choices.map((p, i) => {
        const isRight = answered && i === correct;
        const isWrong = picked?.index === i && i !== correct;
        return (
          <Tappable
            key={choiceText(p, byReading)}
            onPress={() => onChoose(i)}
            disabled={answered}
            accessibilityRole="button"
            accessibilityLabel={`${choiceText(p, byReading)}${isRight ? ', right' : isWrong ? ', wrong' : ''}`}
            accessibilityState={{ selected: picked?.index === i, disabled: answered }}
            scaleTo={0.98}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 52, paddingHorizontal: space.m, paddingVertical: space.s, backgroundColor: isRight ? c.goodFill : isWrong ? c.dangerFill : c.surface,
              borderRadius: radius.m + 2, ...smooth, borderWidth: isRight || isWrong ? 1.5 : hairline, borderColor: isRight ? c.countDue : isWrong ? c.danger : c.border,
            }}
          >
            <View style={{ flex: 1, gap: space.xs }}>
              <Text accessibilityLanguage={speech} style={{ ...type.body, lineHeight: 26, color: c.text }}>{choiceText(p, byReading)}</Text>
              {answered && p.roman ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{byReading ? p.text : p.roman}</Text> : null}
            </View>
            {isRight ? <Icon name="checkmark.circle.fill" size={22} color={c.countDue} /> : null}
            {isWrong ? <Icon name="xmark.circle.fill" size={22} color={c.danger} /> : null}
          </Tappable>
        );
      })}
    </View>
  );
}
