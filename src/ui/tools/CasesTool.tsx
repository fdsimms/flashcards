import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import type { Note } from '../../core/types';
import { LANGUAGES } from '../../reader/languages';
import {
  CASE_LANGUAGES, caseName, caseNouns, casePatterns, caseRows, caseRule, checkCaseForm, drawGovernor, governorId,
  governorNote, inDeck, languageDeck, nounFor, type CaseNoun, type GovernedCase, type Governor,
} from '../../tools/cases';
import { useApp } from '../AppContext';
import { haptic } from '../haptics';
import { Button, ErrorNote, Field, Help, Loading, NavRow, Group, Tappable } from '../kit';
import type { CardMotion } from '../SwipeCard';
import { hairline, radius, smooth, space, type, useTheme } from '../theme';
import type { ToolScreenProps } from './index';
import { PracticeCard } from './PracticeCard';
import { RuleLine, Status, ToolScreen, useAnswer, useToolLanguage } from './ToolScreen';
import { useMarks } from './useMarks';

type Step = 'case' | 'form' | 'done';

interface Question {
  governor: Governor;
  /** The noun step 2 puts in the case, or none when no studied noun has that case listed. */
  noun?: CaseNoun;
}

/**
 * Which case (src/tools/cases.ts), as Review's card (PracticeCard.tsx): the case after a preposition or
 * verb, picked from the language's cases (footer buttons, each with a cue), then a studied noun typed in it
 * under the word, in the card. A word missing from the deck is offered to
 * the note editor, where saving is the approval. Nothing here grades a card.
 */
