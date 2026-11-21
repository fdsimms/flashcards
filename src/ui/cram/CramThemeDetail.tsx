import { Stack } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { markWords, themeDeckWords, type ThemeWord } from '../../core/cramThemes';
import { failureText } from '../../core/failure';
import type { Repo } from '../../db/repo';
import type { CramTheme, Language } from '../../reader/api';
import { scaledFontSize, talkTextStyle, type TextSize } from '../../reader/fonts';
import { LANGUAGES } from '../../reader/languages';
import { haptic } from '../haptics';
import { Button, Card, Field, Group, Help, Icon, NavRow, Screen, Tappable } from '../kit';
import { radius, readable, space, type, useTheme } from '../theme';
import { usePhoneSpeech } from '../usePhoneSpeech';
import { talkSizeMenu, useTalkSize } from './talkSize';
import { setThemeState, useThemeState } from './themeStore';

type AddWords = (language: Language, deck: string, entries: { entry: string; meaning: string }[]) => Promise<'queued' | 'held' | undefined>;

/**
 * One theme from the ideas (CramThemes): the words of yours it uses, common words you lack with a +
 * to send each to Claude through the note queue (saving the note in the editor is the approval),
 * and questions to steer the lesson with, each read aloud when tapped. "Things to say" is the
 * story, the same screen with `view="story"`. Use theme adds the theme to the cram it was asked for
 * (its questions and story, and its words), and says so if it can't.
 */
