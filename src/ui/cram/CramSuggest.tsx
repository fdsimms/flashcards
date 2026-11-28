import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { NoteStore } from '../../anki/noteService';
import { cramLanguageOf, cramNotes, lessonPhrases, practiceOrder, withRequest, type CramPhrase } from '../../core/cram';
import { withPhrases } from '../../core/cramPhrases';
import { addSummary, cramPhrasesRequest, cramWordsRequest, SUGGEST_FOCUS_CHARS, suggestedWords, wordsToLeaveOut } from '../../core/cramWords';
import { failureText } from '../../core/failure';
import type { LessonWordCandidate } from '../../core/lessonWords';
import type { Api, Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { loadParticle } from '../../reader/lessonStorage';
import { haptic } from '../haptics';
import { Button, CheckboxRow, ErrorNote, Field, Group, Help, Icon, Loading, Screen, SectionTitle, Segments, Tappable } from '../kit';
import { readable, space, type, useTheme } from '../theme';
import { capCramCards, cramsNow, saveCram, setCramTag, useCollection, useCrams } from '../useCrams';
import { WorkingMark } from '../WorkingMark';
import { useKeyboardScroll } from '../useKeyboardScroll';

export type SuggestMode = 'words' | 'phrases';

/**
 * Suggest words, on a cram's page (and Add's empty field): Claude names words or, in Phrases mode,
 * writes short phrases for what the cram is for (server cram_words.py, cram_phrases.py). Asked when
 * the screen opens, when the other mode is first opened, on a focus typed in the field (it replaces
 * the list) and on More (it adds to it, leaving out what is already shown).
 *
 * Words the deck has are listed first, and Add tags them into the cram; the rest are "New cards",
 * which go to the note queue for Claude to write and join the cram once approved (`queue`), the way
 * Make a card does. Phrases are kept on the cram alone (cramPhrases.ts) and are never notes. Nothing
 * is checked until the learner checks it, and nothing here writes a note or grades a card.
 */
export function CramSuggest({ repo, api, cramId, initialMode, queue, onDone }: {
  repo: NoteStore;
  api: Api;
  cramId: string;
  /** Which list opens first. */
  initialMode?: SuggestMode;
  /** Sends words to the note queue in the language's deck; undefined when there's no deck for it. */
  queue: (language: Language, entries: { entry: string; meaning: string }[]) => Promise<'queued' | 'held' | undefined>;
  /** Leaves the screen once the words are added. */
  onDone: () => void;
}) {
  const c = useTheme();
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const { crams, loaded: cramsLoaded } = useCrams(repo);
  const collection = useCollection(repo);
  const cram = crams.find((x) => x.id === cramId);
  const language = cram && collection.loaded ? cramLanguageOf(cram, collection.notes) : undefined;
  const name = language ? LANGUAGES[language].name : undefined;
  const [mode, setMode] = useState<SuggestMode>(initialMode ?? 'words');
  const [shown, setShown] = useState<LessonWordCandidate[]>([]);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [shownPhrases, setShownPhrases] = useState<CramPhrase[]>([]);
  const [checkedPhrases, setCheckedPhrases] = useState<ReadonlySet<string>>(new Set());
  const [focus, setFocus] = useState('');
  // Which list is being asked for, and which have been asked at least once.
  const [asking, setAsking] = useState<SuggestMode>();
  const [asked, setAsked] = useState<ReadonlySet<SuggestMode>>(new Set());
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string>();
  // Which ask is the latest for each list, so an answer for a focus typed over since isn't shown.
  const latest = useRef<Record<SuggestMode, number>>({ words: 0, phrases: 0 });

  const inCram = useMemo(() => (cram ? cramNotes(cram, collection.notes) : []), [cram, collection.notes]);
  const words = useMemo(
    () => (cram && language ? suggestedWords(shown, collection.notes, cram, inCram, language) : []),
    [shown, collection.notes, cram, inCram, language],
  );
  const inDeck = words.filter((w) => w.note);
  const fresh = words.filter((w) => !w.note);
  const pickedWords = words.filter((w) => checked.has(w.candidate.text));
  // A phrase already on the cram (added meanwhile, or from another list) isn't offered again.
  const phrases = shownPhrases.filter((p) => !(cram?.phrases ?? []).some((x) => x.text === p.text));
  const pickedPhrases = phrases.filter((p) => checkedPhrases.has(p.text));
  const phraseMode = mode === 'phrases';
  const busy = asking === mode;

  const ask = async (which: SuggestMode, more: boolean) => {
    if (!cram || !language) return;
    const ticket = ++latest.current[which];
    const forLanguage = language;
    setAsking(which);
    setProblem(undefined);
    try {
      if (which === 'words') {
        const found = await api.cramWords(cramWordsRequest(forLanguage, cram, focus, wordsToLeaveOut(cram, inCram, more ? shown : [])));
        if (ticket !== latest.current.words) return;
        if (more) {
          setShown((prev) => [...prev, ...found]);
        } else {
          setShown(found);
          setChecked(new Set());
        }
      } else {
        // The cram's words with their meanings, shakiest first, for the phrases to use.
        const own = lessonPhrases(practiceOrder(cram, inCram), forLanguage).map(({ text, english }) => ({ text, english }));
        const found = await api.cramPhrases(cramPhrasesRequest(forLanguage, cram, focus, own, more ? shownPhrases : [], await loadParticle()));
        if (ticket !== latest.current.phrases) return;
        const next = found.map((p) => ({ text: p.text, english: p.english, ...(p.reading ? { reading: p.reading } : {}) }));
        if (more) {
          setShownPhrases((prev) => [...prev, ...next]);
        } else {
          setShownPhrases(next);
          setCheckedPhrases(new Set());
        }
      }
      setAsked((prev) => new Set(prev).add(which));
    } catch (e) {
      if (ticket === latest.current[which]) setProblem(failureText(e, { what: which === 'words' ? "Couldn't get word ideas." : "Couldn't get phrase ideas.", next: 'Try again.' }));
    } finally {
      if (ticket === latest.current[which]) setAsking((now) => (now === which ? undefined : now));
    }
  };

  // Asked when a list is first shown.
  useEffect(() => {
    if (asked.has(mode) || asking || !cramsLoaded || !language) return;
    void ask(mode, false);
  }, [cramsLoaded, language, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (text: string) => {
    haptic.select();
    const flip = (prev: ReadonlySet<string>) => {
      const next = new Set(prev);
      if (!next.delete(text)) next.add(text);
      return next;
    };
    if (phraseMode) setCheckedPhrases(flip);
    else setChecked(flip);
  };

  const add = async () => {
    if (!cram || !language || adding) return;
    setAdding(true);
    setProblem(undefined);
    haptic.tap();
    try {
      if (phraseMode) {
        // The cram as it is now, so a phrase added while another save was in flight isn't lost.
        const now = cramsNow().find((x) => x.id === cram.id) ?? cram;
        await saveCram(repo, withPhrases(now, pickedPhrases));
        haptic.success();
        onDone();
        return;
      }
      const have = pickedWords.flatMap((w) => (w.note ? [w.note.id] : []));
      const need = pickedWords.filter((w) => !w.note).map((w) => w.candidate);
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
      setProblem(failureText(e, { what: phraseMode ? "Couldn't add the phrases." : "Couldn't add the words.", next: 'Try again.' }));
    } finally {
      setAdding(false);
    }
  };

  const summary = phraseMode
    ? { label: pickedPhrases.length === 1 ? 'Add 1 phrase' : `Add ${pickedPhrases.length} phrases`, detail: '' }
    : addSummary(pickedWords);
  const pickedCount = phraseMode ? pickedPhrases.length : pickedWords.length;
  const wordRow = (w: (typeof words)[number], i: number) => (
    <CheckboxRow
      key={w.candidate.text}
      first={i === 0}
      label={w.candidate.text}
      detail={[w.candidate.reading, w.candidate.english].filter(Boolean).join(' · ')}
      checked={checked.has(w.candidate.text)}
      onPress={() => toggle(w.candidate.text)}
      disabled={adding}
    />
  );
  const thinking = `Thinking of ${name ?? ''} ${phraseMode ? 'phrases' : 'words'}`.replace('  ', ' ');
  const empty = phraseMode ? !phrases.length : !words.length;
  return (
    <Screen
      title="Suggest"
      largeTitle={false}
      footer={pickedCount ? (
        <View style={{ gap: space.xs }}>
          <Button label={summary.label} busy={adding} onPress={() => { void add(); }} />
          {summary.detail ? <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>{summary.detail}</Text> : null}
        </View>
      ) : undefined}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ ...readable, padding: space.l, paddingBottom: space.l + bottomPadding, gap: space.m }} {...scrollProps}>
        {!cram || !collection.loaded ? <Loading /> : null}
        {cram && collection.loaded && !language ? <Help>Choose the cram's language first (Edit, on its page).</Help> : null}
        {cram && language ? (
          <>
            <Segments<SuggestMode>
              options={[{ value: 'words', label: 'Words' }, { value: 'phrases', label: 'Phrases' }]}
              value={mode}
              onChange={(next) => { setProblem(undefined); setMode(next); }}
            />
            <Help>{cram.untitled ? `${name} ${phraseMode ? 'phrases' : 'words'} to talk about. What you pick is added to the cram.` : `For ${cram.name}`}</Help>
            <Field
              label="Focus (optional)"
              value={focus}
              onChangeText={(t) => setFocus(t.slice(0, SUGGEST_FOCUS_CHARS))}
              placeholder="e.g. how the race felt"
              returnKeyType="search"
              onSubmitEditing={() => { if (!busy) void ask(mode, false); }}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
          </>
        ) : null}
        {problem ? <ErrorNote message={problem} onRetry={asked.has(mode) && !adding ? () => { void ask(mode, false); } : undefined} /> : null}
        {busy && empty ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            <WorkingMark />
            <Text style={{ ...type.subhead, color: c.textSecondary }}>{thinking}</Text>
          </View>
        ) : null}
        {asked.has(mode) && !busy && empty && !problem ? <Help>{phraseMode ? 'No new phrases this time. Try a different focus.' : 'No new words this time. Try a different focus.'}</Help> : null}
        {phraseMode && phrases.length ? (
          <Group>
            {phrases.map((p, i) => (
              <CheckboxRow key={p.text} first={i === 0} label={p.text} detail={[p.reading, p.english].filter(Boolean).join(' · ')} checked={checkedPhrases.has(p.text)} onPress={() => toggle(p.text)} disabled={adding} />
            ))}
          </Group>
        ) : null}
        {!phraseMode && inDeck.length ? (
          <>
            <SectionTitle>{`In your deck · ${inDeck.length}`}</SectionTitle>
            <Group>{inDeck.map(wordRow)}</Group>
          </>
        ) : null}
        {!phraseMode && fresh.length ? (
          <>
            <SectionTitle>{`New cards · ${fresh.length}`}</SectionTitle>
            <Group>{fresh.map(wordRow)}</Group>
            <Help>Claude writes a card for each new word you add, and you approve it before it joins the cram.</Help>
          </>
        ) : null}
        {!empty ? (
          <Tappable onPress={() => { void ask(mode, true); }} disabled={busy || adding} accessibilityRole="button" accessibilityLabel={phraseMode ? 'More phrases' : 'More words'} style={{ alignSelf: 'center', paddingVertical: space.s }}>
            {busy ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                <WorkingMark />
                <Text style={{ ...type.subhead, color: c.textSecondary }}>{thinking}</Text>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 }}>
                <Icon name="sparkles" size={16} color={c.accentInk} />
                <Text style={{ ...type.subhead, color: c.accentInk }}>{phraseMode ? 'More phrases' : 'More words'}</Text>
              </View>
            )}
          </Tappable>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
