import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, TextInput, View, useColorScheme } from 'react-native';
import { failureText } from '../../core/failure';
import { compareTyped } from '../../core/typedCompare';
import type { Language, SentencePrompt, WritingCheck } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { useKeyboardLanguage } from '../useKeyboardLanguage';
import { markLine, roundLine, roundProgress, roundScore, skipLine, startRound, type LineRound } from '../../reader/lineDrill';
import { splitAtMeaning } from '../../tools/sentenceWord';
import { haptic } from '../haptics';
import { Button, Card, ErrorNote, Help, Icon, Loading, Tappable } from '../kit';
import type { CardMotion } from '../SwipeCard';
import { WritingResult } from '../reader/ReadWritingResult';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from '../theme';
import { TypedDiff } from '../TypedDiff';
import { ListeningNote, SpeakButton } from '../SpeakButton';
import { useSpokenAnswer } from '../useSpokenAnswer';
import type { ToolScreenProps } from './index';
import { MarkButtons, PracticeCard, useSwipeSetting } from './PracticeCard';
import { RoundRing } from './RoundRing';
import { ToolScreen, useAnswer, useToolLanguage } from './ToolScreen';
import { MissingKeyboardNote } from '../useMissingKeyboard';

/** Sentences asked for at once. */
const ROUND = 10;

/**
 * Sentences (server/reader sentences.py), as Review's card (PracticeCard.tsx): the English sentence with the
 * word to use underlined (its form in the language is behind a Hint), a microphone and a field to answer in, the
 * comparison opening under it, and the round's ten segments on top. An English sentence built around a word reviewed today or
 * still young, to say or type in the language, then compared with the sentence written for it. Check
 * mine asks Claude whether one's own wording is right when it differs. Missed it brings a sentence back
 * at the end of the round (the round is Read & Listen's line drill's, reader/lineDrill.ts). Results stay
 * here; nothing grades a card, and a word waiting for its review is never asked.
 */
