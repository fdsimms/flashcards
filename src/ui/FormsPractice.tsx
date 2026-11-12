import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { DAY_STARTS_AT_HOUR } from '../core/config';
import { isInDeck } from '../core/deckTree';
import {
  headword, PATTERN_PROMPTS, patternOf, patternPrompts, practiceChoices, practicePool, unreadableNotice,
  type FormPrompt, type PracticeRecord, type PracticeWord,
} from '../core/forms';
import type { Repo } from '../db/repo';
import { FormsDrill, type AnswerMode } from './FormsDrill';
import { Button, Card, Chip, Help, Screen } from './kit';
import { space, type, useTheme } from './theme';

type Answering = AnswerMode | 'sentence';

/** How many studied words the screen names before "and N more". */
const NAMED_WORDS = 7;

/**
 * Practicing forms across a deck: one pattern (a VerbClass, or nouns) and some tenses at a time,
 * with words already studied, so the drill is about the endings rather than new words.
 */
export function FormsPractice({ repo, deck, onDone }: { repo: Repo; deck: string; onDone: () => void }) {
  const c = useTheme();
  const [words, setWords] = useState<PracticeWord[] | null>(null);
  const [pool, setPool] = useState<PracticeWord[]>([]);
  const [practice, setPractice] = useState<PracticeRecord[]>([]);
  const [patterns, setPatterns] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [answering, setAnswering] = useState<Answering>('pick');
  const [drill, setDrill] = useState<{ prompts: FormPrompt[]; notice?: string } | null>(null);

  useEffect(() => {
    (async () => {
      const [notes, cards, logged, mode] = await Promise.all([repo.listNotes(), repo.listCards(deck), repo.listPractice(), repo.formsAnswerMode()]);
      // Studied: a card of the note has been answered at least once.
      const studied = new Set(cards.filter((c) => c.sched.state !== 0).map((c) => c.noteId));
      const all = practicePool(notes);
      const mine = all.filter((w) => isInDeck(w.note.deck, deck) && studied.has(w.note.id));
      setPool(all);
      setPractice(logged);
      setWords(mine);
      setAnswering(mode);
      const choices = practiceChoices(mine);
      setPatterns(choices.patterns.slice(0, 1));
      setGroups(choices.groups.slice(0, 1));
    })();
  }, [repo, deck]);

  const choices = useMemo(() => practiceChoices(words ?? []), [words]);
  const chosen = useMemo(
    () => (words ?? []).filter((w) => patterns.includes(patternOf(w.note)) && w.forms.some((f) => groups.includes(f.group))),
    [words, patterns, groups],
  );

  const toggle = (list: string[], set: (l: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  /** Prompts for the choices made. "In a sentence" keeps only forms its words' example sentences hold. */
  const promptsNow = (limit: number) => {
    const sentence = answering === 'sentence';
    const all = patternPrompts(chosen, { patterns, groups }, practice, sentence ? Number.POSITIVE_INFINITY : limit, DAY_STARTS_AT_HOUR, Math.random, pool);
    return sentence ? all.filter((p) => p.sentence).slice(0, limit) : all;
  };

  const start = () => {
    const prompts = promptsNow(PATTERN_PROMPTS);
    if (prompts.length) setDrill({ prompts, notice: unreadableNotice(chosen.map((w) => w.note)) });
  };

  const practiced = async (prompt: FormPrompt, correct: boolean) => {
    const record: PracticeRecord = { noteId: prompt.noteId, key: prompt.key, correct, practicedAt: new Date().toISOString() };
    await repo.addPractice(record);
    setPractice((p) => [...p, record]);
  };

  const name = deck.split('::').pop() ?? deck;
  const count = answering === 'sentence'
    ? promptsNow(PATTERN_PROMPTS).length
    : Math.min(PATTERN_PROMPTS, chosen.reduce((n, w) => n + w.forms.filter((f) => groups.includes(f.group)).length, 0));

  return (
    <Screen
      onBack={onDone}
      backLabel="Deck options"
      title="Practice forms"
      footer={words && words.length ? (
        <Button label={count ? `Start: ${count} ${count === 1 ? 'prompt' : 'prompts'}` : 'Nothing to practice'} onPress={start} disabled={!count} />
      ) : undefined}
    >
      {drill ? (
        <FormsDrill
          prompts={drill.prompts}
          backLabel="Back to practice"
          mode={answering === 'sentence' ? 'type' : answering}
          typeOnly={answering === 'sentence'}
          onModeChange={(m) => { setAnswering(m); repo.saveFormsAnswerMode(m); }}
          onAnswer={practiced}
          notice={drill.notice}
          onClose={() => setDrill(null)}
        />
      ) : null}
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.l }}>
        {!words ? null : !words.length ? (
          <Card>
            <Text style={{ ...type.headline, color: c.text }}>No words to practice yet</Text>
            <Help>
              {`Practice uses words in ${name} that you've already studied and whose notes list their forms: a Forms field with one form per line, like "present · yo: espero", or a Gender, Plural or Classifier field.`}
            </Help>
          </Card>
        ) : (
          <>
            <ChipGroup label="Pattern" options={choices.patterns} selected={patterns} onToggle={(v) => toggle(patterns, setPatterns, v)} />
            <ChipGroup label="Forms" options={choices.groups} selected={groups} onToggle={(v) => toggle(groups, setGroups, v)} />
            <View style={{ gap: space.s }}>
              <Text style={{ ...type.footnote, color: c.textSecondary }}>Answer by</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                <Chip label="Pick" selected={answering === 'pick'} onPress={() => setAnswering('pick')} />
                <Chip label="Type" selected={answering === 'type'} onPress={() => setAnswering('type')} />
                <Chip label="In a sentence" selected={answering === 'sentence'} onPress={() => setAnswering('sentence')} />
              </View>
              {answering === 'sentence' ? <Help>Asks only forms that appear in a word's example sentence, typed into the gap.</Help> : null}
            </View>
            <Card style={{ gap: space.s }}>
              <Text style={{ ...type.headline, color: c.text }}>
                {chosen.length === 1 ? "1 word you've studied" : `${chosen.length} words you've studied`}
              </Text>
              {chosen.length ? (
                <Text style={{ ...type.subhead, color: c.textSecondary, lineHeight: 21 }}>
                  {chosen.slice(0, NAMED_WORDS).map((w) => headword(w.note)).join(', ')}
                  {chosen.length > NAMED_WORDS ? `, and ${chosen.length - NAMED_WORDS} more` : ''}
                </Text>
              ) : (
                <Help>Pick at least one pattern and one kind of form.</Help>
              )}
              <Help>Only words whose meaning you've already studied are used, so the practice is about the forms, not new words.</Help>
              {answering === 'sentence' && chosen.length && !count ? (
                <Help>None of these words' example sentences contain one of the chosen forms. Try Type instead.</Help>
              ) : null}
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function ChipGroup({ label, options, selected, onToggle }: { label: string; options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.s }}>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {options.map((o) => <Chip key={o} label={o} selected={selected.includes(o)} onPress={() => onToggle(o)} />)}
      </View>
    </View>
  );
}
