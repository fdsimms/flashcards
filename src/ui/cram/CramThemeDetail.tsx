import { Stack } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import type { CramLine } from '../../core/cram';
import { markWords, type ThemeWord } from '../../core/cramThemes';
import { failureText } from '../../core/failure';
import type { Repo } from '../../db/repo';
import type { CramTheme, Language, WritingCheck } from '../../reader/api';
import { scaledFontSize, talkTextStyle, type TextSize } from '../../reader/fonts';
import { LANGUAGES } from '../../reader/languages';
import { haptic } from '../haptics';
import { Button, Card, Group, Help, Icon, NavRow, Screen, Tappable } from '../kit';
import { radius, readable, space, type, useTheme } from '../theme';
import { usePhoneSpeech } from '../usePhoneSpeech';
import { StoryEditor } from './StoryEditor';
import { TalkLine } from './TalkLine';
import { talkSizeMenu, useTalkSize } from './talkSize';
import { setThemeState, useThemeState } from './themeStore';

type AddWords = (language: Language, deck: string, entries: { entry: string; meaning: string }[]) => Promise<'queued' | 'held' | undefined>;

/**
 * One theme from the ideas (CramThemes): the words of yours it uses (the ones already in this cram in
 * gold), words you lack with a + to send each to Claude through the note queue (saving the note in the
 * editor is the approval), the questions you ask and the ones the tutor may ask with your answer, each
 * read aloud when tapped, with a word you haven't studied underlined. "Your story" is the story, the
 * same screen with `view="story"`, where it can be changed (Claude checks it). Use theme adds the theme
 * to the cram it was asked for (its questions, answers and story, and its words), and says so if it can't.
 */
