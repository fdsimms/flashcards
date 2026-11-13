import * as Speech from 'expo-speech';
import { Stack } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { Repo } from '../../db/repo';
import type { Language } from '../../reader/api';
import { LANGUAGES, flaggedName } from '../../reader/languages';
import type { Phrase } from '../../tools/phrase';
import type { ToolPrefs } from '../../tools/prefs';
import { loadToolPrefs, saveToolPrefs, toolPrefs } from '../../tools/storage';
import { toolLanguage, type ToolInfo } from '../../tools/tools';
import { haptic } from '../haptics';
import { Button, Card, Help, Icon, Screen, Tappable } from '../kit';
import { Reveal } from '../motion';
import { MIN_TAP, radius, space, type, useTheme } from '../theme';
import { useKeyboardScroll } from '../useKeyboardScroll';
import { usePhoneSpeech } from '../usePhoneSpeech';

/**
 * What every Practice tool's screen shares: the language menu in the header, Randomize and Show
 * answer at the bottom, and the answer card (the usual way to say it, read aloud in the voice
 * chosen in Settings, Voices; other ways it's said; a last form such as the formal or written
 * one). A tool's screen gives only what's in between.
 */

/** The language a tool is practiced in: the one last chosen in any tool, kept between launches. */
export function useToolLanguage(tool: ToolInfo): [Language, (l: Language) => void] {
  const [language, setLanguage] = useState<Language>(() => toolLanguage(tool, toolPrefs().language));
  useEffect(() => {
    let live = true;
    loadToolPrefs().then((p) => { if (live) setLanguage(toolLanguage(tool, p.language)); });
    return () => { live = false; };
  }, [tool]);
  const choose = useCallback((l: Language) => { setLanguage(l); saveToolPrefs({ language: l }); }, []);
  return [language, choose];
}

/** One of a tool's own saved choices (the step for a random time...), kept between launches. */
export function useToolPref<K extends Exclude<keyof ToolPrefs, 'language'>>(key: K): [ToolPrefs[K], (value: ToolPrefs[K]) => void] {
  const [value, setValue] = useState<ToolPrefs[K]>(() => toolPrefs()[key]);
  useEffect(() => {
    let live = true;
    loadToolPrefs().then((p) => { if (live) setValue(p[key]); });
    return () => { live = false; };
  }, [key]);
  const choose = useCallback((v: ToolPrefs[K]) => { setValue(v); saveToolPrefs({ [key]: v } as Partial<ToolPrefs>); }, [key]);
  return [value, choose];
}

/** Whether the answer is showing, and reading it aloud: showing it reads it once. */
export function useAnswer(repo: Repo, language: Language) {
  const speech = usePhoneSpeech(repo);
  const [shown, setShown] = useState(false);
  useEffect(() => () => { Speech.stop(); }, []);
  return useMemo(() => {
    const speak = (p: Phrase) => { Speech.stop(); speech.sayWord(p.text, LANGUAGES[language].speech); };
    return {
      shown,
      speak,
      /** Hides it again: the question changed. */
      hide: () => { Speech.stop(); setShown(false); },
      /** Show answer, or Hide answer when it's showing. */
      toggle: (first: Phrase | undefined) => {
        if (shown) { Speech.stop(); setShown(false); return; }
        setShown(true);
        if (first) speak(first);
      },
    };
  }, [shown, speech, language]);
}

/** The footer's two buttons when a tool needs other than Randomize and Show answer (a quiz's Check, Try again, Next). No `secondary` leaves the primary button the whole width. */
export interface ToolActions {
  secondary?: { label: string; onPress: () => void };
  primary: { label: string; onPress: () => void; disabled?: boolean };
}