export function CramThemeDetail({ repo, index, view, decks, add, onStory, onRehearse, onUse }: {
  repo: Repo;
  index: number;
  view: 'theme' | 'story';
  /** The decks Read & Listen has, to send a word to the one for the theme's language. */
  decks: { deck: string; language: Language }[];
  add: AddWords;
  onStory: () => void;
  /** Opens Situations on the theme: its title is the scene and its deck words are worked in. */
  onRehearse: (language: Language, scene: string, words: { text: string; english: string }[]) => void;
  /** Keeps the theme on its cram and adds its deck words; the screen says so if this throws. */
  onUse: (theme: CramTheme, words: ThemeWord[]) => Promise<void>;
}) {
  const { suggested } = useThemeState();
  const theme = suggested?.themes[index];
  const [size, chooseSize] = useTalkSize();
  const toolbar = (
    <Stack.Toolbar placement="right">
      {talkSizeMenu(size, chooseSize)}
      <Stack.Toolbar.Button accessibilityLabel="Use this theme" disabled={!theme} onPress={() => {
        if (!suggested || !theme) return;
        haptic.tap();
        onUse(theme, suggested.words).catch((e) => Alert.alert("Couldn't use the theme", failureText(e, { next: 'Try again.' })));
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
    ? <Story repo={repo} theme={theme} language={suggested.language} words={themeDeckWords(theme, suggested.words).map((w) => w.text)} size={size} toolbar={toolbar} />
    : <Theme repo={repo} theme={theme} language={suggested.language} words={themeDeckWords(theme, suggested.words)} size={size} deck={deck} add={add} onStory={onStory} onRehearse={() => onRehearse(suggested.language, theme.title, themeDeckWords(theme, suggested.words))} toolbar={toolbar} />;
}

function Theme({ repo, theme, language, words, size, deck, add, onStory, onRehearse, toolbar }: {
  repo: Repo;
  theme: CramTheme;
  language: Language;
  words: { text: string; english: string }[];
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
  return (
    <Screen title={theme.title} largeTitle={false} toolbar={toolbar}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l, gap: space.m }}>
        {theme.why ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{theme.why}</Text> : null}
        {words.length ? (
          <Card>
            <Text style={{ ...type.footnote, color: c.textSecondary, fontWeight: '600' }}>{`YOUR WORDS · ${words.length}`}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {words.map((w) => (
                <View key={w.text} style={{ backgroundColor: c.fill, borderRadius: radius.s, paddingVertical: space.xs + 1, paddingHorizontal: space.s + 1, flexDirection: 'row', alignItems: 'baseline', gap: space.xs + 2 }}>
                  <Text style={{ ...talkTextStyle(info, size, 0.75), color: c.text }}>{w.text}</Text>
                  <Text style={{ ...type.footnote, color: c.textSecondary }}>{w.english}</Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}
        {theme.new_words.length ? (
          <Card>
            <Text style={{ ...type.footnote, color: c.textSecondary, fontWeight: '600' }}>{`WORTH LEARNING · ${theme.new_words.length} NEW`}</Text>
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
          <Text style={{ ...type.footnote, color: c.textSecondary, fontWeight: '600' }}>QUESTIONS TO ASK</Text>
          {theme.questions.map((q) => (
            <Tappable key={q.text} onPress={() => phone.sayLine(q.text, info.speech, false)} accessibilityRole="button" accessibilityLabel={`Hear ${q.text}`} style={{ gap: 2, paddingVertical: space.xs }}>
              <Text style={{ ...talkTextStyle(info, size), color: c.text }}>{q.text}</Text>
              <Text style={{ ...type.footnote, fontSize: scaledFontSize(type.footnote.fontSize, size), color: c.textSecondary }}>{q.english}</Text>
            </Tappable>
          ))}
        </Card>
        <Group>
          {theme.story ? <NavRow first icon={{ name: 'text.bubble', color: c.accent }} label="Things to say" detail="A short story to tell, from your words." onPress={() => { haptic.tap(); onStory(); }} /> : null}
          <NavRow first={!theme.story} icon={{ name: 'bubble.left.and.bubble.right', color: c.accent }} label="Rehearse" detail="Talk it through with Claude." onPress={() => { haptic.tap(); onRehearse(); }} />
        </Group>
      </ScrollView>
    </Screen>
  );
}

function Story({ repo, theme, language, words, size, toolbar }: {
  repo: Repo;
  theme: CramTheme;
  language: Language;
  /** The deck words of the theme, marked where the story uses them. */
  words: string[];
  size: TextSize;
  toolbar: React.ReactNode;
}) {
  const c = useTheme();
  const phone = usePhoneSpeech(repo);
  const { suggested } = useThemeState();
  const info = LANGUAGES[language];
  const story = theme.story;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(story?.text ?? '');
  const runs = useMemo(() => (story ? markWords(story.text, words) : []), [story, words]);
  if (!story || !suggested) return <Screen title="Things to say" largeTitle={false}><ScrollView contentContainerStyle={{ ...readable, padding: space.l }}><Help>This theme has no story.</Help></ScrollView></Screen>;

  // The edited story goes back into the theme, so Use theme takes it. Its English is dropped: it no longer matches.
  const finish = () => {
    haptic.tap();
    const text = draft.replace(/\s+/g, ' ').trim();
    if (text && text !== story.text) {
      setThemeState({ suggested: { ...suggested, themes: suggested.themes.map((t) => (t === theme ? { ...t, story: { text, english: '' } } : t)) } });
    } else {
      setDraft(story.text);
    }
    setEditing(false);
  };
  return (
    <Screen title="Things to say" largeTitle={false} toolbar={toolbar}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ ...readable, padding: space.l, gap: space.m }}>
        <Card>
          <Text style={{ ...type.footnote, color: c.textSecondary, fontWeight: '600' }}>{theme.title.toUpperCase()}</Text>
          {editing ? (
            <Field label="Your version" value={draft} onChangeText={setDraft} multiline autoFocus keyboardLanguage={language} />
          ) : (
            <Text style={{ ...talkTextStyle(info, size, 1), color: c.text }}>
              {runs.map((r, i) => (r.marked ? <Text key={i} style={{ backgroundColor: c.accentFill, color: c.accentInk }}>{r.text}</Text> : r.text))}
            </Text>
          )}
          {!editing && story.english ? <Text style={{ ...type.subhead, fontSize: scaledFontSize(type.subhead.fontSize, size), color: c.textSecondary }}>{story.english}</Text> : null}
          {!editing && words.length ? <Help>The highlighted words are from your deck.</Help> : null}
        </Card>
        {editing ? <Button label="Done" onPress={finish} /> : <Button label="Edit the story" variant="secondary" onPress={() => { haptic.tap(); setDraft(story.text); setEditing(true); }} />}
        {!editing ? <Button label="Listen" variant="secondary" onPress={() => { haptic.tap(); phone.sayLine(story.text, info.speech, false); }} /> : null}
        <Help>Change the story to what you'd really say, then practice saying it aloud.</Help>
      </ScrollView>
    </Screen>
  );
}