export function CramThemeDetail({ repo, index, view, decks, add, check, onStory, onRehearse, onUse }: {
  repo: Repo;
  index: number;
  view: 'theme' | 'story';
  /** The decks Read & Listen has, to send a word to the one for the theme's language. */
  decks: { deck: string; language: Language }[];
  add: AddWords;
  /** Read & Listen's writing check of an edited story (`story` is the one it replaces). */
  check: (language: Language, attempt: string, story: CramLine) => Promise<WritingCheck>;
  onStory: () => void;
  /** Opens Situations on the theme: its title is the scene, its words are worked in and the tutor steers by its questions. */
  onRehearse: (language: Language, theme: CramTheme, words: ThemeWord[]) => void;
  /** Keeps the theme on its cram and tags its words (`noteIds`); the screen says so if this throws. */
  onUse: (theme: CramTheme, noteIds: string[]) => Promise<void>;
}) {
  const { suggested } = useThemeState();
  const theme = suggested?.themes[index];
  const words = suggested?.wordsOf[index] ?? [];
  const [size, chooseSize] = useTalkSize();
  const toolbar = (
    <Stack.Toolbar placement="right">
      {talkSizeMenu(size, chooseSize)}
      <Stack.Toolbar.Button accessibilityLabel="Use this theme" disabled={!theme} onPress={() => {
        if (!theme) return;
        haptic.tap();
        onUse(theme, words.map((w) => w.noteId)).catch((e) => Alert.alert("Couldn't use the theme", failureText(e, { next: 'Try again.' })));
      }}>Use theme</Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
  if (!suggested || !theme) {
    return (
      <Screen title="Theme" largeTitle={false}>
        <ScrollView contentContainerStyle={{ ...readable, padding: space.l }}><Help>These ideas are gone. Go back and ask for themes again.</Help></ScrollView>
      </Screen>
    );
  }
  const deck = decks.find((d) => d.language === suggested.language)?.deck;
  return view === 'story'
    ? <Story repo={repo} theme={theme} language={suggested.language} words={words.map((w) => w.text)} size={size} toolbar={toolbar} check={(attempt, story) => check(suggested.language, attempt, story)} />
    : <Theme repo={repo} theme={theme} language={suggested.language} words={words} size={size} deck={deck} add={add} onStory={onStory} onRehearse={() => onRehearse(suggested.language, theme, words)} toolbar={toolbar} />;
}

function Theme({ repo, theme, language, words, size, deck, add, onStory, onRehearse, toolbar }: {
  repo: Repo;
  theme: CramTheme;
  language: Language;
  words: ThemeWord[];
  size: TextSize;
  deck: string | undefined;
  add: AddWords;
  onStory: () => void;
  onRehearse: () => void;
  toolbar: React.ReactNode;
}) {
  const c = useTheme();
  const phone = usePhoneSpeech(repo);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const info = LANGUAGES[language];
  const say = (text: string) => phone.sayLine(text, info.speech, false);
  const unknown = theme.unknown ?? [];
  const expects = theme.expects ?? [];
  const addWord = async (word: string, meaning: string) => {
    if (busy || !deck) return;
    haptic.tap();
    setBusy(word);
    setProblem(undefined);
    try {
      await add(language, deck, [{ entry: word, meaning }]);
      setAdded((prev) => new Set(prev).add(word));
    } catch (e) {
      setProblem(failureText(e, { what: `Couldn't add ${word}.`, next: 'Try again.' }));
    } finally {
      setBusy(undefined);
    }
  };
  const overline = { ...type.footnote, color: c.textSecondary, fontWeight: '600' as const };
  return (
    <Screen title={theme.title} largeTitle={false} toolbar={toolbar}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l, gap: space.m }}>
        {theme.why ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{theme.why}</Text> : null}
        {words.length ? (
          <Card>
            <Text style={overline}>{`YOUR WORDS · ${words.length}`}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {words.map((w) => {
                const mine = w.kind === 'cram';
                return (
                  <View key={w.noteId} style={{ backgroundColor: mine ? c.accentFill : c.fill, borderRadius: radius.s, paddingVertical: space.xs + 1, paddingHorizontal: space.s + 1, flexDirection: 'row', alignItems: 'baseline', gap: space.xs + 2 }}>
                    <Text style={{ ...talkTextStyle(info, size, 0.75), color: mine ? c.accentInk : c.text }}>{w.text}</Text>
                    <Text style={{ ...type.footnote, color: c.textSecondary }}>{w.english}</Text>
                  </View>
                );
              })}
            </View>
            {words.some((w) => w.kind === 'cram') ? <Help>Gold: already in this cram.</Help> : null}
          </Card>
        ) : null}
        {theme.new_words.length ? (
          <Card>
            <Text style={overline}>{`WORTH LEARNING · ${theme.new_words.length} NEW`}</Text>
            {theme.new_words.map((w) => {
              const done = added.has(w.word);
              return (
                <Tappable
                  key={w.word}
                  onPress={() => { void addWord(w.word, w.english); }}
                  disabled={done || !deck || !!busy}
                  accessibilityRole="button"
                  accessibilityLabel={done ? `${w.word} added` : `Add ${w.word}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 44 }}
                >
                  <Text style={{ ...talkTextStyle(info, size, 0.75), color: c.text }}>{w.word}</Text>
                  <Text style={{ ...type.subhead, color: c.textSecondary, flex: 1 }}>{w.english}</Text>
                  <Icon name={done ? 'checkmark.circle.fill' : 'plus.circle'} size={24} color={done ? c.goodInk : deck ? c.accentInk : c.textTertiary} />
                </Tappable>
              );
            })}
            <Help>Claude fills in each word you add. Save each one in the note editor.</Help>
            {problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text> : null}
          </Card>
        ) : null}
        <Card>
          <Text style={overline}>YOU ASK</Text>
          {theme.questions.map((q) => <TalkLine key={q.text} text={q.text} english={q.english} language={language} size={size} unknown={unknown} onSay={say} />)}
          {expects.length ? (
            <>
              <Text style={{ ...overline, paddingTop: space.s }}>THEY MAY ASK YOU</Text>
              {expects.map((e) => (
                <View key={e.question.text}>
                  <TalkLine text={e.question.text} english={e.question.english} language={language} size={size} unknown={unknown} onSay={say} />
                  <View style={{ borderLeftWidth: 3, borderLeftColor: c.accentFill, paddingLeft: space.s + 2, marginTop: 2 }}>
                    <TalkLine text={e.answer.text} english={e.answer.english} language={language} size={size} unknown={unknown} onSay={say} scale={0.9} />
                  </View>
                </View>
              ))}
            </>
          ) : null}
          {unknown.length ? <Help>A dotted word isn't one you've studied yet. Tap it for its meaning.</Help> : null}
        </Card>
        <Group>
          {theme.story ? <NavRow first icon={{ name: 'text.bubble', color: c.accent }} label="Your story" detail="What you'd say about it, from your words." onPress={() => { haptic.tap(); onStory(); }} /> : null}
          <NavRow first={!theme.story} icon={{ name: 'bubble.left.and.bubble.right', color: c.accent }} label="Rehearse" detail="Your tutor asks about it, and you try your answers." onPress={() => { haptic.tap(); onRehearse(); }} />
        </Group>
      </ScrollView>
    </Screen>
  );
}

function Story({ repo, theme, language, words, size, toolbar, check }: {
  repo: Repo;
  theme: CramTheme;
  language: Language;
  /** The deck words of the theme, marked where the story uses them. */
  words: string[];
  size: TextSize;
  toolbar: React.ReactNode;
  check: (attempt: string, story: CramLine) => Promise<WritingCheck>;
}) {
  const c = useTheme();
  const phone = usePhoneSpeech(repo);
  const { suggested } = useThemeState();
  const info = LANGUAGES[language];
  const story = theme.story;
  const [editing, setEditing] = useState(false);
  if (!story || !suggested) return <Screen title="Your story" largeTitle={false}><ScrollView contentContainerStyle={{ ...readable, padding: space.l }}><Help>This theme has no story.</Help></ScrollView></Screen>;
  const runs = markWords(story.text, words);

  // The edited story goes back into the theme, so Use theme takes it; the words marked as unknown were the old story's.
  const save = (line: CramLine) => {
    setThemeState({ suggested: { ...suggested, themes: suggested.themes.map((t) => (t === theme ? { ...t, story: line, unknown: [] } : t)) } });
    setEditing(false);
  };
  return (
    <Screen title="Your story" largeTitle={false} toolbar={toolbar}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ ...readable, padding: space.l, gap: space.m }}>
        {editing ? (
          <StoryEditor story={story} language={language} size={size} check={(attempt) => check(attempt, story)} onSave={save} onCancel={() => setEditing(false)} />
        ) : (
          <>
            <Card>
              <Text style={{ ...type.footnote, color: c.textSecondary, fontWeight: '600' }}>{theme.title.toUpperCase()}</Text>
              <Text style={{ ...talkTextStyle(info, size, 1), color: c.text }}>
                {runs.map((r, i) => (r.marked ? <Text key={i} style={{ backgroundColor: c.accentFill, color: c.accentInk }}>{r.text}</Text> : r.text))}
              </Text>
              {story.english ? <Text style={{ ...type.subhead, fontSize: scaledFontSize(type.subhead.fontSize, size), lineHeight: Math.round(scaledFontSize(type.subhead.fontSize, size) * (type.subhead.lineHeight / type.subhead.fontSize)), color: c.textSecondary }}>{story.english}</Text> : null}
              {words.length ? <Help>The highlighted words are from your deck.</Help> : null}
            </Card>
            <Button label="Edit the story" variant="secondary" onPress={() => { haptic.tap(); setEditing(true); }} />
            <Button label="Listen" variant="secondary" onPress={() => { haptic.tap(); phone.sayLine(story.text, info.speech, false); }} />
            <Help>Change the story to what you'd really say, then practice saying it aloud.</Help>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
