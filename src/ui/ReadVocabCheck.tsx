import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { ApiError, type Api, type CommonCount, type Language, type Settings, type VocabBank } from '../reader/api';
import { LANGUAGES, commonLabel } from '../reader/languages';
import {
  KNOWN_SHARE, QUESTIONS, bandLabel, choicesFor, estimate, nextItem, type Asked, type Reply, type VocabItem,
} from '../reader/vocabCheck';
import { haptic } from './haptics';
import { Button, Card, ErrorNote, Group, Help, Icon, Screen, Tappable } from './kit';
import { radius, smooth, space, type, useTheme } from './theme';

const POLL_MS = 3000;

/**
 * The vocabulary check (reader/vocabCheck.ts): 20 questions on the language's most common words,
 * from the server's bank, that suggest the "Common words counted as known" setting. Answers aren't
 * marked as you go, and nothing here touches the deck or any card: the result is only a suggestion,
 * and the setting changes when you tap Use.
 */
export function ReadVocabCheck({ api, language, current, onSettings, onPlayWord, onDone }: {
  api: Api;
  language: Language;
  /** The language's setting now. */
  current: CommonCount;
  /** The settings as the server has them after the suggestion is used. */
  onSettings: (settings: Settings) => void;
  onPlayWord: (word: string, language: Language) => void;
  onDone: () => void;
}) {
  const c = useTheme();
  const name = LANGUAGES[language].name;
  const [bank, setBank] = useState<VocabBank | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [started, setStarted] = useState(false);
  const [asked, setAsked] = useState<Asked[]>([]);
  const [item, setItem] = useState<VocabItem | null>(null);
  const [saving, setSaving] = useState(false);

  // The server writes the questions the first time, which takes a minute: ask again until they're ready.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await api.vocabCheck(language);
        if (cancelled) return;
        setBank(next);
        setError(null);
        if (next.state === 'preparing') timer = setTimeout(load, POLL_MS);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Couldn't load the questions.");
      }
    };
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [api, language, attempt]);

  const choices = useMemo(() => (item ? choicesFor(item, Math.random) : []), [item]);
  const items = bank?.state === 'ready' ? bank.items : [];
  const finished = started && item === null;

  const begin = () => {
    haptic.tap();
    setAsked([]);
    setItem(nextItem(items, [], Math.random) ?? null);
    setStarted(true);
  };

  const answer = (reply: Reply) => {
    if (!item) return;
    haptic.select();
    const done = [...asked, { item, reply }];
    setAsked(done);
    setItem(done.length >= QUESTIONS ? null : nextItem(items, done, Math.random) ?? null);
  };

  const result = useMemo(() => (finished ? estimate(asked) : null), [finished, asked]);

  const use = async (count: CommonCount) => {
    setSaving(true);
    try {
      onSettings(await api.updateSettings({ common: { [language]: count } }));
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't change the setting. Try again.");
      setSaving(false);
    }
  };

  const scroll = (children: React.ReactNode) => (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
      {children}
    </ScrollView>
  );

  if (error && !result) {
    return <Screen title="Vocabulary check">{scroll(<ErrorNote message={error} onRetry={() => setAttempt((n) => n + 1)} />)}</Screen>;
  }
  if (!bank || bank.state === 'preparing') {
    return (
      <Screen title="Vocabulary check">
        {scroll(
          <>
            <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
            <Help>{`Preparing the ${name} questions. This takes about a minute the first time, and you can leave this screen and come back.`}</Help>
          </>,
        )}
      </Screen>
    );
  }
  if (bank.state !== 'ready') {
    return (
      <Screen title="Vocabulary check">
        {scroll(
          bank.state === 'failed'
            ? <ErrorNote message={`Couldn't write the ${name} questions. Try again in a few minutes.`} onRetry={() => setAttempt((n) => n + 1)} />
            : <Help>The server can't write the questions because it has no Claude key. Add one to the server's settings, then open this again.</Help>,
        )}
      </Screen>
    );
  }

  if (!started) {
    return (
      <Screen title="Vocabulary check" footer={<Button label="Start" onPress={begin} disabled={items.length === 0} />}>
        {scroll(
          <Card>
            <Text style={{ ...type.headline, color: c.text }}>{`${QUESTIONS} questions on common ${name} words`}</Text>
            <Help>It takes about two minutes. You pick the meaning of each word, and the questions get harder or easier as you go.</Help>
            <Help>Words from your deck are left out, since they already count as known. If you aren't sure of a word, choose "I don't know this word" instead of guessing: a wrong guess counts against you.</Help>
            <Help>At the end it suggests a setting for common words counted as known. It changes nothing until you choose it.</Help>
          </Card>,
        )}
      </Screen>
    );
  }

  if (result) {
    const same = result.suggested === current;
    const none = result.suggested === 0;
    return (
      <Screen
        title={`Your ${name}`}
        footer={
          same ? (
            <Button label="Done" onPress={onDone} />
          ) : (
            <>
              <Button label={`Use ${commonLabel(result.suggested)}`} onPress={() => use(result.suggested)} busy={saving} />
              <Button label={`Keep ${commonLabel(current)}`} variant="secondary" onPress={onDone} disabled={saving} />
            </>
          )
        }
      >
        {scroll(
          <>
            {error ? <ErrorNote message={error} /> : null}
            <View style={{ alignItems: 'center', gap: 2, paddingVertical: space.m }}>
              <Text accessibilityRole="header" style={{ fontSize: 52, fontWeight: '700', color: c.accent }}>
                {none ? 'Under 250' : result.suggested.toLocaleString('en-US')}
              </Text>
              <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>
                {none ? `common ${name} words known well` : `most common ${name} words, about`}
              </Text>
            </View>
            <Group>
              {result.bands.map((b, i) => (
                <View
                  key={b.band}
                  accessible
                  accessibilityLabel={`Words ${bandLabel(b.band)}: ${b.right} of ${b.asked} right`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: space.m, paddingHorizontal: space.l, borderTopWidth: i ? 0.5 : 0, borderColor: c.border }}
                >
                  <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: b.known >= KNOWN_SHARE ? c.good : b.known >= 0.5 ? c.warning : c.textTertiary }} />
                  <Text style={{ ...type.callout, color: c.text, flex: 1 }}>{`Words ${bandLabel(b.band)}`}</Text>
                  <Text style={{ ...type.callout, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{`${b.right} of ${b.asked}`}</Text>
                </View>
              ))}
            </Group>
            <Help>
              {same
                ? `This matches your setting of ${commonLabel(current)}. `
                : ''}
              {`An estimate from ${asked.length} questions. Reading a text is easier than answering a question, so choose more if texts feel too simple. You can take this again any time.`}
            </Help>
          </>,
        )}
      </Screen>
    );
  }

  if (!item) return null;
  return (
    <Screen title="Vocabulary check" largeTitle={false}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ ...type.footnote, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{`Question ${asked.length + 1} of ${QUESTIONS}`}</Text>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>{name}</Text>
        </View>
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: QUESTIONS, now: asked.length }} style={{ height: 4, borderRadius: radius.pill, backgroundColor: c.fill, overflow: 'hidden' }}>
          <View style={{ height: 4, width: `${(asked.length / QUESTIONS) * 100}%`, backgroundColor: c.accent }} />
        </View>
        <Card style={{ alignItems: 'center', paddingVertical: space.xl, gap: space.xs }}>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>What does this mean?</Text>
          <Text selectable style={{ ...type.cardFront, color: c.text, textAlign: 'center' }}>{item.word}</Text>
          <Tappable
            onPress={() => { haptic.tap(); onPlayWord(item.word, language); }}
            accessibilityRole="button"
            accessibilityLabel={`Play ${item.word}`}
            style={{ marginTop: space.s, width: 44, height: 44, borderRadius: radius.pill, backgroundColor: c.accentFill, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="speaker.wave.2.fill" size={18} color={c.accent} />
          </Tappable>
        </Card>
        {choices.map((choice) => (
          <Tappable
            key={choice}
            onPress={() => answer(choice === item.meaning ? 'right' : 'wrong')}
            accessibilityRole="button"
            accessibilityLabel={choice}
            style={{ minHeight: 52, justifyContent: 'center', paddingHorizontal: space.l, paddingVertical: space.m, borderRadius: radius.m, ...smooth, backgroundColor: c.surface, borderColor: c.border, borderWidth: 0.5 }}
          >
            <Text style={{ ...type.body, color: c.text }}>{choice}</Text>
          </Tappable>
        ))}
        <Tappable
          onPress={() => answer('skipped')}
          accessibilityRole="button"
          accessibilityLabel="I don't know this word"
          style={{ minHeight: 52, justifyContent: 'center', paddingHorizontal: space.l, paddingVertical: space.m, borderRadius: radius.m, ...smooth, borderColor: c.border, borderWidth: 1, borderStyle: 'dashed' }}
        >
          <Text style={{ ...type.body, color: c.textSecondary }}>I don't know this word</Text>
        </Tappable>
      </ScrollView>
    </Screen>
  );
}
