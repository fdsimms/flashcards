import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { ApiError, type Api, type CommonCount, type Language, type Settings, type VocabBank } from '../reader/api';
import { withThaiLineHeight } from '../core/script';
import { LANGUAGES, commonLabel } from '../reader/languages';
import {
  KNOWN_SHARE, QUESTIONS, bandLabel, choicesFor, estimate, missedWords, nextItem, rememberSeen, type Asked, type Reply, type VocabItem,
} from '../reader/vocabCheck';
import { loadVocabSeen, saveVocabSeen } from '../reader/storage';
import { vocabWatch } from '../reader/vocabWatch';
import { haptic } from './haptics';
import { Reveal } from './motion';
import { Button, Card, Divider, ErrorNote, Group, Help, Icon, Screen, SectionTitle, Tappable } from './kit';
import { MIN_TAP, radius, smooth, space, type, useTheme } from './theme';

const POLL_MS = 3000;

/**
 * The vocabulary check (reader/vocabCheck.ts): 20 questions on the language's most common words,
 * from the server's bank, that suggest the "Common words counted as known" setting. After each answer
 * the right meaning is shown until Next, and the word can be added to the deck: that opens the note
 * editor (the read-vocab-check route), where saving is the approval. Nothing else here touches the
 * deck or a card: the result is only a suggestion, and the setting changes when you tap Use.
 */
