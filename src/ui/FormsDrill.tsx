import * as Speech from 'expo-speech';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { againPrompts, checkAnswer, drillPrompts, formGiven, promptKeys, type DrillRequest, type FormPrompt, type PracticeRecord, type Verdict } from '../core/forms';
import { failureText } from '../core/failure';
import type { Repo } from '../db/repo';
import type { Api } from '../reader/api';
import { practicingPoints } from '../reader/grammar';
import { haptic } from './haptics';
import { Button, Card, Field, HeaderAction, Help, Icon, Loading, Screen, Segments, Tappable } from './kit';
import { Reveal } from './motion';
import { ProgressBar } from './Review';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from './theme';
import { useKeyboardScroll } from './useKeyboardScroll';
import { usePhoneSpeech } from './usePhoneSpeech';

export type AnswerMode = 'pick' | 'type';

interface Answered {
  prompt: FormPrompt;
  given: string;
  verdict: Verdict;
  /** The rows it was logged as, one for each form the prompt stands for, which counting an "almost" marks right. */
  records: PracticeRecord[];
  /** "Almost" that the user chose to count. */
  counted: boolean;
}

const isRight = (a: Answered) => a.verdict === 'right' || a.counted;

/**
 * Practicing forms: the prompts `request` asks for (`drillPrompts`), one at a time, then how it
 * went. Each answer is written as it's given (`addPractice`), before the drill moves on. Nothing
 * here touches a card's schedule or the Anki collection. Grammar practiced in Read & Listen
 * (`readerApi`, null while it's off) is asked first, and each answer names its grammar point.
 */
