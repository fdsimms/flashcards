import * as Speech from 'expo-speech';
import { Stack } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Repo } from '../../db/repo';
import type { Language } from '../../reader/api';
import { LANGUAGES, flaggedName } from '../../reader/languages';
import type { Phrase } from '../../tools/phrase';
import type { ToolPrefs } from '../../tools/prefs';
import { loadToolPrefs, saveToolPrefs, toolPrefs } from '../../tools/storage';
import { toolLanguage, type ToolInfo } from '../../tools/tools';
import { haptic } from '../haptics';
import { Button, Card, Chip, Help, Icon, Screen, Tappable } from '../kit';
import { Reveal } from '../motion';
import { MIN_TAP, space, type, useTheme } from '../theme';
import { useKeyboardScroll } from '../useKeyboardScroll';
import { PlayPill } from '../PlayButton';
import { usePhoneSpeech } from '../usePhoneSpeech';

/**
 * What every Practice tool's screen shares: the language menu in the header, Randomize and Show
 * answer at the bottom (Missed it and Got it once the answer is showing), and the answer card
 * (the usual way to say it, read aloud in the voice chosen in Settings, Voices; other ways it's
 * said; a last form such as the formal or written one). A tool's screen gives only what's in
 * between.
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

/**
 * Whether the answer is showing, and reading it aloud: showing it reads it once. Once it's marked
 * Missed it, `missed` keeps it up with the rule behind it (rules.ts) until Next.
 */
export function useAnswer(repo: Repo, language: Language) {
  const speech = usePhoneSpeech(repo);
  const [shown, setShown] = useState(false);
  const [missed, setMissed] = useState(false);
  useEffect(() => () => { Speech.stop(); }, []);
  return useMemo(() => {
    const speak = (p: Phrase) => { Speech.stop(); speech.sayWord(p.text, LANGUAGES[language].speech); };
    return {
      shown,
      missed,
      speak,
      /** Hides it again: the question changed. */
      hide: () => { Speech.stop(); setShown(false); setMissed(false); },
      /** Show answer: shows it and reads `first` aloud. */
      show: (first: Phrase | undefined) => {
        setShown(true);
        if (first) speak(first);
      },
      /** Missed it, with a rule to show: the answer stays up, the rule under it. */
      miss: () => setMissed(true),
    };
  }, [shown, missed, speech, language]);
}

/** The footer once Missed it has kept the answer up to show its rule: only Next. */
export const nextOnly = (next: () => void): ToolActions => ({ primary: { label: 'Next', onPress: next } });

/** The footer's two buttons when a tool needs other than Randomize and Show answer (a quiz's Check, Try again, Next). No `secondary` leaves the primary button the whole width. */
export interface ToolActions {
  secondary?: { label: string; onPress: () => void };
  primary: { label: string; onPress: () => void; disabled?: boolean };
}

export function ToolScreen({ tool, language, onLanguage, shown, onRandomize, onShow, onMark, actions, children }: {
  tool: ToolInfo;
  language: Language;
  onLanguage: (l: Language) => void;
  shown: boolean;
  onRandomize: () => void;
  onShow: () => void;
  /**
   * Once the answer is showing, Missed it and Got it take the footer's place: each marks the answer
   * (useMarks) and moves on, except a miss with a rule to show (`nextOnly` then replaces them).
   */
  onMark: (right: boolean) => void;
  /** Replaces the footer's Randomize and Show answer. */
  actions?: ToolActions;
  children: React.ReactNode;
}) {
  // The keyboard's height pads the whole screen, not just the list, so Check and Next in the footer
  // stay above it: the number and decimal pads have no Return key to submit with.
  const { scrollProps, bottomPadding: keyboard } = useKeyboardScroll();
  const insets = useSafeAreaInsets();
  const name = LANGUAGES[language].name;
  return (
    <View style={{ flex: 1, paddingBottom: Math.max(0, keyboard - insets.bottom) }}>
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
          ) : shown ? (
            <>
              <Button variant="secondary" label="Missed it" style={{ flex: 1 }} onPress={() => onMark(false)} />
              <Button label="Got it" style={{ flex: 1 }} onPress={() => onMark(true)} />
            </>
          ) : (
            <>
              <Button variant="secondary" label="Randomize" style={{ flex: 1 }} onPress={onRandomize} />
              <Button label="Show answer" style={{ flex: 1 }} onPress={onShow} />
            </>
          )}
        </View>
      )}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l, gap: space.l }} keyboardShouldPersistTaps="handled" {...scrollProps}>
        <ToolLanguage.Provider value={language}>{children}</ToolLanguage.Provider>
      </ScrollView>
    </Screen>
    </View>
  );
}