export function ToolScreen({ tool, language, onLanguage, shown, onRandomize, onToggle, actions, children }: {
  tool: ToolInfo;
  language: Language;
  onLanguage: (l: Language) => void;
  shown: boolean;
  onRandomize: () => void;
  onToggle: () => void;
  /** Replaces the footer's Randomize and Show answer. */
  actions?: ToolActions;
  children: React.ReactNode;
}) {
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const name = LANGUAGES[language].name;
  return (
    <Screen
      title={tool.title}
      largeTitle={false}
      toolbar={tool.languages.length > 1 ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu title="Language" accessibilityLabel={`Language: ${name}. Change the language`}>
            <Stack.Toolbar.Label>{flaggedName(language)}</Stack.Toolbar.Label>
            {tool.languages.map((l) => (
              <Stack.Toolbar.MenuAction key={l} isOn={l === language} onPress={() => onLanguage(l)}>{flaggedName(l)}</Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : undefined}
      footer={(
        <View style={{ flexDirection: 'row', gap: space.s }}>
          {actions ? (
            <>
              {actions.secondary ? <Button variant="secondary" label={actions.secondary.label} style={{ flex: 1 }} onPress={actions.secondary.onPress} /> : null}
              <Button label={actions.primary.label} style={{ flex: 1 }} onPress={actions.primary.onPress} disabled={actions.primary.disabled} />
            </>
          ) : (
            <>
              <Button variant="secondary" label="Randomize" style={{ flex: 1 }} onPress={onRandomize} />
              <Button label={shown ? 'Hide answer' : 'Show answer'} style={{ flex: 1 }} onPress={onToggle} />
            </>
          )}
        </View>
      )}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l, paddingBottom: space.l + bottomPadding, gap: space.l }} keyboardShouldPersistTaps="handled" {...scrollProps}>
        {children}
      </ScrollView>
    </Screen>
  );
}

/** A small all-caps label over a tool's control, as over a group of rows. */
export function ControlLabel({ children }: { children: string }) {
  const c = useTheme();
  return <Text accessibilityRole="header" style={{ ...type.overline, color: c.textSecondary, paddingHorizontal: space.xs }}>{children}</Text>;
}

export interface Answer {
  everyday: Phrase;
  also: Phrase[];
  /** The last section: its heading ("Formal", "As written") and what it holds; none when the question already shows it. */
  last?: { title: string; phrase: Phrase };
}

/** The answer, or until it's shown, `prompt` saying what to do. */
export function AnswerCard({ shown, prompt, answer, onPlay }: { shown: boolean; prompt: string; answer: Answer | undefined; onPlay: (p: Phrase) => void }) {
  const c = useTheme();
  return (
    <Card style={{ minHeight: 120 }}>
      {!shown || !answer ? (
        <Help>{prompt}</Help>
      ) : (
        <Reveal style={{ gap: space.m }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
            <View style={{ flex: 1, gap: space.xs }}>
              <Text selectable style={{ ...type.cardBack, color: c.text }}>{answer.everyday.text}</Text>
              {answer.everyday.roman ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{answer.everyday.roman}</Text> : null}
            </View>
            <PlayButton label="Play the answer" onPress={() => onPlay(answer.everyday)} />
          </View>
          {answer.also.length ? <Ways title="Also said" phrases={answer.also} onPlay={onPlay} /> : null}
          {answer.last ? <Ways title={answer.last.title} phrases={[answer.last.phrase]} onPlay={onPlay} /> : null}
        </Reveal>
      )}
    </Card>
  );
}

/** The round speaker button beside a phrase. `label` says what it plays, for VoiceOver ("Play the answer"). */
export function PlayButton({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={{ width: 40, height: 40, borderRadius: radius.pill, backgroundColor: c.accentFill, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name="speaker.wave.2.fill" size={18} color={c.accent} />
    </Tappable>
  );
}

/** Other ways to say it, under a small heading: each tappable to hear it. */
export function Ways({ title, phrases, onPlay }: { title: string; phrases: Phrase[]; onPlay: (p: Phrase) => void }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.s, borderTopWidth: 0.5, borderTopColor: c.border, paddingTop: space.m }}>
      <Text style={{ ...type.overline, color: c.textSecondary }}>{title}</Text>
      {phrases.map((p) => (
        <Tappable key={p.text} onPress={() => { haptic.tap(); onPlay(p); }} accessibilityRole="button" accessibilityHint="Plays it" scaleTo={0.99} style={{ gap: 2, minHeight: MIN_TAP, justifyContent: 'center' }}>
          <Text style={{ ...type.body, color: c.text }}>{p.text}</Text>
          {p.roman || p.note ? (
            <Text style={{ ...type.footnote, color: c.textSecondary }}>{[p.roman, p.note].filter(Boolean).join(' · ')}</Text>
          ) : null}
        </Tappable>
      ))}
    </View>
  );
}
