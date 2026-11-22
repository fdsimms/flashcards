import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { NoteStore } from '../../anki/noteService';
import { cramLanguageOf, cramNotes, withRequest } from '../../core/cram';
import { addSummary, cramWordsRequest, SUGGEST_FOCUS_CHARS, suggestedWords, wordsToLeaveOut } from '../../core/cramWords';
import { failureText } from '../../core/failure';
import type { LessonWordCandidate } from '../../core/lessonWords';
import type { Api, Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { haptic } from '../haptics';
import { Button, ErrorNote, Field, Group, Help, Icon, Loading, Screen, SectionTitle, Tappable } from '../kit';
import { readable, space, type, useTheme } from '../theme';
import { capCramCards, cramsNow, saveCram, setCramTag, useCollection, useCrams } from '../useCrams';
import { WorkingMark } from '../WorkingMark';
import { CheckRow } from './CramBits';

/**
 * Suggest words, on a cram's page (and Add's empty field): Claude names words for what the cram is
 * for (server cram_words.py), asked when the screen opens, on a focus typed in the field (it replaces
 * the list) and on More words (it adds to it, leaving out what is already shown). Words the deck has
 * are listed first, and Add tags them into the cram; the rest are "New cards", which go to the note
 * queue for Claude to write and join the cram once approved (`queue`), the way Add's Make a card
 * does. Nothing is checked until the learner checks it, and nothing here writes a note or grades a card.
 */
export function CramSuggest({ repo, api, cramId, queue, onDone }: {
  repo: NoteStore;
  api: Api;
  cramId: string;
  /** Sends words to the note queue in the language's deck; undefined when there's no deck for it. */
  queue: (language: Language, entries: { entry: string; meaning: string }[]) => Promise<'queued' | 'held' | undefined>;
  /** Leaves the screen once the words are added. */
  onDone: () => void;
}) {
  const c = useTheme();
  const { crams, loaded: cramsLoaded } = useCrams(repo);
  const collection = useCollection(repo);
  const cram = crams.find((x) => x.id === cramId);
  const language = cram && collection.loaded ? cramLanguageOf(cram, collection.notes) : undefined;
  const name = language ? LANGUAGES[language].name : undefined;
  const [shown, setShown] = useState<LessonWordCandidate[]>([]);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [focus, setFocus] = useState('');
  const [asking, setAsking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [asked, setAsked] = useState(false);
  // Which ask is the latest, so an answer for a focus typed over since isn't shown.
  const latest = useRef(0);

  const inCram = useMemo(() => (cram ? cramNotes(cram, collection.notes) : []), [cram, collection.notes]);
  const words = useMemo(
    () => (cram && language ? suggestedWords(shown, collection.notes, cram, inCram, language) : []),
    [shown, collection.notes, cram, inCram, language],
  );
  const inDeck = words.filter((w) => w.note);
  const fresh = words.filter((w) => !w.note);
  const picked = words.filter((w) => checked.has(w.candidate.text));

  const ask = async (more: boolean) => {
    if (!cram || !language) return;
    const ticket = ++latest.current;
    const forLanguage = language;
    setAsking(true);
    setProblem(undefined);
    try {
      const found = await api.cramWords(cramWordsRequest(forLanguage, cram, focus, wordsToLeaveOut(cram, inCram, more ? shown : [])));
      if (ticket !== latest.current) return;
      setAsked(true);
      if (more) {
        setShown((prev) => [...prev, ...found]);
      } else {
        setShown(found);
        setChecked(new Set());
      }
    } catch (e) {
      if (ticket === latest.current) setProblem(failureText(e, { what: "Couldn't get word ideas.", next: 'Try again.' }));
    } finally {
      if (ticket === latest.current) setAsking(false);
    }
  };

  // Asked once on opening.
  useEffect(() => {
    if (asked || asking || !cramsLoaded || !language) return;
    void ask(false);
  }, [cramsLoaded, language]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (word: LessonWordCandidate) => {
    haptic.select();
    setChecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(word.text)) next.add(word.text);
      return next;
    });
  };

  const add = async () => {
    if (!cram || !language || adding || !picked.length) return;
    setAdding(true);
    setProblem(undefined);
    haptic.tap();
    try {
      const have = picked.flatMap((w) => (w.note ? [w.note.id] : []));
      const need = picked.filter((w) => !w.note).map((w) => w.candidate);
      if (have.length) {
        await setCramTag(repo, cram, have, true);
        collection.reload();
        capCramCards(repo).catch(() => undefined);
      }
      if (need.length) {
        const how = await queue(language, need.map((w) => ({ entry: w.text, meaning: w.english })));
        if (!how) {
          setProblem(`Couldn't add the new cards. Read & Listen has no deck to write ${name ?? 'them'} cards into. Check Settings, Read & Listen.`);
          // The deck words were added, so those aren't offered again.
          setChecked(new Set());
          return;
        }
        // The cram as it is now: a word asked for while another save was in flight isn't lost.
        const now = cramsNow().find((x) => x.id === cram.id);
        if (now) await saveCram(repo, need.reduce((next, w) => withRequest(next, { text: w.text, english: w.english }), now));
      }
      haptic.success();
      onDone();
    } catch (e) {
      setProblem(failureText(e, { what: "Couldn't add the words.", next: 'Try again.' }));
    } finally {
      setAdding(false);
    }
  };

  const summary = addSummary(picked);
  const row = (w: (typeof words)[number], i: number) => (
    <CheckRow
      key={w.candidate.text}
      first={i === 0}
      label={w.candidate.text}
      detail={[w.candidate.reading, w.candidate.english].filter(Boolean).join(' · ')}
      checked={checked.has(w.candidate.text)}
      onPress={() => toggle(w.candidate)}
      disabled={adding}
    />
  );
  return (
    <Screen
      title="Suggest words"
      largeTitle={false}
      footer={picked.length ? (
        <View style={{ gap: space.xs }}>
          <Button label={summary.label} busy={adding} onPress={() => { void add(); }} />
          {summary.detail ? <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>{summary.detail}</Text> : null}
        </View>
      ) : undefined}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ ...readable, padding: space.l, gap: space.m }}>
        {!cram || !collection.loaded ? <Loading /> : null}
        {cram && collection.loaded && !language ? <Help>Choose the cram's language first (Edit, on its page).</Help> : null}
        {cram && language ? (
          <>
            <Help>{cram.untitled ? `${name} words to talk about. The words you pick are added to the cram.` : `For ${cram.name}`}</Help>
            <Field
              label="Focus (optional)"
              value={focus}
              onChangeText={(t) => setFocus(t.slice(0, SUGGEST_FOCUS_CHARS))}
              placeholder="e.g. how the race felt"
              returnKeyType="search"
              onSubmitEditing={() => { if (!asking) void ask(false); }}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
          </>
        ) : null}
        {problem ? <ErrorNote message={problem} onRetry={asked && !adding ? () => { void ask(false); } : undefined} /> : null}
        {asking && !words.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            <WorkingMark />
            <Text style={{ ...type.subhead, color: c.textSecondary }}>{`Thinking of ${name ?? ''} words`.replace('  ', ' ')}</Text>
          </View>
        ) : null}
        {asked && !asking && !words.length && !problem ? <Help>No new words this time. Try a different focus.</Help> : null}
        {inDeck.length ? (
          <>
            <SectionTitle>{`In your deck · ${inDeck.length}`}</SectionTitle>
            <Group>{inDeck.map(row)}</Group>
          </>
        ) : null}
        {fresh.length ? (
          <>
            <SectionTitle>{`New cards · ${fresh.length}`}</SectionTitle>
            <Group>{fresh.map(row)}</Group>
            <Help>Claude writes a card for each new word you add, and you approve it before it joins the cram.</Help>
          </>
        ) : null}
        {words.length ? (
          <Tappable onPress={() => { void ask(true); }} disabled={asking || adding} accessibilityRole="button" accessibilityLabel="More words" style={{ alignSelf: 'center', paddingVertical: space.s }}>
            {asking ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                <WorkingMark />
                <Text style={{ ...type.subhead, color: c.textSecondary }}>{`Thinking of ${name ?? ''} words`.replace('  ', ' ')}</Text>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 }}>
                <Icon name="sparkles" size={16} color={c.accentInk} />
                <Text style={{ ...type.subhead, color: c.accentInk }}>More words</Text>
              </View>
            )}
          </Tappable>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
