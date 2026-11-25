import * as Clipboard from 'expo-clipboard';
import { Stack, usePreventRemove } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View, type TextInputInstance } from 'react-native';
import { failureText } from '../core/failure';
import { withThaiLineHeight } from '../core/script';
import {
  addWord, asTyped, counts, MAX_QUEUED, parseWordList, splitLine, wordState,
  type FoundWord, type QuickWord, type WordState,
} from '../core/quickAdd';
import { QUEUED_MODEL } from '../reader/noteQueue';
import { deckShortName } from './deckShortName';
import { haptic } from './haptics';
import { Button, Card, Chip, Divider, ErrorNote, Field, Group, Help, Icon, Screen, Segments, Select, Tappable } from './kit';
import { ListeningNote, SpeakButton } from './SpeakButton';
import { MIN_TAP, readable, space, type, useTheme } from './theme';
import { useKeyboardScroll } from './useKeyboardScroll';
import type { QuickCollection, QuickSaved } from './useQuickAddNotes';
import { useSpokenAnswer } from './useSpokenAnswer';

/** A deck Quick add can add to, and how. */
export interface QuickAddDeck {
  deck: string;
  /**
   * Claude fills the notes in: the deck is one of Read & Listen's languages and it's on, so words go to
   * the note queue and each is checked in the note editor. Otherwise a word and its meaning are saved
   * straight to the deck when Add is tapped.
   */
  filled: boolean;
  /** The deck's language (ru-RU), for its keyboard, the microphone and spotting Latin letters; none for a trivia deck. */
  speechTag?: string;
  /** The language's name ("Russian"), when it has one. */
  languageName?: string;
}


type Mode = 'one' | 'list';

/**
 * Quick add: words typed one per Return or pasted as a list, for one deck. With Claude (a Read & Listen
 * language deck while it's on) the words go to the note queue, Claude fills in the rest, a word typed the
 * way it sounds gets its real spelling, and "Don't know the word?" finds a word from its meaning; nothing
 * reaches the deck until each note is saved in the note editor. Without Claude each word needs its
 * meaning and is saved as a note when Add is tapped (`useQuickAddNotes`), which is the approval. Either
 * way a word the deck already has says so before Add, by the same check the save refuses it by.
 */