export function ReadVocabCheck({ api, language, current, onSettings, onPlayWord, mining, onDone }: {
  api: Api;
  language: Language;
  /** The language's setting now. */
  current: CommonCount;
  /** The settings as the server has them after the suggestion is used. */
  onSettings: (settings: Settings) => void;
  onPlayWord: (word: string, language: Language) => void;
  /** Present when words can be added to the deck: its name and what opens the note editor, resolving true once the note is saved. */
  mining?: { deck: string; onAdd: (word: string, meaning: string) => Promise<boolean> };
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
  // The answer just given, shown (right meaning marked) until Next; and the words added to the deck from here.
  const [feedback, setFeedback] = useState<{ reply: Reply; picked?: string } | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const adding = useRef(false);
  // Words asked in earlier checks, which a retake leaves for last (vocabCheck.ts).
  const [seen, setSeen] = useState<string[]>([]);
  useEffect(() => { loadVocabSeen(language).then(setSeen); }, [language]);

  // The server writes the questions the first time, which takes a minute: ask again until they're ready.
  // Leaving while they're still being written hands the wait to the banner (VocabReadyBanner).
  const preparing = useRef(false);
  useEffect(() => {
    vocabWatch.clear();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await api.vocabCheck(language);
        if (cancelled) return;
        preparing.current = next.state === 'preparing';
        setBank(next);
        setError(null);
        if (next.state === 'preparing') timer = setTimeout(load, POLL_MS);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Couldn't load the questions.");
      }
    };
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (preparing.current) vocabWatch.start(language);
    };
  }, [api, language, attempt]);

  const choices = useMemo(() => (item ? choicesFor(item, Math.random) : []), [item]);
  const items = bank?.state === 'ready' ? bank.items : [];
  const finished = started && item === null;

  const begin = () => {
    haptic.tap();
    setAsked([]);
    setFeedback(null);
    setItem(nextItem(items, [], Math.random, new Set(seen)) ?? null);
    setStarted(true);
  };

  const answer = (reply: Reply, picked?: string) => {
    if (!item || feedback) return;
    haptic.select();
    setFeedback({ reply, picked });
  };

  const next = () => {
    if (!item || !feedback) return;
    haptic.tap();
    const done = [...asked, { item, reply: feedback.reply, picked: feedback.picked }];
    setFeedback(null);
    setAsked(done);
    const upcoming = done.length >= QUESTIONS ? null : nextItem(items, done, Math.random, new Set(seen)) ?? null;
    setItem(upcoming);
    if (!upcoming) {
      const remembered = rememberSeen(seen, done, items);
      setSeen(remembered);
      saveVocabSeen(language, remembered);
    }
  };

  // Opens the note editor with the word and its meaning; the word counts as added only once saved there.
  const add = async (word: VocabItem) => {
    if (!mining || adding.current) return;
    adding.current = true;
    try {
      if (await mining.onAdd(word.word, word.meaning)) setAdded((a) => [...a, word.word]);
    } finally {
      adding.current = false;
    }
  };

  const result = useMemo(() => (finished ? estimate(asked) : null), [finished, asked]);
  const missed = useMemo(() => missedWords(asked), [asked]);

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
            <Help>It takes about two minutes. You pick the meaning of each word, and the questions get harder or easier as you go. After each answer you see the right meaning, and can add the word to your deck.</Help>
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
              <Text accessibilityRole="header" style={{ ...type.largeTitle, color: c.accent }}>
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
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: MIN_TAP, paddingVertical: space.m, paddingHorizontal: space.l }}
                >
                  {i ? <Divider inset={space.l} /> : null}
                  <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: b.known >= KNOWN_SHARE ? c.good : b.known >= 0.5 ? c.warning : c.textTertiary }} />
                  <Text style={{ ...type.callout, color: c.text, flex: 1 }}>{`Words ${bandLabel(b.band)}`}</Text>
                  <Text style={{ ...type.callout, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{`${b.right} of ${b.asked}`}</Text>
                </View>
              ))}
            </Group>
            {missed.length ? (
              <>
                <SectionTitle>{`Missed (${missed.length})`}</SectionTitle>
                <Group>
                  {missed.map((m, i) => (
                    <View
                      key={m.item.word}
                      accessible
                      accessibilityLabel={`${m.item.word}, ${m.item.meaning}. ${m.picked ? `You chose ${m.picked}.` : 'Skipped.'}`}
                      style={{ gap: 2, minHeight: MIN_TAP, justifyContent: 'center', paddingVertical: space.m, paddingHorizontal: space.l }}
                    >
                      {i ? <Divider inset={space.l} /> : null}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.m }}>
                        <Text selectable style={{ ...type.callout, color: c.text, flexShrink: 1 }}>{m.item.word}</Text>
                        <Text style={{ ...type.callout, color: c.textSecondary, flexShrink: 1, textAlign: 'right' }}>{m.item.meaning}</Text>
                      </View>
                      <Text style={{ ...type.footnote, color: c.textSecondary }}>
                        {`${m.picked ? `You chose ${m.picked}` : 'Skipped'} · Words ${bandLabel(m.band)}`}
                      </Text>
                    </View>
                  ))}
                </Group>
              </>
            ) : null}
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
        {/* Keyed to the word, so each question fades in as a new card does in Review. */}
        <Reveal key={item.word} rise={10} style={{ gap: space.m }}>
          <Card style={{ alignItems: 'center', paddingVertical: space.xl, gap: space.xs }}>
            <Text style={{ ...type.footnote, color: c.textSecondary }}>What does this mean?</Text>
            <Text selectable style={{ ...withThaiLineHeight(type.cardFront, item.word), color: c.text, textAlign: 'center' }}>{item.word}</Text>
            <Tappable
              onPress={() => { haptic.tap(); onPlayWord(item.word, language); }}
              accessibilityRole="button"
              accessibilityLabel={`Play ${item.word}`}
              style={{ marginTop: space.s, width: 44, height: 44, borderRadius: radius.pill, backgroundColor: c.accentFill, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="speaker.wave.2.fill" size={18} color={c.accent} />
            </Tappable>
          </Card>
          {[choices.slice(0, 2), choices.slice(2)].map((pair, row) => (
            <View key={row} style={{ flexDirection: 'row', gap: space.s }}>
              {pair.map((choice) => {
                const right = choice === item.meaning;
                const wrongPick = !!feedback && feedback.picked === choice && !right;
                const mark = feedback && right ? c.good : wrongPick ? c.danger : null;
                return (
                  <Tappable
                    key={choice}
                    onPress={() => answer(right ? 'right' : 'wrong', choice)}
                    disabled={!!feedback}
                    accessibilityRole="button"
                    accessibilityLabel={`${choice}${feedback && right ? '. Right answer' : wrongPick ? '. Your answer' : ''}`}
                    style={{
                      flex: 1, minHeight: 64, alignItems: 'center', justifyContent: 'center',
                      paddingHorizontal: space.m, paddingVertical: space.m, borderRadius: radius.m, ...smooth,
                      backgroundColor: feedback && right ? c.goodFill : wrongPick ? c.dangerFill : c.surface,
                      borderColor: mark ?? c.border, borderWidth: mark ? 1 : 0.5,
                      opacity: feedback && !mark ? 0.5 : 1,
                    }}
                  >
                    <Text style={{ ...type.body, color: c.text, textAlign: 'center', fontWeight: feedback && right ? '600' : '400' }}>{choice}</Text>
                  </Tappable>
                );
              })}
            </View>
          ))}
        </Reveal>
        {feedback ? (
          <Reveal rise={6} style={{ flexDirection: 'row', gap: space.s }}>
            {mining && feedback.reply !== 'right' ? (
              <Button
                label={added.includes(item.word) ? 'Added to deck' : 'Add to deck'}
                variant="secondary"
                onPress={() => add(item)}
                disabled={added.includes(item.word)}
                style={{ flex: 1 }}
              />
            ) : null}
            <Button label={asked.length + 1 >= QUESTIONS ? 'See result' : 'Next'} onPress={next} style={{ flex: 1 }} />
          </Reveal>
        ) : (
          <Tappable
            onPress={() => answer('skipped')}
            accessibilityRole="button"
            accessibilityLabel="I don't know this word"
            style={{ minHeight: 52, justifyContent: 'center', paddingHorizontal: space.l, paddingVertical: space.m, borderRadius: radius.m, ...smooth, borderColor: c.border, borderWidth: 1, borderStyle: 'dashed' }}
          >
            <Text style={{ ...type.body, color: c.textSecondary }}>I don't know this word</Text>
          </Tappable>
        )}
      </ScrollView>
    </Screen>
  );
}
