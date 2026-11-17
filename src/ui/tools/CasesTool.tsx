import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import type { Note } from '../../core/types';
import { LANGUAGES } from '../../reader/languages';
import {
  CASE_LANGUAGES, caseName, caseNouns, casePatterns, caseRule, checkCaseForm, drawGovernor, governorId, governorLabel,
  governorNote, inDeck, languageDeck, nounFor, type CaseNoun, type GovernedCase, type Governor,
} from '../../tools/cases';
import { useApp } from '../AppContext';
import { ChoiceButton } from '../FormsDrill';
import { haptic } from '../haptics';
import { Card, ErrorNote, Field, Help, Loading, NavRow, Group } from '../kit';
import { Reveal } from '../motion';
import { space, type, useTheme } from '../theme';
import type { ToolScreenProps } from './index';
import { RuleLine, Status, ToolScreen, useAnswer, useToolLanguage, type ToolActions } from './ToolScreen';
import { useMarks } from './useMarks';

type Step = 'case' | 'form' | 'done';

interface Question {
  governor: Governor;
  /** The noun step 2 puts in the case, or none when no studied noun has that case listed. */
  noun?: CaseNoun;
}

/**
 * Which case (src/tools/cases.ts): the case after a preposition or verb, picked from the
 * language's cases, then a studied noun typed in it. A word missing from the deck is offered to
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
    const governor = marks.pick(() => drawGovernor(cases, previous.current), casePatterns);
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

  const actions: ToolActions = step === 'case'
    ? { secondary: { label: 'Another one', onPress: ask }, primary: { label: "I don't know", onPress: () => pickCase(null), disabled: !question } }
    : step === 'form'
      ? { secondary: { label: 'Skip', onPress: skip }, primary: { label: 'Check', onPress: check, disabled: !typed.trim() } }
      : { primary: { label: 'Next', onPress: ask } };

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

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={setLanguage}
      shown={false}
      onRandomize={ask}
      onShow={() => pickCase(null)}
      onMark={() => ask()}
      actions={actions}
    >
      {error ? <ErrorNote message={error} onRetry={() => setLoads((n) => n + 1)} /> : !deck || !g || !cases ? <Loading /> : (
        <>
          <Card style={{ alignItems: 'center', gap: space.s, paddingVertical: space.xl }}>
            <Text style={{ ...type.subhead, color: c.textSecondary }}>{g.kind === 'verb' ? 'Verb' : g.kind === 'phrase' ? 'Phrase' : 'Preposition'}</Text>
            <Text selectable style={{ ...type.cardFront, color: c.text, textAlign: 'center' }}>
              {g.word}
              {step === 'done' && form ? <Text style={{ color: c.accent }}>{` ${form}`}</Text> : null}
            </Text>
            <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>
              {g.sense ? `${g.meaning} (${g.sense})` : g.meaning}
            </Text>
            {step === 'case' ? <Text style={{ ...type.body, color: c.text, marginTop: space.s }}>Which case comes after it?</Text> : null}
          </Card>

          {step === 'case' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {cases.cases.map((k) => <ChoiceButton key={k} label={caseName(k)} state="open" onPress={() => pickCase(k)} />)}
            </View>
          ) : (
            <Reveal style={{ gap: space.s }}>
              {picked === g.case
                ? <Status tone="good">{`${caseName(g.case)}.`}</Status>
                : <Status tone="bad">{`${picked ? 'Not quite. ' : ''}It's the ${g.case}.`}</Status>}
            </Reveal>
          )}

          {step !== 'case' && noun ? (
            <View style={{ gap: space.s }}>
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Text style={{ ...type.title, fontWeight: '600', color: c.text }}>
                  {`${g.word} `}
                  {step === 'done' ? <Text style={{ color: c.accent }}>{form}</Text> : <Text style={{ color: c.accent }}>_____</Text>}
                </Text>
                <Text style={{ ...type.subhead, color: c.textSecondary }}>{`${noun.headword} · ${noun.meaning}`}</Text>
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
                verdict === 'right'
                  ? <Status tone="good">Right.</Status>
                  : <Status tone="bad">{`${verdict === 'almost' ? 'Almost' : 'Not quite'}. It's ${form}.`}</Status>
              ) : null}
            </View>
          ) : null}

          {step === 'done' ? (
            <Card style={{ gap: space.s }}>
              <RuleLine rule={caseRule(cases, g)} />
              {!noun ? (
                <Help>{`None of the ${LANGUAGES[language].name} nouns you're studying list their ${g.case} yet, so there's no noun to put in it. A noun's cases come from its Forms field.`}</Help>
              ) : null}
            </Card>
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
        </>
      )}
    </ToolScreen>
  );
}
