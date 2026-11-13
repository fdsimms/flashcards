import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Text, View, type TextInputInstance } from 'react-native';
import { LANGUAGES } from '../../reader/languages';
import { checkDigits, questionKey, questionText, randomQuestion, type NumberKind, type NumberMode, type NumberQuestion } from '../../tools/number';
import { numberPatterns } from '../../tools/patterns';
import type { Phrase } from '../../tools/phrase';
import { numberRule } from '../../tools/rules';
import { toolPrefs } from '../../tools/storage';
import { NUMBER_SAYERS, toolLanguage } from '../../tools/tools';
import { haptic } from '../haptics';
import { Card, Field, Icon, Tappable } from '../kit';
import { Reveal } from '../motion';
import { space, type, useTheme } from '../theme';
import type { ToolScreenProps } from './index';
import { AnswerCard, ChipChoice, nextOnly, PlayButton, RuleLine, Status, ToolScreen, useAnswer, useToolLanguage, useToolPref, Ways, type ToolActions } from './ToolScreen';
import { useMarks } from './useMarks';
import { useRetries } from './useRetries';

const KINDS: { value: NumberKind; label: string }[] = [
  { value: 'number', label: 'Numbers' },
  { value: 'phone', label: 'Phone numbers' },
  { value: 'year', label: 'Years' },
  { value: 'age', label: 'Ages' },
];

const MODES: { value: NumberMode; label: string }[] = [{ value: 'say', label: 'Say it' }, { value: 'listen', label: 'Listen' }];

/** The card's label over the number, and what a typed answer is called. */
const KIND_LABEL: Record<NumberKind, string> = { number: 'Number', phone: 'Phone number', year: 'Year', age: 'Age' };

/**
 * Numbers: a plain number, a phone number, a year or an age, in the chosen language. Say it shows
 * the number to say aloud, then the answer, marked Missed it or Got it as in the other tools.
 * Listen reads it aloud (again on Play), and the digits typed are checked against it: the first
 * check of each question is its mark. Either way a miss shows the rule behind the answer where
 * there's one (rules.ts), a new question leans toward the kinds missed lately (useMarks), and one
 * missed comes back once a few questions later (useRetries).
 */
export function NumbersTool({ tool, repo }: ToolScreenProps) {
  const c = useTheme();
  const [language, setLanguage] = useToolLanguage(tool);
  const answer = useAnswer(repo, language);
  const marks = useMarks(tool.id, language);
  const retries = useRetries<NumberQuestion>();
  const [kind, setKind] = useToolPref('numberKind');
  const [mode, setMode] = useToolPref('numberMode');
  const [question, setQuestion] = useState<NumberQuestion>(() => {
    const prefs = toolPrefs();
    return randomQuestion(prefs.numberKind, toolLanguage(tool, prefs.language));
  });
  // A question of the kind chosen: the saved kind once it's read, or one just picked.
  useEffect(() => {
    if (question.kind !== kind) setQuestion(randomQuestion(kind, language));
  }, [question.kind, kind, language]);
  // A phone number is the language's own format, so another language needs another one.
  const [phoneLanguage, setPhoneLanguage] = useState(language);
  useEffect(() => {
    if (phoneLanguage === language) return;
    setPhoneLanguage(language);
    if (question.kind === 'phone') setQuestion(randomQuestion('phone', language));
  }, [language, phoneLanguage, question.kind]);

  const saying = useMemo(() => NUMBER_SAYERS[language]?.(question), [language, question]);
  const rule = useMemo(() => (saying ? numberRule(language, question, saying.everyday.text) : undefined), [language, question, saying]);
  const key = questionKey(question);
  const scope = `${language}|${kind}`;

  // Listen: what's typed and how the check went, both for this question only.
  const [typed, setTyped] = useState({ key, text: '' });
  const [checked, setChecked] = useState<{ key: string; right: boolean } | null>(null);
  const typedText = typed.key === key ? typed.text : '';
  const verdict = checked?.key === key ? checked : null;
  const marked = useRef<string | null>(null);

  const next = (k: NumberKind = kind) => {
    answer.hide();
    // A missed question handed back later is asked afresh: nothing typed, unchecked, unmarked.
    setTyped({ key: '', text: '' });
    setChecked(null);
    marked.current = null;
    const draw = () => marks.pick(() => randomQuestion(k, language, question), numberPatterns);
    setQuestion(retries.next(`${language}|${k}`, key, draw));
  };
  /** The question's mark: once, at its first answer. */
  const mark = (right: boolean) => {
    if (marked.current === key) return;
    marked.current = key;
    marks.mark(numberPatterns(question), right);
    if (!right) retries.missed(scope, key, question);
  };

  // Listen reads each new question aloud as it comes up.
  useEffect(() => {
    if (mode === 'listen' && saying) answer.speak(saying.everyday);
    // Once per question, mode and language: `answer` and `saying` change with them.
  }, [mode, key, language]);

  const check = () => {
    if (!saying || verdict || !typedText.trim()) return;
    Keyboard.dismiss();
    const right = checkDigits(typedText, question, language);
    setChecked({ key, right });
    mark(right);
    haptic.answer();
  };

  let actions: ToolActions | undefined;
  if (mode === 'listen') {
    actions = verdict
      ? verdict.right ? { primary: { label: 'Next', onPress: () => next() } } : { secondary: { label: 'Try again', onPress: () => setChecked(null) }, primary: { label: 'Next', onPress: () => next() } }
      : { secondary: { label: 'Randomize', onPress: () => next() }, primary: { label: 'Check', onPress: check, disabled: !typedText.trim() } };
  } else if (answer.missed) {
    actions = nextOnly(() => next());
  }

  const shown = questionText(question, language);
  const name = LANGUAGES[language].name;

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
      {mode === 'say' ? (
        <Card style={{ minHeight: 130, alignItems: 'center', justifyContent: 'center', gap: space.xs }}>
          <Text style={{ ...type.overline, color: c.textSecondary }}>{KIND_LABEL[question.kind]}</Text>
          <Text selectable maxFontSizeMultiplier={1.5} style={{ ...type.largeTitle, fontSize: question.kind === 'phone' ? 32 : 44, fontVariant: ['tabular-nums'], color: c.text, textAlign: 'center' }}>{shown}</Text>
        </Card>
      ) : (
        <ListenCard label={`Play the ${KIND_LABEL[question.kind].toLowerCase()} again`} onPlay={() => saying && answer.speak(saying.everyday)} />
      )}

      {mode === 'say' ? (
        <AnswerCard
          shown={answer.shown}
          prompt={question.kind === 'age' ? `Say you're this age in ${name}, then show the answer.` : `Say the ${KIND_LABEL[question.kind].toLowerCase()} in ${name} out loud, then show the answer.`}
          answer={saying && { everyday: saying.everyday, also: saying.also }}
          rule={answer.missed ? rule : undefined}
          onPlay={answer.speak}
        />
      ) : (
        <DigitsAnswer
          key={key}
          label={`The ${KIND_LABEL[question.kind].toLowerCase()} you heard`}
          typed={typedText}
          onType={(text) => setTyped({ key, text })}
          onSubmit={check}
          checked={verdict}
          shown={shown}
          saying={saying}
          rule={rule}
          onPlay={answer.speak}
        />
      )}

      <ChipChoice label="Practice" options={KINDS} value={kind} onChange={(k) => { setKind(k); next(k); }} />
      <ChipChoice label="Answer by" options={MODES} value={mode} onChange={(m) => { setMode(m); answer.hide(); }} />
    </ToolScreen>
  );
}