export function FormsDrill({ repo, readerApi, request, onDone, onOpenGrammar }: {
  repo: Repo;
  readerApi: Api | null;
  request: DrillRequest;
  onDone: () => void;
  /** Opens a grammar point's page; missing while Read & Listen is off, since the page needs it. */
  onOpenGrammar?: (id: string) => void;
}) {
  // The keyboard's height pads the whole screen, not just the list, so Check and Next in the footer stay above it.
  const { scrollProps, bottomPadding: keyboard } = useKeyboardScroll();
  const insets = useSafeAreaInsets();
  const c = useTheme();
  const [prompts, setPrompts] = useState<FormPrompt[] | null>(null);
  const [notice, setNotice] = useState<string>();
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState<Answered[]>([]);
  const [typed, setTyped] = useState('');
  const [topHeight, setTopHeight] = useState(0);
  // "In a sentence" is always typed; otherwise the last choice made, on any drill.
  const typeOnly = request.kind === 'pattern' && request.sentence;
  const [mode, setMode] = useState<AnswerMode>('pick');
  // Set while an answer is being written: a second tap must not answer the same prompt twice.
  const busy = useRef(false);
  const answeredIndex = useRef(-1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);
  const speech = usePhoneSpeech(repo);
  useEffect(() => () => { Speech.stop(); }, []);

  useEffect(() => {
    setLoadError(null);
    (async () => {
      const [notes, cards, practice, saved, practicing, { dayStartsAtHour }] = await Promise.all([
        repo.listNotes(), repo.listCards(), repo.listPractice(), repo.formsAnswerMode(), practicingPoints(readerApi), repo.collectionSettings(),
      ]);
      const built = drillPrompts(request, { notes, cards, practice, dayStartsAtHour, practicing });
      setMode(typeOnly ? 'type' : saved);
      setNotice(built.notice);
      setPrompts(built.prompts);
    })().catch((e) => setLoadError(failureText(e, { what: "Couldn't load the forms to practice.", next: 'Try again.' })));
  }, [repo, loads]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!prompts) return <Screen title="Practice forms" largeTitle={false}><Loading error={loadError} onRetry={() => setLoads((n) => n + 1)} /></Screen>;

  const done = index >= prompts.length;
  const prompt = prompts[index];
  const current = answered.length > index ? answered[index] : undefined;
  const picking = mode === 'pick' && !!prompt?.choices;

  // The rows already written for the prompt on screen: a save that fails partway, then answered
  // again, writes only the forms it hadn't reached, rather than the first ones twice.
  const written = useRef<{ prompt?: FormPrompt; rows: Map<string, PracticeRecord> }>({ rows: new Map() });

  // Under every form the prompt stands for (`promptKeys`), so each keeps its own history.
  const log = async (p: FormPrompt, correct: boolean, given: string) => {
    if (written.current.prompt !== p) written.current = { prompt: p, rows: new Map() };
    const { rows } = written.current;
    const practicedAt = new Date().toISOString();
    for (const key of promptKeys(p)) {
      if (rows.has(key)) continue;
      const record: PracticeRecord = { noteId: p.noteId, key, correct, practicedAt, given };
      await repo.addPractice(record);
      rows.set(key, record);
    }
    return [...rows.values()];
  };

  const answer = async (given: string, picked = false) => {
    if (!prompt || current || busy.current || answeredIndex.current === index) return;
    busy.current = true;
    try {
      // A pick is the form or it isn't: a choice one accent away is another form, not a typo.
      const verdict: Verdict = picked ? (prompt.answers.includes(given) ? 'right' : 'wrong') : checkAnswer(given, prompt.answers, prompt.otherForms?.map((o) => o.text));
      const records = await log(prompt, verdict === 'right', given);
      if (verdict === 'right') haptic.success(); else haptic.select();
      setAnswered((a) => [...a, { prompt, given, verdict, records, counted: false }]);
      // The right form, heard once after a miss; nothing when the note's language isn't known.
      if (verdict !== 'right' && prompt.say) { Speech.stop(); speech.sayWord(prompt.say.text, prompt.say.lang); }
      // `busy` clears before the answer is drawn: a tap in between mustn't log this prompt again.
      answeredIndex.current = index;
    } catch (e) {
      Alert.alert("Couldn't save this answer", failureText(e, { next: 'Answer it again.' }));
    } finally {
      busy.current = false;
    }
  };

  /** "Almost" counted as right: its row is marked right, so no miss is left to ask it again or show in the history. */
  const countIt = async () => {
    if (!current || current.verdict !== 'almost' || current.counted || busy.current) return;
    busy.current = true;
    try {
      for (const record of current.records) await repo.countPractice(record);
      haptic.success();
      setAnswered((a) => a.map((x, i) => (i === index ? { ...x, counted: true } : x)));
    } catch (e) {
      Alert.alert("Couldn't count it as right", failureText(e, { next: 'Try again.' }));
    } finally {
      busy.current = false;
    }
  };

  // Only from the prompt on screen, once it's answered: a double tap mustn't skip the next one, which
  // left the drill on an index with no answer to show and no way to answer it.
  const next = () => {
    if (!current) return;
    setTyped('');
    setIndex((i) => (i === index ? i + 1 : i));
  };

  const switchMode = (m: AnswerMode) => { setMode(m); repo.saveFormsAnswerMode(m); };

  const missed = answered.filter((a) => !isRight(a));
  // Its choices reshuffled: the summary just showed every answer, so the same places would give them away.
  const again = () => {
    setPrompts(againPrompts(missed.map((a) => a.prompt)));
    setAnswered([]);
    setIndex(0);
    answeredIndex.current = -1;
    setTyped('');
  };

  if (!prompts.length) {
    return (
      <Screen title="Practice forms" largeTitle={false} footer={<Button label="Done" onPress={onDone} />}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l, gap: space.m }}>
          <Text style={{ ...type.headline, color: c.text }}>Nothing to practice</Text>
          <Help>None of these words list forms that can be asked here. Forms come from each note's Forms field, one per line, like "present · yo: espero".</Help>
          {notice ? <Help>{notice}</Help> : null}
        </ScrollView>
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen
        title={`${answered.filter(isRight).length} of ${answered.length} right`}
        footer={
          <>
            {missed.length ? <Button label={missed.length === 1 ? 'Practice the missed one again' : 'Practice the missed ones again'} variant="secondary" onPress={again} /> : null}
            <Button label="Done" onPress={onDone} />
          </>
        }
      >
        <Summary answered={answered} notice={notice} />
      </Screen>
    );
  }

  const footer = current ? (
    <Button label={index === prompts.length - 1 ? 'See how it went' : 'Next'} onPress={next} />
  ) : !picking ? (
    <Button label="Check" onPress={() => answer(typed)} disabled={!typed.trim()} />
  ) : undefined;

  return (
    <View style={{ flex: 1, paddingBottom: Math.max(0, keyboard - insets.bottom) }}>
    <Screen title={`${index + 1} of ${prompts.length}`} largeTitle={false} footer={footer}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.l, gap: space.xl, flexGrow: 1, width: '100%', maxWidth: 640, alignSelf: 'center' }}
        keyboardShouldPersistTaps="handled"
        {...scrollProps}
      >
        <View style={{ gap: space.xl }} onLayout={(e) => setTopHeight(e.nativeEvent.layout.height + space.xl)}>
          <ProgressBar value={index / prompts.length} label="Progress through this practice" style={{ marginHorizontal: 0, marginTop: 0 }} />
          {typeOnly ? null : (
            <Segments<AnswerMode>
              options={[{ value: 'pick', label: 'Pick' }, { value: 'type', label: 'Type' }]}
              value={mode}
              onChange={switchMode}
            />
          )}
        </View>
        {/* Padded at the bottom by the height of the controls above, so the question sits in the middle of the screen rather than of what's left under them. */}
        <View style={{ flex: 1, justifyContent: 'center', gap: space.xl, paddingBottom: topHeight }}>
          <Reveal key={index} rise={10}>
            <Question prompt={prompt} reveal={current ? prompt.answers[0] : undefined} />
          </Reveal>
          {picking ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {prompt.choices!.map((choice) => (
                <ChoiceButton key={choice} label={choice} state={choiceState(choice, prompt, current)} onPress={() => answer(choice, true)} />
              ))}
            </View>
          ) : (
            <Field
              key={index}
              label="Your answer"
              value={current ? current.given : typed}
              onChangeText={setTyped}
              editable={!current}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => { if (typed.trim()) answer(typed); }}
              error={!!current && !isRight(current)}
            />
          )}
          {mode === 'pick' && !prompt.choices ? <Help>This one is typed: there are no other forms to pick from.</Help> : null}
          {current ? <Reveal rise={6}><Feedback answered={current} onCount={countIt} onOpenGrammar={onOpenGrammar} /></Reveal> : null}
        </View>
      </ScrollView>
    </Screen>
    </View>
  );
}

