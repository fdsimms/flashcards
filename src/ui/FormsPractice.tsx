import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  drillPrompts, headword, PATTERN_PROMPT_LIMITS, patternOf, practiceChoices, practicedGroups, practicedGroupsLine, studiedWords,
  type DrillRequest, type PracticeRecord, type PracticeWord,
} from '../core/forms';
import type { Card as StoredCard, Note } from '../core/types';
import type { Repo } from '../db/repo';
import type { Api } from '../reader/api';
import { practicingPoints } from '../reader/grammar';
import { Button, Card, Chip, Help, Screen, SectionTitle, Segments } from './kit';
import { space, type, useTheme } from './theme';

type Answering = 'pick' | 'type' | 'sentence';

/** How many studied words the screen names before "and N more". */
const NAMED_WORDS = 7;

/**
 * Practicing forms across a deck: one pattern (a VerbClass, or nouns) and some kinds of form at a
 * time, with words already studied, so the practice is about the forms rather than new words.
 * `onStart` opens the drill (`FormsDrill`) for the choices made. It starts with the kinds of form
 * of grammar practiced in Read & Listen (`readerApi`, null while it's off), and says so.
 */
export function FormsPractice({ repo, readerApi, deck, onStart }: { repo: Repo; readerApi: Api | null; deck: string; onStart: (request: DrillRequest) => void }) {
  const c = useTheme();
  const [words, setWords] = useState<PracticeWord[] | null>(null);
  const [patterns, setPatterns] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [answering, setAnswering] = useState<Answering>('pick');
  const [limit, setLimit] = useState<number>(PATTERN_PROMPT_LIMITS[0]);
  const [data, setData] = useState<{ notes: Note[]; cards: StoredCard[]; practice: PracticeRecord[] }>();
  // The kinds of form chosen for being practiced in Read & Listen, and why; the reason shows only while they're still the selection.
  const [preselected, setPreselected] = useState<{ groups: string[]; line: string }>();

  useEffect(() => {
    (async () => {
      const [notes, cards, mode, practice, practicing] = await Promise.all([
        repo.listNotes(), repo.listCards(deck), repo.formsAnswerMode(), repo.listPractice(), practicingPoints(readerApi),
      ]);
      setData({ notes, cards, practice });
      const mine = studiedWords(deck, notes, cards);
      const choices = practiceChoices(mine);
      const practiced = practicedGroups(mine, practicing);
      const line = practicedGroupsLine(practiced.points);
      setWords(mine);
      setAnswering(mode);
      setPatterns(choices.patterns.slice(0, 1));
      setGroups(practiced.groups.length ? practiced.groups : choices.groups.slice(0, 1));
      setPreselected(line ? { groups: practiced.groups, line } : undefined);
    })();
  }, [repo, deck]); // eslint-disable-line react-hooks/exhaustive-deps

  const choices = useMemo(() => practiceChoices(words ?? []), [words]);
  const chosen = useMemo(
    () => (words ?? []).filter((w) => patterns.includes(patternOf(w.note)) && w.forms.some((f) => groups.includes(f.group))),
    [words, patterns, groups],
  );
  const forms = chosen.reduce((n, w) => n + w.forms.filter((f) => groups.includes(f.group)).length, 0);
  // What the drill will ask, from the drill's own function, so Start is enabled only when it has prompts
  // ("In a sentence" drops every form without an example sentence, which `forms` doesn't see).
  const asked = useMemo(
    () => (data && forms ? drillPrompts({ kind: 'pattern', deck, patterns, groups, sentence: answering === 'sentence' }, data).prompts.length : 0),
    [data, forms, deck, patterns, groups, answering],
  );
  const toggle = (list: string[], set: (l: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const name = deck.split('::').pop() ?? deck;

  const start = () => {
    if (answering !== 'sentence') repo.saveFormsAnswerMode(answering);
    onStart({ kind: 'pattern', deck, patterns, groups, sentence: answering === 'sentence', limit: limit || undefined });
  };

  return (
    <Screen
      title="Practice forms"
      footer={words?.length ? (
        <Button label={asked ? `Start: up to ${limit ? Math.min(asked, limit) : asked} prompts` : 'Nothing to practice'} onPress={start} disabled={!asked} />
      ) : undefined}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.l }}>
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
            <ChipGroup
              label="Forms"
              options={choices.groups}
              selected={groups}
              onToggle={(v) => toggle(groups, setGroups, v)}
              help={preselected && sameItems(groups, preselected.groups) ? preselected.line : undefined}
            />
            <View style={{ gap: space.s }}>
              <SectionTitle>Answer by</SectionTitle>
              <Segments<Answering>
                options={[{ value: 'pick', label: 'Pick' }, { value: 'type', label: 'Type' }, { value: 'sentence', label: 'In a sentence' }]}
                value={answering}
                onChange={setAnswering}
              />
              {answering === 'sentence' ? <Help>Asks only the forms that appear in a word's example sentence, typed into the gap.</Help> : null}
              {answering === 'sentence' && forms && !asked ? <Help>None of these words have an example sentence that contains one of these forms. Choose another way to answer.</Help> : null}
            </View>
            <View style={{ gap: space.s }}>
              <SectionTitle>Prompts</SectionTitle>
              <Segments<number>
                options={PATTERN_PROMPT_LIMITS.map((n) => (n ? { value: n, label: String(n), accessibilityLabel: `${n} prompts` } : { value: 0, label: 'No limit', accessibilityLabel: 'No limit on prompts' }))}
                value={limit}
                onChange={setLimit}
              />
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
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const sameItems = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

function ChipGroup({ label, options, selected, onToggle, help }: { label: string; options: string[]; selected: string[]; onToggle: (v: string) => void; help?: string }) {
  return (
    <View style={{ gap: space.s }}>
      <SectionTitle>{label}</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {options.map((o) => <Chip key={o} label={o} selected={selected.includes(o)} onPress={() => onToggle(o)} />)}
      </View>
      {help ? <Help>{help}</Help> : null}
    </View>
  );
}