/** Listen's question: a large play button, to hear it again. */
function ListenCard({ label, onPlay }: { label: string; onPlay: () => void }) {
  const c = useTheme();
  return (
    <Card style={{ alignItems: 'center', gap: space.s }}>
      <Tappable
        onPress={() => { haptic.tap(); onPlay(); }}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="speaker.wave.2.fill" size={30} color={c.onAccent} />
      </Tappable>
      <Text style={{ ...type.subhead, color: c.textSecondary }}>Play again</Text>
    </Card>
  );
}

/** Listen's answer: the digits typed, then, once checked, whether they were right and how it's said. */
function DigitsAnswer({ label, typed, onType, onSubmit, checked, shown, saying, rule, onPlay }: {
  label: string;
  typed: string;
  onType: (text: string) => void;
  onSubmit: () => void;
  checked: { right: boolean } | null;
  /** The number as written, to show with a miss. */
  shown: string;
  saying: { everyday: Phrase; also: Phrase[] } | undefined;
  rule: string | undefined;
  onPlay: (p: Phrase) => void;
}) {
  const c = useTheme();
  const input = useRef<TextInputInstance>(null);
  // Focused when the question comes up and again after Try again, so the keyboard is already there.
  useEffect(() => { if (!checked) input.current?.focus(); }, [checked]);
  return (
    <View style={{ gap: space.m }}>
      <Field
        ref={input}
        label={label}
        placeholder="Type the digits"
        value={typed}
        onChangeText={onType}
        editable={!checked}
        onSubmitEditing={onSubmit}
        keyboardType="number-pad"
        returnKeyType="done"
        error={!!checked && !checked.right}
      />
      {checked && saying ? (
        <Reveal>
          <Card>
            {checked.right ? <Status tone="good">Right.</Status> : <Status tone="bad">{`Not quite. It's ${shown}.`}</Status>}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
              <View style={{ flex: 1, gap: space.xs }}>
                <Text selectable style={{ ...type.cardBack, color: c.text }}>{saying.everyday.text}</Text>
                {saying.everyday.roman ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{saying.everyday.roman}</Text> : null}
              </View>
              <PlayButton label="Play the answer" onPress={() => onPlay(saying.everyday)} />
            </View>
            {!checked.right && rule ? <RuleLine rule={rule} /> : null}
            {saying.also.length ? <Ways title="Also said" phrases={saying.also} onPlay={onPlay} /> : null}
          </Card>
        </Reveal>
      ) : (
        <Text style={{ ...type.footnote, color: c.textSecondary, paddingHorizontal: space.xs }}>Spaces and dashes don't matter.</Text>
      )}
    </View>
  );
}
