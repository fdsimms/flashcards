import { usePreventRemove } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { DEFAULT_GATE_CAP } from '../core/config';
import { failureText } from '../core/failure';
import { groupByDeck, inProgressCount } from '../core/deckTree';
import { skillCardIds } from '../core/skillTag';
import { GURU_INTERVAL_DAYS, parseGateCap } from '../core/progress';
import { deckHasAspectLanguage } from '../core/aspectCheck';
import { deckHasForms } from '../core/forms';
import { newCardOrderOf } from '../core/newCardOrder';
import { paramsForDeck } from '../core/scheduler';
import { goalTarget } from '../core/dailyGoal';
import type { DeckParams, DeckSettings, Note } from '../core/types';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import type { RecordDeps } from '../anki/recordService';
import { deckScripts } from '../core/fontScripts';
import type { Script } from '../core/fonts';
import { useApp } from './AppContext';
import { DeckDailyGoal } from './DeckDailyGoal';
import { DeckDailyLimits } from './DeckDailyLimits';
import { tuneDeck } from './dailyGoals';
import { DeckFontOptions } from './DeckFontOptions';
import { DeckFormsOptions } from './DeckFormsOptions';
import { DeckNewCardOrder } from './DeckNewCardOrder';
import { DeckBatchOptions } from './DeckBatchOptions';
import { DeckPriorityOptions } from './DeckPriorityOptions';
import { DeckRecordings } from './DeckRecordings';
import { Card, Field, Group, Help, Loading, NavRow, PageTitle, Screen, SECTION_GAP, Section, SwitchRow } from './kit';
import { space, type, useTheme, readable } from './theme';
import { useKeyboardScroll } from './useKeyboardScroll';

