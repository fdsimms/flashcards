import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { LANGUAGES } from '../../reader/languages';
import { choiceText, COUNT_MAXES, countChoices, countKey, randomCount, type CountMode, type CountQuestion } from '../../tools/counting';
import type { Phrase } from '../../tools/phrase';
import { toolPrefs } from '../../tools/storage';
import { COUNTING, toolLanguage } from '../../tools/tools';
import { haptic } from '../haptics';
import { Card, Icon, Tappable } from '../kit';
import { Reveal } from '../motion';
import { hairline, radius, smooth, space, type, useTheme } from '../theme';
import type { ToolScreenProps } from './index';
import { AnswerCard, ChipChoice, nextOnly, RuleLine, Status, ToolScreen, useAnswer, useToolLanguage, useToolPref, type ToolActions } from './ToolScreen';
import { useMarks } from './useMarks';
import { useRetries } from './useRetries';

const MODES: { value: CountMode; label: string }[] = [{ value: 'say', label: 'Say it' }, { value: 'pick', label: 'Pick' }];

/**
 * Counting things: a number and a noun, to say together in the chosen language (counting.ts).
 * Say it shows the answer, marked Missed it or Got it as in the other tools; Pick offers it among
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
  /** The question, with the language its noun is from, so another language's noun is never shown. */
  const [held, setHeld] = useState(() => {
    const l = toolLanguage(tool, toolPrefs().language);
    return { language: l, question: randomCount(COUNTING[l]?.nouns.length ?? 1, toolPrefs().countMax) };
  });
  const question = held.language === language ? held.question : undefined;
  useEffect(() => {
    if (held.language !== language && counting) setHeld({ language, question: randomCount(counting.nouns.length, max) });
  }, [held.language, language, counting, max]);

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

  const mark = (right: boolean) => {
    if (!question || !counting || marked === key) return;
    setMarked(key);
    marks.mark(counting.patterns(question.noun, question.n), right);
    if (!right) retries.missed(`${language}|${max}`, countKey(question), question);
  };
  const next = (m = max) => {
    if (!counting) return;
    answer.hide();
    setPicked(null);
    setMarked(null);
    const draw = () => marks.pick(() => randomCount(counting.nouns.length, m, question), (q) => counting.patterns(q.noun, q.n));
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
  const reveal = () => {
    if (pick || !saying) return;
    setPicked({ key, index: null });
    mark(false);
    answer.speak(saying.everyday);
  };

  let actions: ToolActions | undefined;
  if (mode === 'pick') actions = pick ? { primary: { label: 'Next', onPress: () => next() } } : { secondary: { label: 'Randomize', onPress: () => next() }, primary: { label: 'Show answer', onPress: reveal } };
  else if (answer.missed) actions = nextOnly(() => next());

  const noun = question && counting ? counting.nouns[question.noun] : undefined;

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={(l) => { setLanguage(l); answer.hide(); }}
      shown={answer.shown}
      onRandomize={() => next()}
      onShow={() => answer.show(saying?.everyday)}
      onMark={(right) => {
        mark(right);
        if (!right && rule) answer.miss();
        else next();
      }}
      actions={actions}
    >
      <Card style={{ minHeight: 130, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xl }}>
        <Text maxFontSizeMultiplier={1.5} style={{ ...type.largeTitle, fontSize: 48, fontVariant: ['tabular-nums'], color: c.text }}>{question?.n}</Text>
        {noun ? (
          <View style={{ gap: 2, flexShrink: 1 }}>
            <Text selectable style={{ ...type.cardFront, color: c.text }}>{noun.cue.text}</Text>
            <Text style={{ ...type.subhead, color: c.textSecondary }}>{[noun.cue.roman, noun.meaning].filter(Boolean).join(' · ')}</Text>
          </View>
        ) : null}
      </Card>

      {mode === 'say' ? (
        <AnswerCard
          shown={answer.shown}
          prompt={`Say the number with the noun in ${LANGUAGES[language].name}, then show the answer.`}
          answer={saying && { everyday: saying.everyday, also: saying.also }}
          rule={answer.missed ? rule : undefined}
          onPlay={answer.speak}
        />
      ) : (
        <Choices choices={choices} correct={correct} picked={pick} rule={rule} byReading={!!counting?.pickByReading} onChoose={choose} />
      )}

      <ChipChoice label="Answer by" options={MODES} value={mode} onChange={(m) => { setMode(m); answer.hide(); }} />
      <ChipChoice label="Numbers up to" options={COUNT_MAXES.map((m) => ({ value: m, label: String(m) }))} value={max} onChange={(m) => { setMax(m); next(m); }} />
    </ToolScreen>
  );
}

/** Pick: the four choices, then whether the pick was right, with the rule after a miss. */
function Choices({ choices, correct, picked, rule, byReading, onChoose }: {
  choices: Phrase[];
  /** Show each by its reading, and its text under it once answered (Japanese). */
  byReading: boolean;
  correct: number;
  picked: { index: number | null } | null;
  rule: string | undefined;
  onChoose: (index: number) => void;
}) {
  const c = useTheme();
  const answered = !!picked;
  const missed = answered && picked.index !== correct;
  return (
    <View style={{ gap: space.m }}>
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
              scaleTo={0.99}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 52, padding: space.m, backgroundColor: c.surface,
                borderRadius: radius.m, ...smooth, borderWidth: isRight || isWrong ? 1.5 : hairline, borderColor: isRight ? c.countDue : isWrong ? c.danger : c.border,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ ...type.body, lineHeight: 26, color: c.text }}>{choiceText(p, byReading)}</Text>
                {answered && p.roman ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{byReading ? p.text : p.roman}</Text> : null}
              </View>
              {isRight ? <Icon name="checkmark.circle.fill" size={22} color={c.countDue} /> : null}
              {isWrong ? <Icon name="xmark.circle.fill" size={22} color={c.danger} /> : null}
            </Tappable>
          );
        })}
      </View>
      {answered && picked.index !== null ? (
        <Reveal>{missed ? <Status tone="bad">{`Not quite. It's ${choiceText(choices[correct], byReading)}.`}</Status> : <Status tone="good">Right.</Status>}</Reveal>
      ) : null}
      {(missed || picked?.index === null) && rule ? <Reveal><RuleLine rule={rule} /></Reveal> : null}
    </View>
  );
}