export function QuickAdd({ decks, initial, collection, onQueue, onSave, onLookUp, onDeckChosen, onDone }: {
  decks: QuickAddDeck[];
  initial: string;
  collection: QuickCollection;
  /** 'held' when offline: the words wait on the phone and go to Claude when it's back (useNoteQueue). */
  onQueue: (deck: string, words: QuickWord[]) => Promise<'queued' | 'held' | undefined>;
  onSave: (deck: string, words: QuickWord[]) => Promise<QuickSaved>;
  /** Words for a meaning, from Claude; absent while Read & Listen is off. */
  onLookUp?: (deck: string, meaning: string) => Promise<FoundWord[]>;
  /** The deck words were just added to, so the next Quick add starts there. */
  onDeckChosen?: (deck: string) => void;
  onDone: () => void;
}) {
  const c = useTheme();
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const [deck, setDeck] = useState(initial);
  const [mode, setMode] = useState<Mode>('one');
  const [words, setWords] = useState<QuickWord[]>([]);
  const [text, setText] = useState('');
  const [meaningText, setMeaningText] = useState('');
  const [listText, setListText] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [found, setFound] = useState<{ meaning: string; words: FoundWord[] } | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Words the deck refused when Add was tapped, by entry, with why: they stay on the list.
  const [refused, setRefused] = useState<Record<string, string>>({});
  const meaningInput = useRef<TextInputInstance | null>(null);
  const wordInput = useRef<TextInputInstance | null>(null);

  const target = decks.find((d) => d.deck === deck) ?? decks[0];
  const filled = target.filled;
  const speechTag = target.speechTag;
  const language = target.languageName;
  const model = filled ? QUEUED_MODEL : collection.plainType(deck).model;
  const labels = filled ? null : collection.plainType(deck);
  const canLookUp = filled && !!onLookUp;

  const spoken = useSpokenAnswer(speechTag, { onHeard: (heard) => setText(heard) });

  const listed = useMemo(() => parseWordList(listText), [listText]);
  const shown = mode === 'one' ? words : listed.words;
  const states = shown.map((w) => wordState(w, { filled, speechTag, inDeck: collection.inDeck(deck, model, w) }));
  const toAdd = shown.filter((_, i) => counts(states[i]));
  const tooMany = filled && toAdd.length > MAX_QUEUED;
  const changed = words.length > 0 || listText.trim() !== '' || text.trim() !== '';

  // Leaving with words typed asks first, as the note editor does.
  const stopAsking = usePreventRemove(changed && !busy, ({ repeat }) => {
    Alert.alert('Discard changes?', "If you leave now, they'll be lost.", [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: repeat },
    ]);
  });

  const addTyped = () => {
    const word = filled
      ? splitLine(text)
      : (() => { const entry = asTyped(text, speechTag, true).trim(); return entry ? { entry, meaning: meaningText.trim() } : null; })();
    if (!word) return;
    haptic.tap();
    setWords((list) => addWord(list, word));
    setText('');
    setMeaningText('');
    setProblem(null);
    if (!filled) wordInput.current?.focus();
  };

  const lookUp = async () => {
    const meaning = text.trim();
    if (!meaning || !onLookUp || lookupBusy) return;
    setLookupBusy(true);
    setProblem(null);
    try {
      setFound({ meaning, words: await onLookUp(deck, meaning) });
    } catch (e) {
      setProblem(failureText(e, { what: "Couldn't look that up.", next: 'Try again.' }));
    } finally {
      setLookupBusy(false);
    }
  };

  const remove = (entry: string) => {
    setWords((list) => list.filter((w) => w.entry !== entry));
    setRefused((r) => Object.fromEntries(Object.entries(r).filter(([e]) => e !== entry)));
  };

  const addAnyway = (entry: string) => {
    haptic.tap();
    setWords((list) => list.map((w) => (w.entry === entry ? { ...w, anyway: true } : w)));
  };

  const paste = async () => {
    const pasted = await Clipboard.getStringAsync().catch(() => '');
    if (pasted) setListText((t) => (t.trim() ? `${t.replace(/\s+$/, '')}\n${pasted}` : pasted));
  };

  const add = async () => {
    // A second tap while the first is out would add every word twice.
    if (busy || !toAdd.length || tooMany) return;
    setBusy(true);
    setProblem(null);
    try {
      if (filled) {
        const queued = await onQueue(deck, toAdd);
        onDeckChosen?.(deck);
        stopAsking();
        if (queued === 'held') {
          Alert.alert(toAdd.length === 1 ? 'Added 1 word' : `Added ${toAdd.length} words`, "Claude fills them in once your server answers. Then they'll be ready to review on Today.");
        }
        haptic.success();
        onDone();
        return;
      }
      const done = await onSave(deck, toAdd);
      onDeckChosen?.(deck);
      if (!done.refused.length) {
        haptic.success();
        stopAsking();
        onDone();
        return;
      }
      // What was saved leaves the list; what wasn't stays, with why.
      const left = new Set(done.refused.map((r) => r.entry));
      setWords(toAdd.filter((w) => left.has(w.entry)));
      setListText('');
      setMode('one');
      setRefused(Object.fromEntries(done.refused.map((r) => [r.entry, r.reason])));
      setProblem(`Added ${done.saved} of ${toAdd.length} notes. The rest are still on the list, with the reason on each.`);
    } catch (e) {
      setProblem(failureText(e, { what: filled ? "Couldn't add these words to the queue." : "Couldn't add these notes.", next: 'Try again.' }));
    } finally {
      setBusy(false);
    }
  };

  const buttonLabel = filled
    ? (toAdd.length ? `Add ${toAdd.length} to queue` : 'Add to queue')
    : (toAdd.length === 1 ? 'Add 1 note' : toAdd.length ? `Add ${toAdd.length} notes` : 'Add notes');

  return (
    <Screen
      title="Quick add"
      largeTitle={false}
      toolbar={
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button accessibilityLabel="Cancel" onPress={onDone}>Cancel</Stack.Toolbar.Button>
        </Stack.Toolbar>
      }
      footer={<Button label={buttonLabel} onPress={add} busy={busy} disabled={!toAdd.length || tooMany} />}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l + bottomPadding, gap: space.m }}
        {...scrollProps}
      >
        {decks.length > 1 ? (
          <Card>
            <Select label="Deck" options={decks.map((d) => d.deck)} value={deck} onChange={(d) => { setDeck(d); setFound(null); setLookingUp(false); setRefused({}); }} />
          </Card>
        ) : null}
        <Segments<Mode>
          options={[{ value: 'one', label: 'One at a time' }, { value: 'list', label: 'Paste a list' }]}
          value={mode}
          onChange={(m) => { setMode(m); setLookingUp(false); setFound(null); }}
        />

        {mode === 'one' ? (
          <Card>
            {lookingUp ? (
              <Field
                label="What you want to say, in English"
                placeholder="e.g. to bargain"
                value={text}
                onChangeText={setText}
                autoCorrect={false}
                autoFocus
                keyboardLanguage="en-US"
                returnKeyType="search"
                submitBehavior="submit"
                onSubmitEditing={lookUp}
              />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.s }}>
                <View style={{ flex: 1 }}>
                  <Field
                    ref={wordInput}
                    label={filled ? (language ? `Word in ${language}` : 'Word') : (language && labels?.word === 'Entry' ? language : labels?.word ?? 'Front')}
                    placeholder={filled ? 'Optional: add a meaning after a dash' : undefined}
                    value={text}
                    onChangeText={(t) => setText(filled ? t : asTyped(t, speechTag))}
                    autoCorrect={false}
                    autoCapitalize="none"
                    autoFocus
                    keyboardLanguage={speechTag}
                    returnKeyType="next"
                    submitBehavior="submit"
                    onSubmitEditing={() => (filled ? addTyped() : meaningInput.current?.focus())}
                  />
                </View>
                <SpeakButton spoken={spoken} size="small" label={`Say it in ${language ?? "the deck's language"}`} />
              </View>
            )}
            {!filled && !lookingUp ? (
              <Field
                ref={meaningInput}
                label={labels?.meaning ?? 'Meaning'}
                value={meaningText}
                onChangeText={setMeaningText}
                autoCorrect={false}
                keyboardLanguage="en-US"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={addTyped}
              />
            ) : null}
            {spoken.listening || spoken.problem ? <ListeningNote spoken={spoken} language={language ?? 'the word'} /> : null}
            {canLookUp ? (
              <Tappable
                onPress={() => { haptic.tap(); setLookingUp((l) => !l); setFound(null); setText(''); }}
                accessibilityRole="button"
                style={{ alignSelf: 'flex-start', minHeight: MIN_TAP, justifyContent: 'center' }}
              >
                <Text style={{ ...type.subhead, color: c.accentInk, fontWeight: '600' }}>{lookingUp ? 'Type the word instead' : "Don't know the word?"}</Text>
              </Tappable>
            ) : null}
          </Card>
        ) : (
          <Card>
            <Field
              label="Words"
              value={listText}
              onChangeText={(t) => { setListText(t); setProblem(null); }}
              multiline
              autoCorrect={false}
              autoCapitalize="none"
              keyboardLanguage={speechTag}
            />
            <View style={{ flexDirection: 'row' }}>
              <Chip label="Paste" selected={false} onPress={() => { void paste(); }} />
            </View>
          </Card>
        )}

        {lookingUp && found ? (
          <FoundWords
            found={found}
            language={language}
            added={new Set(words.map((w) => w.entry))}
            onAdd={(w) => { haptic.tap(); setWords((list) => addWord(list, { entry: w.entry, meaning: w.meaning })); }}
          />
        ) : null}
        {lookingUp && lookupBusy ? <Help>Looking it up…</Help> : null}

        {mode === 'one' && words.length ? (
          <Group>
            {words.map((w, i) => (
              <WordRow
                key={w.entry}
                word={w}
                first={i === 0}
                state={states[i]}
                filled={filled}
                language={language}
                inDeck={collection.inDeck(deck, model, w)}
                refusal={refused[w.entry]}
                onRemove={() => remove(w.entry)}
                onAnyway={() => addAnyway(w.entry)}
              />
            ))}
          </Group>
        ) : null}

        {mode === 'list' ? <ListNotes words={shown} states={states} repeated={listed.repeated} language={language} inDeck={(e) => collection.inDeck(deck, model, { entry: e, meaning: '' })} /> : null}
        {tooMany ? <ErrorNote message={`That's ${toAdd.length} words. Add up to ${MAX_QUEUED} at a time.`} /> : null}
        {problem ? <ErrorNote message={problem} /> : null}

        <Help>
          {filled
            ? mode === 'one'
              ? "Return adds the word. Add your own meaning after a dash, e.g. kot - cat. Not sure of the spelling? Type it how it sounds. Claude fills in the rest, and you check each note before it's added."
              : "One word or phrase per line. To use your own meaning, add it after a dash. Claude fills in everything else, and you check each note before it's added to the deck."
            : mode === 'one'
              ? `Return moves to the meaning, then adds the word. The notes are added to ${deckShortName(deck)} when you tap Add.`
              : `One word per line, with its meaning after a dash, e.g. kot - cat. The notes are added to ${deckShortName(deck)} when you tap Add.`}
        </Help>
      </ScrollView>
    </Screen>
  );
}