/** A small all-caps label over a tool's control, as over a group of rows. */
export function ControlLabel({ children }: { children: string }) {
  const c = useTheme();
  return <Text accessibilityRole="header" style={{ ...type.overline, color: c.textSecondary, paddingHorizontal: space.xs }}>{children}</Text>;
}

/** A tool's mode, or another choice among a few, as a labelled row of chips under the exercise ("Answer by", "Practice"). */
export function ChipChoice<T extends string | number>({ label, options, value, onChange }: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={{ gap: space.s }}>
      <ControlLabel>{label}</ControlLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {options.map((o) => <Chip key={o.value} label={o.label} selected={value === o.value} onPress={() => { if (o.value !== value) onChange(o.value); }} />)}
      </View>
    </View>
  );
}

/** How an answer went, the same in every Practice quiz: a symbol, then "Right." or "Not quite. It's …". */
export function Status({ tone, children }: { tone: 'good' | 'warn' | 'bad'; children: string }) {
  const c = useTheme();
  const color = tone === 'good' ? c.countDue : tone === 'warn' ? c.warning : c.danger;
  const name = tone === 'good' ? 'checkmark.circle.fill' : tone === 'warn' ? 'exclamationmark.circle.fill' : 'xmark.circle.fill';
  return (
    <View accessible accessibilityRole="text" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}>
      <Icon name={name} size={20} color={color} />
      <Text style={{ ...type.headline, color, flex: 1 }}>{children}</Text>
    </View>
  );
}

export interface Answer {
  everyday: Phrase;
  also: Phrase[];
  /** The last section: its heading ("Formal", "As written") and what it holds; none when the question already shows it. */
  last?: { title: string; phrase: Phrase };
}

/** The answer, or until it's shown, `prompt` saying what to do; after a miss, the `rule` behind it. */
export function AnswerCard({ shown, prompt, answer, rule, onPlay }: {
  shown: boolean;
  prompt: string;
  answer: Answer | undefined;
  rule?: string;
  onPlay: (p: Phrase) => void;
}) {
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
          {rule ? <RuleLine rule={rule} /> : null}
          {answer.also.length ? <Ways title="Also said" phrases={answer.also} onPlay={onPlay} /> : null}
          {answer.last ? <Ways title={answer.last.title} phrases={[answer.last.phrase]} onPlay={onPlay} /> : null}
        </Reveal>
      )}
    </Card>
  );
}

/** The rule behind an answer (rules.ts), shown after a miss: why it's said this way. */
export function RuleLine({ rule }: { rule: string }) {
  const c = useTheme();
  return (
    <View accessible accessibilityRole="text" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}>
      <Icon name="lightbulb" size={16} color={c.textSecondary} />
      <Text selectable style={{ ...type.subhead, color: c.text, flex: 1 }}>{rule}</Text>
    </View>
  );
}

/** The language a Practice tool is in, for the play buttons below its ToolScreen. */
const ToolLanguage = React.createContext<Language | null>(null);

/** The play button beside a phrase, with a link to the language's voice. `label` says what it plays, for VoiceOver ("Play the answer"). */
export function PlayButton({ label, onPress }: { label: string; onPress: () => void }) {
  const language = React.useContext(ToolLanguage);
  return <PlayPill label={label} onPlay={onPress} speech={language ? LANGUAGES[language].speech : undefined} />;
}

/** Other ways to say it, under a small heading: each tappable to hear it, with a speaker at its end to say so. */
export function Ways({ title, phrases, onPlay }: { title: string; phrases: Phrase[]; onPlay: (p: Phrase) => void }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.s, borderTopWidth: 0.5, borderTopColor: c.border, paddingTop: space.m }}>
      <Text style={{ ...type.overline, color: c.textSecondary }}>{title}</Text>
      {phrases.map((p) => (
        <Tappable
          key={p.text}
          onPress={() => { haptic.tap(); onPlay(p); }}
          accessibilityRole="button"
          accessibilityLabel={`Play ${[p.text, p.roman, p.note].filter(Boolean).join(', ')}`}
          scaleTo={0.99}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: MIN_TAP }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ ...type.body, color: c.text }}>{p.text}</Text>
            {p.roman || p.note ? (
              <Text style={{ ...type.footnote, color: c.textSecondary }}>{[p.roman, p.note].filter(Boolean).join(' · ')}</Text>
            ) : null}
          </View>
          <Icon name="speaker.wave.2.fill" size={16} color={c.accent} />
        </Tappable>
      ))}
    </View>
  );
}
