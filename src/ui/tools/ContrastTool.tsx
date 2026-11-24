import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import { headword } from '../../core/forms';
import { LANGUAGES } from '../../reader/languages';
import type { Language } from '../../reader/api';
import { contrastKey, contrastSetsFor, contrastTitle, nextContrast, setsKnown, showSentence, type ContrastQuestion, type ContrastSet } from '../../tools/contrasts';
import { haptic } from '../haptics';
import { Button, Card, Chip, ErrorNote, Help, Loading } from '../kit';
import type { CardMotion } from '../SwipeCard';
import { space, type, useTheme } from '../theme';
import type { ToolScreenProps } from './index';
import { ContrastChoices, ContrastSentenceView, ContrastVerdict } from './ContrastParts';
import { PracticeCard } from './PracticeCard';
import { ToolScreen, useAnswer, useToolLanguage } from './ToolScreen';
import { useRetries } from './useRetries';

/** How many keys back a sentence isn't asked again while there are others. */
const RECENT = 20;

/**
 * Which word fits (src/tools/contrasts.ts) on the Practice tab: a sentence with a gap from the sets
 * whose words are all studied, the set's words to pick from, and the sentence filled in with the rule
 * once one is picked. Chips above the card pick one set or all of them. A miss comes back a few
 * questions later (useRetries). Nothing here grades a card: the skill cards in Review are where a set
 * is scheduled (src/tools/skills.ts).
 */
export function ContrastTool({ tool, repo }: ToolScreenProps) {
  const c = useTheme();
  const [language, setLanguage] = useToolLanguage(tool);
  const [sets, setSets] = useState<ContrastSet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    setSets(null);
    (async () => {
      const [notes, cards] = await Promise.all([repo.listNotes(), repo.listCards()]);
      // Studied: a card of the note has been answered, wherever (its state is past new), as Similar words counts it.
      const studied = new Set(cards.filter((card) => card.sched.state !== 0 && !card.retired).map((card) => card.noteId));
      const words = notes.filter((n) => studied.has(n.id)).map(headword);
      if (live) setSets(setsKnown(contrastSetsFor(language), words));
    })().catch((e) => { if (live) setError(failureText(e, { what: "Couldn't read your decks.", next: 'Try again.' })); });
    return () => { live = false; };
  }, [repo, language, loads]);

  const [only, setOnly] = useState<string | undefined>(undefined);
  const scope = `${language}|${only ?? 'all'}`;
  const retries = useRetries<ContrastQuestion | undefined>();
  const recent = useRef<string[]>([]);
  const [question, setQuestion] = useState<ContrastQuestion | undefined>();
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const [tally, setTally] = useState({ right: 0, missed: 0 });
  const speech = useAnswer(repo, language);

  const ask = (from: ContrastSet[], current: ContrastQuestion | undefined) => {
    const draw = () => nextContrast(from, only, recent.current, Math.random);
    const q = retries.next(scope, current && contrastKey(current), draw) ?? draw();
    if (q) recent.current = [...recent.current, contrastKey(q)].slice(-RECENT);
    setQuestion(q);
    setPicked(undefined);
  };
  // A new question whenever the sets load or the set chosen changes.
  useEffect(() => {
    if (only && sets && !sets.some((s) => s.id === only)) { setOnly(undefined); return; }
    if (sets) ask(sets, undefined);
  }, [sets, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = question && sets?.find((s) => s.id === question.setId);
  const shown = set && question ? showSentence(set, question.index, language) : undefined;
  const answer = set && question ? set.sentences[question.index].answer : 0;

  const pick = (i: number) => {
    if (!question || picked !== undefined || !shown) return;
    setPicked(i);
    const right = i === answer;
    if (right) haptic.success();
    else {
      haptic.answer();
      retries.missed(scope, contrastKey(question), question);
    }
    setTally((t) => (right ? { ...t, right: t.right + 1 } : { ...t, missed: t.missed + 1 }));
    speech.speak({ text: shown.filled });
  };
  const next = () => { if (sets) ask(sets, question); };
  const motion = useRef<CardMotion | null>(null);
  const answered = picked !== undefined;
  const chips = useMemo(() => [{ id: undefined as string | undefined, label: 'All sets' }, ...(sets ?? []).map((s) => ({ id: s.id as string | undefined, label: contrastTitle(s) }))], [sets]);

  const footer = set && question ? (
    <View style={{ gap: space.s }}>
      <ContrastChoices key={contrastKey(question)} set={set} language={language} answer={answer} picked={picked} onPick={pick} />
      {answered ? <Button label="Next" onPress={() => { haptic.select(); next(); }} /> : null}
    </View>
  ) : <View />;

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={(l: Language) => { setOnly(undefined); setLanguage(l); }}
      shown={false}
      onRandomize={next}
      onShow={() => {}}
      onMark={() => next()}
      fill
      footer={footer}
    >
      {error ? <View style={{ padding: space.l }}><ErrorNote message={error} onRetry={() => setLoads((n) => n + 1)} /></View> : !sets ? <View style={{ flex: 1, padding: space.l }}><Loading /></View> : !sets.length ? (
        <View style={{ padding: space.l }}>
          <Card>
            <Help>{`A set comes up here once you've studied all of its words. None of the ${LANGUAGES[language].name} sets are ready yet: ${contrastSetsFor(language).map(contrastTitle).join(', ')}.`}</Help>
          </Card>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: space.s, paddingHorizontal: space.l, paddingVertical: space.s }}>
            {chips.map((ch) => <Chip key={ch.id ?? 'all'} label={ch.label} selected={ch.id === only} onPress={() => { if (ch.id !== only) { haptic.select(); setOnly(ch.id); } }} />)}
          </ScrollView>
          {shown && question ? (
            <PracticeCard
              questionKey={`${contrastKey(question)}|${scope}`}
              cardKey={`${contrastKey(question)}|${scope}|${String(picked)}`}
              swipe={false}
              motion={motion}
              onMark={() => {}}
              front={(
                <View style={{ gap: space.l, alignItems: 'center' }}>
                  {tally.right + tally.missed ? <Text style={{ ...type.footnote, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{`${tally.right} right · ${tally.missed} missed`}</Text> : null}
                  <ContrastSentenceView
                    key={contrastKey(question)}
                    shown={shown}
                    answered={answered}
                    verdict={answered ? <ContrastVerdict right={picked === answer} answer={shown.answer.word} /> : undefined}
                  />
                </View>
              )}
            />
          ) : null}
        </View>
      )}
    </ToolScreen>
  );
}