export function SentencesTool({ tool, repo, readerApi }: ToolScreenProps) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const [language, setLanguage] = useToolLanguage(tool);
  const answer = useAnswer(repo, language);
  const name = LANGUAGES[language].name;
  const keyboardLang = useKeyboardLanguage(LANGUAGES[language].speech);
  const [loaded, setLoaded] = useState<{ language: Language; sentences: SentencePrompt[]; writing: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState<LineRound>(() => startRound([]));
  const [typed, setTyped] = useState('');
  const [shown, setShown] = useState(false);
  const [check, setCheck] = useState<WritingCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const swipeOn = useSwipeSetting(repo);
  const motion = useRef<CardMotion | null>(null);
  const asking = useRef(0);

  const load = useCallback(async () => {
    if (!readerApi) return;
    const mine = ++asking.current;
    setError(null);
    setLoaded(null);
    try {
      const got = await readerApi.sentences(language, ROUND);
      if (asking.current !== mine) return;
      setLoaded({ language, ...got });
      setRound(startRound(got.sentences.map((_, i) => i)));
    } catch (e) {
      if (asking.current === mine) setError(failureText(e, { what: "Couldn't get sentences.", next: 'Try again.' }));
    }
  }, [readerApi, language]);
  useEffect(() => { void load(); }, [load]);

  const at = roundLine(round);
  const prompt = loaded && at !== undefined ? loaded.sentences[at] : undefined;
  // Each sentence starts with an empty box.
  // The sentence can be spoken (Answer by speaking): what's heard fills the box.
  const spoken = useSpokenAnswer(LANGUAGES[language].speech, {
    expected: prompt?.sentence,
    onBeforeListen: () => answer.hide(),
    onHeard: (heard) => setTyped(heard),
  });
  useEffect(() => { spoken.cancel(); setTyped(''); setShown(false); setCheck(null); setCheckError(null); setChecking(false); setHint(false); }, [round.at, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const comparison = useMemo(() => (prompt ? compareTyped(prompt.sentence, typed) : null), [prompt, typed]);

  const show = () => {
    spoken.cancel();
    setShown(true);
    if (prompt) answer.speak({ text: prompt.sentence });
  };
  const mark = (right: boolean) => { asking.current++; setRound((r) => markLine(r, right)); };
  const checkMine = async () => {
    if (!readerApi || !prompt || checking || !typed.trim()) return;
    const mine = ++asking.current;
    setChecking(true);
    setCheckError(null);
    try {
      const got = await readerApi.checkWriting({ kind: 'translate', language, attempt: typed.trim(), english: prompt.english, reference: prompt.sentence });
      if (asking.current === mine) setCheck(got);
    } catch (e) {
      if (asking.current === mine) setCheckError(failureText(e, { what: "Couldn't check your sentence.", next: 'Try again.' }));
    } finally {
      if (asking.current === mine) setChecking(false);
    }
  };

  const total = loaded?.sentences.length ?? 0;
  const progress = roundProgress(round);
  const score = roundScore(round);
  const markAndMove = (right: boolean) => {
    haptic.answer();
    motion.current?.flash(right ? 3 : 1);
    mark(right);
  };
  const swipe = swipeOn && shown && !!prompt;
  const loading = !!readerApi && !error && (!loaded || loaded.language !== language);

  let content: React.ReactNode;
  let footer: React.ReactNode = <View />;
  if (!readerApi) {
    content = <View style={{ padding: space.l }}><Card><Help>Sentences uses Read & Listen. Turn it on in Settings, Read & Listen.</Help></Card></View>;
  } else if (error) {
    content = <View style={{ padding: space.l }}><ErrorNote message={error} onRetry={() => void load()} /></View>;
  } else if (loading || !loaded) {
    content = <View style={{ padding: space.l }}><Loading /></View>;
  } else if (!prompt) {
    const missed = loaded.sentences.flatMap((sentence, i) => (round.first[i] === false ? [sentence] : []));
    content = loaded.sentences.length ? (
      <PracticeCard
        questionKey="end"
        cardKey="end"
        swipe={false}
        motion={motion}
        onMark={() => {}}
        front={(
          <View style={{ gap: space.l, width: '100%' }}>
            <View style={{ alignItems: 'center', gap: space.s }}>
              <Text style={{ ...type.overline, color: c.textSecondary }}>End of the round</Text>
              <RoundRing right={score.right} asked={score.asked} />
              <Text style={{ ...type.body, color: c.text }}>right the first time</Text>
            </View>
            <RoundSegments total={total} round={round} />
            {missed.length ? (
              <View style={{ gap: space.s, borderTopWidth: hairline, borderTopColor: c.border, paddingTop: space.m }}>
                <Text style={{ ...type.overline, color: c.textSecondary }}>To go over</Text>
                {missed.map((m) => (
                  <Tappable key={m.sentence} onPress={() => { haptic.tap(); answer.speak({ text: m.sentence }); }} accessibilityRole="button" accessibilityLabel={`Play ${m.sentence}`} scaleTo={0.99} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.xs }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ ...type.subhead, color: c.text }}>{m.english}</Text>
                      <Text accessibilityLanguage={LANGUAGES[language].speech} style={{ ...type.subhead, fontWeight: '600', color: c.accent }}>{m.sentence}</Text>
                    </View>
                    <Icon name="speaker.wave.2.fill" size={16} color={c.accent} />
                  </Tappable>
                ))}
              </View>
            ) : null}
            <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>Claude keeps writing more sentences for your words.</Text>
          </View>
        )}
      />
    ) : (
      <View style={{ padding: space.l }}>
        <Card>
          <Help>
            {loaded.writing
              ? `Claude is writing sentences for the ${name} words you reviewed today or are still learning. Try again in a minute.`
              : "Your Read & Listen server has no Claude key, so it can't write sentences. Add the key to the server's settings, then open this again."}
          </Help>
        </Card>
      </View>
    );
    footer = <Button label="More sentences" onPress={() => void load()} />;
  } else {
    const parts = splitAtMeaning(prompt.english, prompt.meaning);
    const front = (
      <View style={{ gap: space.l, width: '100%', alignItems: 'center' }}>
        <View style={{ gap: space.s, width: '100%' }}>
          <RoundSegments total={total} round={round} />
          <Text style={{ ...type.overline, color: c.textSecondary, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{`Sentence ${progress.done} of ${progress.total}`}</Text>
        </View>
        <View style={{ gap: space.s, alignItems: 'center' }}>
          <Text style={{ ...type.overline, color: c.textSecondary }}>{`Say it in ${name}`}</Text>
          <Text selectable style={{ ...type.cardBack, color: c.text, textAlign: 'center' }}>
            {parts ? <>{parts[0]}<Text style={{ color: c.accent, textDecorationLine: 'underline', textDecorationColor: c.accent }}>{parts[1]}</Text>{parts[2]}</> : prompt.english}
          </Text>
          <View style={{ minHeight: 34, justifyContent: 'center' }}>
            {hint ? (
              <View style={{ backgroundColor: c.accentFill, borderRadius: radius.pill, paddingHorizontal: space.m - 2, paddingVertical: 3 }}>
                <Text accessibilityLanguage={LANGUAGES[language].speech} style={{ ...type.subhead, fontWeight: '600', color: c.accentInk }}>{parts ? prompt.word : `${prompt.word} · ${prompt.meaning}`}</Text>
              </View>
            ) : (
              <Tappable onPress={() => { haptic.tap(); setHint(true); }} accessibilityRole="button" accessibilityLabel="Hint: the word in the sentence" scaleTo={0.96} style={{ minHeight: 34, justifyContent: 'center', paddingHorizontal: space.m, borderRadius: radius.pill, borderWidth: 1, borderColor: c.accent }}>
                <Text style={{ ...type.subhead, fontWeight: '600', color: c.accent }}>Hint</Text>
              </Tappable>
            )}
          </View>
        </View>
        {shown ? null : (
          <View style={{ gap: space.xl, alignItems: 'center', width: '100%', marginTop: space.m }}>
            <SpeakButton spoken={spoken} size="hero" />
            <ListeningNote spoken={spoken} language={name} />
            <TextInput
              {...keyboardLang}
              value={typed}
              onChangeText={setTyped}
              multiline
              autoCorrect={false}
              spellCheck={false}
              placeholder="Type it"
              accessibilityLabel={`Your sentence, in ${name}`}
              placeholderTextColor={c.textTertiary}
              selectionColor={c.accent}
              keyboardAppearance={dark ? 'dark' : 'light'}
              style={{
                ...type.reading, color: c.text, backgroundColor: c.surface, ...smooth, borderRadius: radius.m, alignSelf: 'stretch',
                borderWidth: hairline, borderColor: c.border, paddingHorizontal: space.m, paddingVertical: space.s, minHeight: MIN_TAP,
              }}
            />
            <MissingKeyboardNote speechTag={LANGUAGES[language].speech} />
          </View>
        )}
      </View>
    );
    const back = shown && comparison ? (
      <View style={{ gap: space.m }}>
        {typed.trim() ? (
          <TypedDiff comparison={comparison} showExpected size="body" lang={LANGUAGES[language].speech} expectedLabel="The sentence" />
        ) : (
          <Text selectable accessibilityLanguage={LANGUAGES[language].speech} style={{ ...type.reading, fontWeight: '600', color: c.text, textAlign: 'center' }}>{prompt.sentence}</Text>
        )}
        {typed.trim() && !comparison.exact && !check ? (
          <View style={{ gap: space.xs, alignItems: 'center' }}>
            <Button variant="secondary" label="Check mine" busy={checking} onPress={checkMine} />
            <Help>Yours can be right in other words. Claude checks it.</Help>
          </View>
        ) : null}
        {check ? <WritingResult check={check} attempt={typed.trim()} lang={LANGUAGES[language].speech} /> : null}
        {checkError ? <ErrorNote message={checkError} onRetry={checkMine} /> : null}
        {prompt.grammar ? <Help>{`Grammar you're practicing: ${prompt.grammar.name}.`}</Help> : null}
        <Help>A sentence you miss comes back at the end of the round.</Help>
      </View>
    ) : undefined;
    content = (
      <PracticeCard
        questionKey={String(round.at)}
        cardKey={`${round.at}|${shown}`}
        swipe={swipe}
        motion={motion}
        onMark={markAndMove}
        onPlay={shown ? () => answer.speak({ text: prompt.sentence }) : undefined}
        speech={LANGUAGES[language].speech}
        front={front}
        back={back}
      />
    );
    footer = shown ? <MarkButtons onMark={markAndMove} /> : (
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button variant="secondary" label="Skip" style={{ flex: 1 }} onPress={() => { asking.current++; setRound(skipLine); }} />
        <Button label="Show" style={{ flex: 1 }} onPress={show} />
      </View>
    );
  }

  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={(l) => { answer.hide(); setLanguage(l); }}
      shown={false}
      onRandomize={() => void load()}
      onShow={show}
      onMark={markAndMove}
      fill
      lockGesture={swipe}
      footer={footer}
    >
      {content}
    </ToolScreen>
  );
}

/** The round's sentences as segments: green or red once answered (the first time), the one being asked outlined. */
function RoundSegments({ total, round }: { total: number; round: LineRound }) {
  const c = useTheme();
  const at = roundLine(round);
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={`${Object.keys(round.first).length} of ${total} answered`} style={{ flexDirection: 'row', gap: 4 }}>
      {Array.from({ length: total }, (_, i) => {
        const first = round.first[i];
        return <View key={i} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: first === true ? c.good : first === false ? c.again : c.fill, borderWidth: i === at && first === undefined ? 1.5 : 0, borderColor: c.accent }} />;
      })}
    </View>
  );
}
