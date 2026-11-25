import * as Speech from 'expo-speech';
import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Repo } from '../../db/repo';
import { japaneseFont, withThaiLineHeight } from '../../core/script';
import type { Language } from '../../reader/api';
import { LANGUAGES, flaggedName } from '../../reader/languages';
import { FLAG_IMAGES } from '../flagImages';
import type { Phrase } from '../../tools/phrase';
import type { ToolPrefs } from '../../tools/prefs';
import { loadToolPrefs, saveToolPrefs, toolPrefs } from '../../tools/storage';
import { toolLanguage, type ToolInfo } from '../../tools/tools';
import { haptic } from '../haptics';
import { Button, Card, Chip, Help, Icon, Screen, Tappable } from '../kit';
import { Reveal } from '../motion';
import { hairline, MIN_TAP, space, type, useTheme, readable } from '../theme';
import { useFont } from '../AppFont';
import { useKeyboardScroll } from '../useKeyboardScroll';
import { PlayPill } from '../PlayButton';
import { stopSpeechIfRunning, usePhoneSpeech } from '../usePhoneSpeech';

/**
 * What every Practice tool's screen shares: the language menu in the header, Another one and Show
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
    const speak = (p: Phrase) => { void stopSpeechIfRunning().then(() => speech.sayWord(p.text, LANGUAGES[language].speech)); };
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

/** The footer's two buttons when a tool needs other than Another one and Show answer (a quiz's Check, Try again, Next). No `secondary` leaves the primary button the whole width. */
export interface ToolActions {
  secondary?: { label: string; onPress: () => void };
  primary: { label: string; onPress: () => void; disabled?: boolean };
}

export function ToolScreen({ tool, language, onLanguage, shown, onRandomize, onShow, onMark, actions, menu, footer, fill, lockGesture, children }: {
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
  /** Replaces the footer's Another one and Show answer. */
  actions?: ToolActions;
  /**
   * The tool's own options, as `Stack.Toolbar.Menu inline` sections in an array (a Fragment isn't
   * flattened by the toolbar): the gear then opens a menu of them and Practice settings, so the
   * header keeps its two buttons and the title its room. A card tool keeps its options off the card.
   */
  menu?: React.ReactNode[];
  /** Replaces the whole footer, for a card tool whose buttons are its own (PracticeCard.tsx). */
  footer?: React.ReactNode;
  /** The tool is one card that fills the screen between the header and the footer, as Review's does, instead of a scrolling column. */
  fill?: boolean;
  /** Turns off the screen's swipe back, for a card that is swiped sideways. */
  lockGesture?: boolean;
  children: React.ReactNode;
}) {
  // The keyboard's height pads the whole screen, not just the list, so Check and Next in the footer
  // stay above it: the number and decimal pads have no Return key to submit with.
  const { scrollProps, bottomPadding: keyboard } = useKeyboardScroll();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const name = LANGUAGES[language].name;
  const openSettings = () => router.push({ pathname: '/settings-page', params: { page: 'practice' } });
  return (
    <View style={{ flex: 1, paddingBottom: Math.max(0, keyboard - insets.bottom) }}>
    <Screen
      title={tool.title}
      largeTitle={false}
      toolbar={(
        <Stack.Toolbar placement="right">
          {tool.languages.length > 1 ? <Stack.Toolbar.Menu title="Language" icon={FLAG_IMAGES[language]} iconRenderingMode="original" accessibilityLabel={`Language: ${name}. Change the language`}>
            {tool.languages.map((l) => (
              <Stack.Toolbar.MenuAction key={l} isOn={l === language} onPress={() => onLanguage(l)}>{flaggedName(l)}</Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu> : null}
          {menu?.length ? (
            <Stack.Toolbar.Menu icon="gearshape" accessibilityLabel="Options and settings">
              {menu}
              <Stack.Toolbar.Menu inline>
                <Stack.Toolbar.MenuAction icon="gearshape" onPress={openSettings}>Practice settings</Stack.Toolbar.MenuAction>
              </Stack.Toolbar.Menu>
            </Stack.Toolbar.Menu>
          ) : <Stack.Toolbar.Button icon="gearshape" accessibilityLabel="Practice settings" onPress={openSettings} />}
        </Stack.Toolbar>
      )}
      lockGesture={lockGesture}
      footer={footer ?? (
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
              <Button variant="secondary" label="Another one" style={{ flex: 1 }} onPress={onRandomize} />
              <Button label="Show answer" style={{ flex: 1 }} onPress={onShow} />
            </>
          )}
        </View>
      )}
    >
      {fill ? (
        <View style={{ flex: 1 }}><ToolLanguage.Provider value={language}>{children}</ToolLanguage.Provider></View>
      ) : (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l, gap: space.l }} keyboardShouldPersistTaps="handled" {...scrollProps}>
          <ToolLanguage.Provider value={language}>{children}</ToolLanguage.Provider>
        </ScrollView>
      )}
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

/**
 * How an answer went, the same in every Practice quiz: a symbol, then "Right.", or after a miss "Incorrect. It's …"
 * for a pick among a few choices (right or not, nothing in between) and "Not quite. It's …" for a typed or spoken answer, which can be partly right.
 */
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
  return (
    <Card style={{ minHeight: 120 }}>
      {!shown || !answer ? <Help>{prompt}</Help> : <AnswerContent answer={answer} rule={rule} onPlay={onPlay} />}
    </Card>
  );
}