/** Settings made in the app for one deck: the progress gate, new card order, Anki options, skill cards, forms practice, lookalike words and recordings. */
export function DeckOptions({ repo, deck, onCustomStudy, onSkillCards, onBrowse, onAnkiOptions, recorder }: { repo: Repo & AnkiLink; deck: string; onCustomStudy: () => void; onSkillCards: () => void; onBrowse: () => void; onAnkiOptions: () => void; recorder: RecordDeps | null }) {
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const c = useTheme();
  const [settings, setSettings] = useState<DeckSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [capText, setCapText] = useState('');
  const [error, setError] = useState<string>();
  const [inProgress, setInProgress] = useState<number>();
  // An Anki filtered deck has no limits or cards of its own to add to, so custom study isn't offered on it.
  const [filtered, setFiltered] = useState(false);
  // Whether the deck is studied with an Anki preset, which Anki options edits.
  const [hasPreset, setHasPreset] = useState(false);
  // Every deck's settings, for what this deck inherits from the decks above it.
  const [all, setAll] = useState<Map<string, DeckSettings>>(new Map());
  // The scripts this deck's cards are written in, for the card fonts that can draw them (`deckScripts`).
  const [scripts, setScripts] = useState<Script[]>([]);
  // Every note, for Tagged cards first's tag suggestions and counts.
  const [allNotes, setAllNotes] = useState<Note[]>([]);
  // Whether the deck has Russian or Polish notes, the only ones the verb aspect setting does anything for.
  const [aspectApplies, setAspectApplies] = useState(false);
  // Whether any note in the deck lists forms, which Forms practice needs.
  const [formsApply, setFormsApply] = useState(false);
  // Every deck's Anki settings, for what a daily goal can set here (`goalTarget`).
  const [params, setParams] = useState<Map<string, DeckParams>>(new Map());
  const { refresh } = useApp();
  const saving = useRef(Promise.resolve());

  useEffect(() => {
    setLoadError(null);
    (async () => {
      await saving.current; // a reload after a failed save reads what the saves still queued wrote
      const [all, cards, notes, params] = await Promise.all([repo.listDeckSettings(), repo.listCards(deck), repo.listNotes(), repo.listDeckParams()]);
      setFiltered(!!paramsForDeck(deck, params)?.filtered);
      setHasPreset(!!newCardOrderOf(deck, params));
      setScripts(deckScripts(deck, notes));
      setAllNotes(notes);
      setAspectApplies(deckHasAspectLanguage(deck, notes));
      setFormsApply(deckHasForms(deck, notes));
      setParams(params);
      const s = all.get(deck) ?? {};
      setAll(all);
      setSettings(s);
      setCapText(String(s.gateCap ?? DEFAULT_GATE_CAP));
      setInProgress(inProgressCount(deck, groupByDeck(cards, new Map(notes.map((n) => [n.id, n.deck]))), skillCardIds(notes, cards)));
    })().catch((e) => setLoadError(failureText(e, { what: "Couldn't load this deck's options.", next: 'Try again.' })));
  }, [repo, deck, attempt]);

  // Writes queue behind each other, so a quick toggle-then-edit can't land out of order. A failed
  // write is said and the queue goes on, so later saves (and leaving the screen) aren't stuck behind it;
  // the screen is read back from what's stored, so it doesn't go on showing the setting that wasn't saved.
  const save = (next: DeckSettings) => {
    setSettings(next);
    saving.current = saving.current
      .then(() => repo.saveDeckSettings(deck, next))
      .catch((e) => {
        Alert.alert("Couldn't save this setting", failureText(e, { next: 'Try again.' }));
        setAttempt((n) => n + 1);
      });
  };

  // A daily goal's value worked out again once the saves before it have landed, then the screen
  // and the deck list read back, so the cap above and the deck's counts show what it set.
  const retune = async () => {
    await saving.current;
    try { await tuneDeck(repo, deck); } finally { setAttempt((n) => n + 1); refresh().catch(() => undefined); }
  };

  const toggle = (on: boolean) => {
    if (!settings) return;
    // With a daily goal, the gate decides what the goal sets: work today's value out again for it.
    const goal = settings.dailyGoal !== undefined;
    if (!on) { save({ ...settings, gateCap: undefined }); setError(undefined); if (goal) retune().catch(() => undefined); return; }
    const parsed = parseGateCap(capText);
    save({ ...settings, gateCap: 'cap' in parsed ? parsed.cap : DEFAULT_GATE_CAP });
    if (!('cap' in parsed)) setCapText(String(DEFAULT_GATE_CAP));
    setError(undefined);
    if (goal) retune().catch(() => undefined);
  };

  const commitCap = () => {
    if (!settings || settings.gateCap === undefined) return;
    const parsed = parseGateCap(capText);
    if ('error' in parsed) { setError(parsed.error); return; }
    setError(undefined);
    if (parsed.cap !== settings.gateCap) save({ ...settings, gateCap: parsed.cap });
  };

  // Leaving with a cap still being typed saves it first, once the save has landed so the deck list
  // reads it. A cap that can't be used keeps the screen open with its reason, rather than being dropped.
  const typing = settings?.gateCap !== undefined && capText !== String(settings.gateCap);
  usePreventRemove(typing, ({ repeat }) => {
    const parsed = parseGateCap(capText);
    if ('error' in parsed) { setError(parsed.error); return; }
    setError(undefined);
    if (settings) save({ ...settings, gateCap: parsed.cap });
    saving.current.then(repeat);
  });

  const on = settings?.gateCap !== undefined;
  const target = settings ? goalTarget(deck, settings, params) : undefined;
  // The goal sets the cap each day, so it's shown and not edited while the goal is on.
  const capByGoal = on && settings?.dailyGoal !== undefined;
  const name = deck.split('::').pop();
  // The daily goal comes first, right under the title, when the deck can have one; the gate it may set follows.
  const goalShown = !filtered && !!target;
  const gateSection = !settings ? null : (
    <Section footer={inProgress !== undefined ? (
      <Help>{inProgress === 1 ? '1 card is' : `${inProgress} cards are`} in progress in this deck and its subdecks now.</Help>
    ) : undefined}>
      <Group>
        <SwitchRow
          first
          label="Limit cards in progress"
          hint={`Show new cards only while fewer than this many cards in this deck and its subdecks are still in progress. A card stops counting once its next review is ${GURU_INTERVAL_DAYS} days or more away, and counts again if you forget it. New cards also stay within this deck's daily new card limit. Limits set on its subdecks don't apply.`}
          value={on}
          onValueChange={toggle}
        />
      </Group>
      {on ? (
        <Card>
          <Field
            label="Maximum cards in progress"
            value={capText}
            onChangeText={(v) => { setCapText(v); setError(undefined); }}
            onEndEditing={commitCap}
            keyboardType="number-pad"
            returnKeyType="done"
            error={!!error}
            editable={!capByGoal}
          />
          {error ? <Text style={{ ...type.subhead, color: c.danger }}>{error}</Text> : null}
          {capByGoal ? <Help>Set by your daily goal. Turn the goal off to set it yourself.</Help> : null}
        </Card>
      ) : null}
    </Section>
  );
  return (
    <Screen>
      {!settings ? <Loading error={loadError} onRetry={() => setAttempt((n) => n + 1)} /> : (
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l + bottomPadding, gap: SECTION_GAP }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" {...scrollProps}>
        <View style={{ gap: space.m }}>
          <PageTitle>{name ?? ''}</PageTitle>
          {goalShown ? <DeckDailyGoal settings={settings} target={target} onChange={(patch) => save({ ...settings, ...patch })} retune={retune} /> : gateSection}
        </View>
        {goalShown ? gateSection : null}
        {filtered ? null : <DeckNewCardOrder repo={repo} deck={deck} />}
        {!filtered && !hasPreset && settings ? <DeckDailyLimits settings={settings} onChange={(patch) => save({ ...settings, ...patch })} newSetByGoal={settings.dailyGoal !== undefined && target === 'own'} /> : null}
        {filtered ? null : (
          <Group>
            {hasPreset ? <NavRow first label="Anki options" detail="Daily limits, learning steps, maximum interval and desired retention" onPress={onAnkiOptions} /> : null}
            <NavRow first={!hasPreset} label="Custom study" detail="Study more today, or pick cards to study now" onPress={onCustomStudy} />
            <NavRow label="Skill cards" detail="Times, numbers, dates, prices, letters and cases as cards in your reviews" onPress={onSkillCards} />
            <NavRow label="Browse cards" detail="Search, filter and edit the notes in this deck" onPress={onBrowse} />
          </Group>
        )}
        {settings ? <DeckBatchOptions deck={deck} all={new Map(all).set(deck, settings)} onChange={(patch) => save({ ...settings, ...patch })} /> : null}
        {settings ? <DeckPriorityOptions deck={deck} notes={allNotes} all={new Map(all).set(deck, settings)} onChange={(patch) => save({ ...settings, ...patch })} /> : null}
        {settings ? <DeckFontOptions deck={deck} scripts={scripts} all={new Map(all).set(deck, settings)} onChange={(patch) => save({ ...settings, ...patch })} /> : null}
        {settings ? <DeckFormsOptions deck={deck} formsApply={formsApply} aspectApplies={aspectApplies} all={new Map(all).set(deck, settings)} onChange={(patch) => save({ ...settings, ...patch })} /> : null}
        {filtered ? null : <DeckRecordings repo={repo} deck={deck} recorder={recorder} />}
      </ScrollView>
      )}
    </Screen>
  );
}