/** What a word's row says under it, by where it stands. */
function stateLine(word: QuickWord, state: WordState, filled: boolean, language: string | undefined, inDeck: string | undefined): string {
  switch (state) {
    case 'inDeck': return `Already in ${deckShortName(inDeck ?? '')}.`;
    case 'spell': return `In Latin letters. Claude finds how it's spelled in ${language ?? "the deck's language"}.`;
    case 'needsMeaning': return 'Needs a meaning.';
    case 'needsScript': return `Type it in ${language ? `${language} letters` : 'its own script'}, or turn on Read & Listen to have Claude spell it.`;
    case 'add': return filled ? (word.meaning ? `${word.meaning} (your meaning)` : 'Claude writes the meaning') : word.meaning;
  }
}

function WordRow({ word, first, state, filled, language, inDeck, refusal, onRemove, onAnyway }: {
  word: QuickWord;
  first: boolean;
  state: WordState;
  filled: boolean;
  language: string | undefined;
  inDeck: string | undefined;
  refusal?: string;
  onRemove: () => void;
  onAnyway: () => void;
}) {
  const c = useTheme();
  const line = refusal ?? stateLine(word, state, filled, language, inDeck);
  const color = refusal || state === 'needsMeaning' || state === 'needsScript' ? c.danger : state === 'inDeck' ? c.warningInk : c.textSecondary;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: MIN_TAP + space.m, paddingLeft: space.l }}>
      {first ? null : <Divider inset={space.l} />}
      <View style={{ flex: 1, gap: 2, paddingVertical: space.s }}>
        <Text style={{ ...withThaiLineHeight(type.body, word.entry), color: c.text }}>{word.entry}</Text>
        {line ? <Text style={{ ...type.footnote, color }}>{line}</Text> : null}
        {state === 'inDeck' && !refusal ? (
          <Tappable onPress={onAnyway} accessibilityRole="button" accessibilityLabel={`Add ${word.entry} anyway`} style={{ alignSelf: 'flex-start', paddingVertical: space.xs }}>
            <Text style={{ ...type.footnote, color: c.accentInk, fontWeight: '600' }}>Add anyway</Text>
          </Tappable>
        ) : null}
      </View>
      <Tappable
        onPress={() => { haptic.tap(); onRemove(); }}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${word.entry}`}
        style={{ width: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="xmark" size={14} color={c.textSecondary} />
      </Tappable>
    </View>
  );
}

/** Under a pasted list: what won't be added and why, and how many Claude will spell. Nothing is dropped unsaid. */
function ListNotes({ words, states, repeated, language, inDeck }: {
  words: QuickWord[];
  states: WordState[];
  repeated: number;
  language: string | undefined;
  inDeck: (entry: string) => string | undefined;
}) {
  const of = (s: WordState) => words.filter((_, i) => states[i] === s).map((w) => w.entry);
  const there = of('inDeck');
  const meaningless = of('needsMeaning');
  const latin = of('needsScript');
  const spelled = of('spell').length;
  const lines = [
    ...there.map((e) => `${e} is already in ${deckShortName(inDeck(e) ?? '')}, so it won't be added.`),
    ...(meaningless.length ? [`${meaningless.join(', ')} ${meaningless.length === 1 ? 'needs a meaning' : 'need meanings'}. Add one after a dash, e.g. ${meaningless[0]} - meaning.`] : []),
    ...(latin.length ? [`${latin.join(', ')} ${latin.length === 1 ? 'is' : 'are'} in Latin letters, so ${latin.length === 1 ? "it isn't" : "they aren't"} added. Type ${latin.length === 1 ? 'it' : 'them'} in ${language ? `${language} letters` : "the deck's own script"}, or turn on Read & Listen to have Claude spell ${latin.length === 1 ? 'it' : 'them'}.`] : []),
    ...(repeated ? [`${repeated === 1 ? '1 repeated line was' : `${repeated} repeated lines were`} left out.`] : []),
  ];
  return (
    <View style={{ gap: space.s }}>
      {lines.map((l) => <ErrorNote key={l} message={l} />)}
      {spelled ? <Help>{`${spelled === 1 ? '1 word is' : `${spelled} words are`} in Latin letters. Claude finds how ${spelled === 1 ? "it's" : 'each is'} spelled.`}</Help> : null}
    </View>
  );
}