export function CasesTool({ tool, repo }: ToolScreenProps) {
  const c = useTheme();
  const { openNoteEditor } = useApp();
  const [language, setLanguage] = useToolLanguage(tool);
  const cases = CASE_LANGUAGES[language];
  const marks = useMarks('cases', language);
  const answer = useAnswer(repo, language);

  const [deck, setDeck] = useState<{ notes: Note[]; studied: Set<string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    (async () => {
      const [notes, cards] = await Promise.all([repo.listNotes(), repo.listCards()]);
      const studied = new Set(cards.filter((card) => card.sched.state !== 0 && !card.retired).map((card) => card.noteId));
      if (live) setDeck({ notes, studied });
    })().catch((e) => { if (live) setError(failureText(e, { what: "Couldn't read your decks.", next: 'Try again.' })); });
    return () => { live = false; };
  }, [repo, loads]);
  const nouns = useMemo(() => (deck ? caseNouns(deck.notes, deck.studied, language) : []), [deck, language]);

  const [question, setQuestion] = useState<Question | undefined>();
  const [step, setStep] = useState<Step>('case');
  const [picked, setPicked] = useState<GovernedCase | null | undefined>(undefined);
  const [typed, setTyped] = useState('');
  const [verdict, setVerdict] = useState<ReturnType<typeof checkCaseForm> | undefined>();
  const previous = useRef<string | undefined>(undefined);

  const ask = () => {
    if (!cases) return;
    const governor = marks.pick(() => drawGovernor(cases, previous.current), casePatterns, governorId);
    previous.current = governorId(governor);
    answer.hide();
    setQuestion({ governor, noun: nounFor(governor, nouns) });
    setStep('case');
    setPicked(undefined);
    setTyped('');
    setVerdict(undefined);
  };
  // A new question once the deck is read, and whenever the language changes.
  useEffect(() => { if (deck) ask(); }, [deck, language]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickCase = (choice: GovernedCase | null) => {
    if (!question || step !== 'case') return;
    const right = choice === question.governor.case;
    if (right) haptic.success(); else haptic.answer();
    marks.mark(casePatterns(question.governor), right);
    setPicked(choice);
    setStep(question.noun ? 'form' : 'done');
    if (!question.noun) answer.speak({ text: question.governor.word });
  };
  const check = () => {
    const noun = question?.noun;
    if (!question || !noun || step !== 'form' || !typed.trim()) return;
    const v = checkCaseForm(typed, question.governor, noun);
    if (v === 'right') haptic.success(); else haptic.answer();
    marks.mark([`form:${question.governor.case}`], v === 'right');
    setVerdict(v);
    setStep('done');
    answer.speak({ text: `${question.governor.word} ${noun.forms[question.governor.case]![0]}` });
  };
  const skip = () => { setStep('done'); };

  const g = question?.governor;
  const noun = question?.noun;
  const form = g && noun ? noun.forms[g.case]![0] : undefined;
  const missing = g && deck && !inDeck(g, deck.notes, language);
  const target = deck ? languageDeck(deck.notes, language) : undefined;
  const addToDeck = () => {
    if (!g || !cases) return;
    const { fields, tags } = governorNote(cases, g, LANGUAGES[language].name.toLowerCase());
    // Saving in the editor is the approval; the deck is read again after, so the row goes away.
    openNoteEditor({ deck: target ?? null, model: 'Omnilanguage', fields, tags }, (result) => { if (result) setLoads((n) => n + 1); });
  };

  const motion = useRef<CardMotion | null>(null);
  const ready = !error && !!deck && !!g && !!cases;

  let front: React.ReactNode;
  let back: React.ReactNode;
  let footer: React.ReactNode = <View />;
  if (ready) {
    front = (
      <View style={{ alignItems: 'center', gap: space.xs }}>
        <Text style={{ ...type.overline, color: c.textSecondary }}>{g.kind === 'verb' ? 'Verb' : g.kind === 'phrase' ? 'Phrase' : 'Preposition'}</Text>
        <Text selectable accessibilityLanguage={LANGUAGES[language].speech} maxFontSizeMultiplier={1.5} style={{ ...type.cardFront, fontSize: 44, color: c.text, textAlign: 'center' }}>{g.word}</Text>
        <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>{g.sense ? `${g.meaning} (${g.sense})` : g.meaning}</Text>
        {step === 'case' ? <Text style={{ ...type.body, color: c.text, marginTop: space.s }}>Which case comes after it?</Text> : null}
      </View>
    );
    back = step === 'case' ? undefined : (
      <View style={{ gap: space.m }}>
        <View style={{ alignItems: 'center' }}>
          {picked === g.case
            ? <Status tone="good">{`${caseName(g.case)}.`}</Status>
            : <Status tone="bad">{`${picked ? 'Incorrect. ' : ''}It's the ${g.case}.`}</Status>}
        </View>
        {noun ? (
          <View style={{ gap: space.s }}>
            <View style={{ alignItems: 'center', gap: 2 }}>
              <Text accessibilityLanguage={LANGUAGES[language].speech} style={{ ...type.title, fontWeight: '600', color: c.text }}>
                {`${g.word} `}
                {step === 'done' ? <Text style={{ color: c.accent }}>{form}</Text> : <Text style={{ color: c.accent }}>_____</Text>}
              </Text>
              <Text style={{ ...type.subhead, color: c.textSecondary }}><Text accessibilityLanguage={LANGUAGES[language].speech} >{noun.headword}</Text>{` · ${noun.meaning}`}</Text>
            </View>
            <Field
              key={governorId(g)}
              label="Your answer"
              value={typed}
              onChangeText={setTyped}
              editable={step === 'form'}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              autoFocus
              returnKeyType="done"
              keyboardLanguage={LANGUAGES[language].speech}
              onSubmitEditing={check}
              error={step === 'done' && verdict !== undefined && verdict !== 'right'}
            />
            {step === 'done' && verdict ? (
              <View style={{ alignItems: 'center' }}>
                {verdict === 'right'
                  ? <Status tone="good">Right.</Status>
                  : <Status tone="bad">{`${verdict === 'almost' ? 'Almost' : 'Not quite'}. It's ${form}.`}</Status>}
              </View>
            ) : null}
          </View>
        ) : null}
        {step === 'done' ? (
          <View style={{ gap: space.s }}>
            <RuleLine rule={caseRule(cases, g)} />
            {!noun ? (
              <Help>{`None of your ${LANGUAGES[language].name} nouns have their ${g.case} filled in yet. Add it to a noun's Forms field to practice it here.`}</Help>
            ) : null}
          </View>
        ) : null}
        {step === 'done' && missing ? (
          <Group>
            <NavRow
              first
              label={`Add ${g.entry ?? g.word} to your deck`}
              detail={target ? `It isn't in ${target.split('::').pop()} yet.` : `You have no ${LANGUAGES[language].name} deck yet: pick one in the editor.`}
              onPress={addToDeck}
            />
          </Group>
        ) : null}
      </View>
    );
    footer = step === 'case' ? (
      <View style={{ gap: space.s }}>
        <CaseChoices cases={cases.cases} onChoose={pickCase} />
        <Button variant="secondary" label="I don't know" onPress={() => pickCase(null)} />
      </View>
    ) : step === 'form' ? (
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button variant="secondary" label="Skip" style={{ flex: 1 }} onPress={skip} />
        <Button label="Check" style={{ flex: 1 }} onPress={check} disabled={!typed.trim()} />
      </View>
    ) : <Button label="Next" onPress={ask} />;
  }

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={setLanguage}
      shown={false}
      onRandomize={ask}
      onShow={() => pickCase(null)}
      onMark={() => ask()}
      fill
      footer={footer}
    >
      {error ? <View style={{ padding: space.l }}><ErrorNote message={error} onRetry={() => setLoads((n) => n + 1)} /></View> : !ready ? <View style={{ flex: 1, padding: space.l }}><Loading /></View> : (
        <PracticeCard
          questionKey={governorId(g)}
          cardKey={`${governorId(g)}|${step}`}
          swipe={false}
          motion={motion}
          onMark={() => {}}
          onPlay={step === 'done' ? () => answer.speak({ text: form ? `${g.word} ${form}` : g.word }) : undefined}
          speech={LANGUAGES[language].speech}
          front={front}
          back={back}
        />
      )}
    </ToolScreen>
  );
}

/** The language's cases to choose from: each a name over a short cue, in rows of at most three. */
function CaseChoices({ cases, onChoose }: { cases: GovernedCase[]; onChoose: (k: GovernedCase) => void }) {
  const c = useTheme();
  let from = 0;
  return (
    <View style={{ gap: space.s }}>
      {caseRows(cases.length).map((n, r) => {
        const row = cases.slice(from, from + n);
        from += n;
        return (
          <View key={r} style={{ flexDirection: 'row', gap: space.s }}>
            {row.map((k) => (
              <Tappable
                key={k}
                onPress={() => onChoose(k)}
                accessibilityRole="button"
                accessibilityLabel={caseName(k)}
                scaleTo={0.97}
                style={{
                  flex: 1, minHeight: 60, alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingHorizontal: space.xs, paddingVertical: space.xs + 2,
                  backgroundColor: c.surface, borderRadius: radius.m + 2, ...smooth, borderWidth: hairline, borderColor: c.border,
                }}
              >
                <Text maxFontSizeMultiplier={1.3} style={{ ...type.headline, fontSize: 16, color: c.text }}>{caseName(k)}</Text>
              </Tappable>
            ))}
          </View>
        );
      })}
    </View>
  );
}