/** The word (the focus), what's asked about it (small, as context), and the example sentence with a gap where the answer goes. */
function Question({ prompt, reveal }: { prompt: FormPrompt; reveal?: string }) {
  const c = useTheme();
  const asked = [prompt.group, prompt.label].filter(Boolean).join(' · ');
  return (
    <View style={{ alignItems: 'center', gap: space.s }}>
      <Text style={{ ...type.cardFront, color: c.text, textAlign: 'center' }}>{prompt.headword}</Text>
      {prompt.meaning ? <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>{prompt.meaning}</Text> : null}
      <View style={{ paddingHorizontal: space.m, paddingVertical: space.xs, borderRadius: radius.pill, backgroundColor: c.fill }}>
        <Text style={{ ...type.subhead, color: c.textSecondary }}>{asked}</Text>
      </View>
      {prompt.sentence ? (
        <View style={{ alignItems: 'center', gap: space.xs, marginTop: space.s }}>
          <Text
            // VoiceOver reads the underscores of the gap badly: it says "blank" until the answer fills it.
            accessibilityLabel={reveal ? undefined : `${prompt.sentence.before} blank ${prompt.sentence.after}`}
            style={{ ...type.title, fontWeight: '600', color: c.text, textAlign: 'center' }}
          >
            {prompt.sentence.before}
            <Text style={{ color: c.accent, textDecorationLine: 'underline' }}>{reveal ?? '_____'}</Text>
            {prompt.sentence.after}
          </Text>
          {prompt.sentence.translation ? (
            <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>{prompt.sentence.translation}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** A choice before answering, the answer, the wrong one picked, or another. Also the grammar drill's (tools/GrammarDrill.tsx). */
export type ChoiceState = 'open' | 'right' | 'wrongPick' | 'other';

function choiceState(choice: string, prompt: FormPrompt, current?: Answered): ChoiceState {
  if (!current) return 'open';
  if (choice === prompt.answers[0]) return 'right';
  return choice === current.given ? 'wrongPick' : 'other';
}

export function ChoiceButton({ label, state, onPress }: { label: string; state: ChoiceState; onPress: () => void }) {
  const c = useTheme();
  const border = state === 'right' ? c.good : state === 'wrongPick' ? c.danger : c.border;
  return (
    <Tappable
      onPress={onPress}
      disabled={state !== 'open'}
      accessibilityRole="button"
      accessibilityLabel={state === 'right' ? `${label}, the answer` : state === 'wrongPick' ? `${label}, not it` : label}
      restOpacity={state === 'other' ? 0.6 : 1}
      style={{
        flexBasis: '48%', flexGrow: 1, minHeight: 64, paddingHorizontal: space.m, paddingVertical: space.m,
        flexDirection: 'row', gap: space.s, alignItems: 'center', justifyContent: 'center', borderRadius: radius.m, ...smooth,
        borderWidth: state === 'open' || state === 'other' ? hairline : 2, borderColor: border, backgroundColor: c.surface,
      }}
    >
      {state === 'right' ? <Icon name="checkmark" size={18} color={c.good} weight="bold" /> : null}
      <Text style={{ ...type.title, fontWeight: state === 'right' ? '700' : '400', color: c.text, textAlign: 'center' }}>{label}</Text>
    </Tappable>
  );
}

function Feedback({ answered, onCount, onOpenGrammar }: { answered: Answered; onCount: () => void; onOpenGrammar?: (id: string) => void }) {
  const c = useTheme();
  const answer = answered.prompt.answers[0];
  // Which of the word's forms a wrong answer was, so the contrast being drilled is named.
  const given = answered.verdict === 'wrong' ? formGiven(answered.given, answered.prompt) : undefined;
  if (answered.verdict === 'right') {
    return (
      <Card style={{ gap: space.xs }}>
        <Text style={{ ...type.headline, color: c.countDue }}>Right</Text>
        <GrammarLine grammar={answered.prompt.grammar} onOpen={onOpenGrammar} />
      </Card>
    );
  }
  if (answered.verdict === 'almost') {
    return (
      <Card style={{ gap: space.xs }}>
        <Text style={{ ...type.headline, color: c.warning }}>{answered.counted ? `Counted as right: ${answer}` : `Almost: ${answer}`}</Text>
        <Help>Only an accent or a mark differs, and that can make it a different form.</Help>
        {answered.counted ? null : (
          <Tappable onPress={onCount} accessibilityRole="button" style={{ minHeight: MIN_TAP, justifyContent: 'center', alignSelf: 'flex-start' }}>
            <Text style={{ ...type.subhead, fontWeight: '600', color: c.accent }}>Count it as right</Text>
          </Tappable>
        )}
        <GrammarLine grammar={answered.prompt.grammar} onOpen={onOpenGrammar} />
      </Card>
    );
  }
  return (
    <Card style={{ gap: space.xs }}>
      <Text style={{ ...type.headline, color: c.danger }}>{`Not quite: ${answer}`}</Text>
      {given ? <Help>{`${answered.given.trim()} is ${given}.`}</Help> : null}
      {answered.prompt.answers.length > 1 ? <Help>{`Also right: ${answered.prompt.answers.slice(1).join(', ')}`}</Help> : null}
      <GrammarLine grammar={answered.prompt.grammar} onOpen={onOpenGrammar} />
    </Card>
  );
}

/** The grammar point the form is (docs/grammar.md), under a rule at the foot of the result. Shown only once answered, as its examples can give a form away. */
function GrammarLine({ grammar, onOpen }: { grammar?: FormPrompt['grammar']; onOpen?: (id: string) => void }) {
  const c = useTheme();
  if (!grammar) return null;
  return (
    <View style={{ borderTopWidth: hairline, borderTopColor: c.border, paddingTop: space.s, marginTop: space.xs, gap: space.xs }}>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>
        <Text style={{ fontWeight: '600', color: c.text }}>{`${grammar.name}.`}</Text>
        {` ${grammar.note}.`}
      </Text>
      {onOpen ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <HeaderAction label={`More about ${grammar.name}`} onPress={() => onOpen(grammar.id)} />
        </View>
      ) : null}
    </View>
  );
}

function Summary({ answered, notice }: { answered: Answered[]; notice?: string }) {
  const c = useTheme();
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
      <Card style={{ gap: 0, paddingVertical: space.xs }}>
        {answered.map((a, i) => (
          <View
            key={i}
            accessible
            accessibilityLabel={`${[a.prompt.headword, a.prompt.label, a.prompt.group].filter(Boolean).join(', ')}: ${a.prompt.answers[0]}. ${isRight(a) ? 'Right' : `Wrong, you answered “${a.given}”`}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 52, paddingVertical: space.s, borderTopWidth: i ? hairline : 0, borderTopColor: c.border }}
          >
            <Text style={{ ...type.subhead, color: c.textSecondary, width: 130 }}>
              {[a.prompt.headword, a.prompt.label, a.prompt.group].filter(Boolean).join(' · ')}
            </Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...type.headline, color: c.text }}>{a.prompt.answers[0]}</Text>
              {a.verdict === 'almost' && a.counted ? <Text style={{ ...type.footnote, color: c.warning }}>Accent missed, counted as right</Text> : null}
              {!isRight(a) ? <Text style={{ ...type.footnote, color: c.danger }}>{`You answered “${a.given}”`}</Text> : null}
            </View>
            <Icon name={isRight(a) ? 'checkmark' : 'xmark'} size={18} color={isRight(a) ? c.countDue : c.danger} weight="bold" />
          </View>
        ))}
      </Card>
      <Help>Practice doesn't change when any card is next due.</Help>
      {notice ? <Help>{notice}</Help> : null}
    </ScrollView>
  );
}