/** The words Claude found for a meaning; + puts one on the list. */
function FoundWords({ found, language, added, onAdd }: {
  found: { meaning: string; words: FoundWord[] };
  language: string | undefined;
  added: Set<string>;
  onAdd: (word: FoundWord) => void;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: space.s }}>
      <Text style={{ ...type.overline, color: c.textSecondary }}>{`${language ?? 'Words'} for “${found.meaning}”`}</Text>
      <Group>
        {found.words.map((w, i) => {
          const on = added.has(w.entry);
          return (
            <Tappable
              key={w.entry}
              onPress={() => { if (!on) onAdd(w); }}
              accessibilityRole="button"
              accessibilityLabel={on ? `${w.entry}, added` : `Add ${w.entry}, ${w.meaning}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: MIN_TAP + space.m, paddingVertical: space.s, paddingHorizontal: space.l }}
            >
              {i === 0 ? null : <Divider inset={space.l} />}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ ...withThaiLineHeight(type.body, w.entry), color: c.text }}>{w.entry}</Text>
                <Text style={{ ...type.footnote, color: c.textSecondary }}>{w.note ? `${w.meaning} (${w.note})` : w.meaning}</Text>
              </View>
              <Icon name={on ? 'checkmark.circle.fill' : 'plus.circle'} size={22} color={c.accent} />
            </Tappable>
          );
        })}
      </Group>
    </View>
  );
}