/**
 * What an answer shows: the usual way to say it, its rule after a miss, other ways, a last form.
 * `centered` is for a card's back (PracticeCard.tsx), where the corner's play button plays the
 * main answer, so the row has none of its own.
 */
export function AnswerContent({ answer, rule, onPlay, centered }: { answer: Answer; rule?: string; onPlay: (p: Phrase) => void; centered?: boolean }) {
  const c = useTheme();
  const ja = useJapaneseFont();
  return (
    <Reveal style={{ gap: space.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
        <View style={{ flex: 1, gap: space.xs }}>
          <Text selectable style={{ ...withThaiLineHeight(type.cardBack, answer.everyday.text), color: c.text, textAlign: centered ? 'center' : 'left', ...ja(answer.everyday.text) }}>{answer.everyday.text}</Text>
          {answer.everyday.roman ? <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: centered ? 'center' : 'left', ...ja(answer.everyday.roman) }}>{answer.everyday.roman}</Text> : null}
        </View>
        {centered ? null : <PlayButton label="Play the answer" onPress={() => onPlay(answer.everyday)} />}
      </View>
      {rule ? <RuleLine rule={rule} /> : null}
      {answer.also.length ? <Ways title="Also said" phrases={answer.also} onPlay={onPlay} /> : null}
      {answer.last ? <Ways title={answer.last.title} phrases={[answer.last.phrase]} onPlay={onPlay} /> : null}
    </Reveal>
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

/** Japanese's face for a phrase of the tool's language (script.ts): a time or a price can be all kanji. */
function useJapaneseFont() {
  const language = React.useContext(ToolLanguage);
  const font = useFont();
  return (text: string) => japaneseFont(text, language === 'ja' ? 'ja' : undefined, font);
}

/** The play button beside a phrase, with a link to the language's voice. `label` says what it plays, for VoiceOver ("Play the answer"). */
export function PlayButton({ label, onPress }: { label: string; onPress: () => void }) {
  const language = React.useContext(ToolLanguage);
  return <PlayPill label={label} onPlay={onPress} speech={language ? LANGUAGES[language].speech : undefined} />;
}

/** Other ways to say it, under a small heading: each tappable to hear it, with a speaker at its end to say so. */
export function Ways({ title, phrases, onPlay }: { title: string; phrases: Phrase[]; onPlay: (p: Phrase) => void }) {
  const c = useTheme();
  const ja = useJapaneseFont();
  return (
    <View style={{ gap: space.s, borderTopWidth: hairline, borderTopColor: c.border, paddingTop: space.m }}>
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
          <View style={{ flex: 1, gap: space.xs }}>
            <Text style={{ ...withThaiLineHeight(type.body, p.text), color: c.text, ...ja(p.text) }}>{p.text}</Text>
            {p.roman || p.note ? (
              <Text style={{ ...type.footnote, color: c.textSecondary, ...ja(p.roman ?? '') }}>{[p.roman, p.note].filter(Boolean).join(' · ')}</Text>
            ) : null}
          </View>
          <Icon name="speaker.wave.2.fill" size={16} color={c.accent} />
        </Tappable>
      ))}
    </View>
  );
}
