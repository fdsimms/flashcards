import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, TextInput, View, useColorScheme } from 'react-native';
import { failureText } from '../../core/failure';
import { compareTyped } from '../../core/typedCompare';
import type { Language, SentencePrompt, WritingCheck } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { markLine, roundLine, roundProgress, roundScore, skipLine, startRound, type LineRound } from '../../reader/lineDrill';
import { Button, Card, ErrorNote, Help, Loading } from '../kit';
import { Reveal } from '../motion';
import { WritingResult } from '../ReadWritingResult';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from '../theme';
import { TypedDiff } from '../TypedDiff';
import { ListeningNote, SpeakButton } from '../SpeakButton';
import { useSpokenAnswer } from '../useSpokenAnswer';
import type { ToolScreenProps } from './index';
import { PlayButton, ToolScreen, useAnswer, useToolLanguage, type ToolActions } from './ToolScreen';

/** Sentences asked for at once. */
const ROUND = 10;

/**
 * Sentences (server/reader sentences.py): an English sentence built around a word reviewed today or
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
  const [loaded, setLoaded] = useState<{ language: Language; sentences: SentencePrompt[]; writing: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState<LineRound>(() => startRound([]));
  const [typed, setTyped] = useState('');
  const [shown, setShown] = useState(false);
  const [check, setCheck] = useState<WritingCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
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
  useEffect(() => { spoken.cancel(); setTyped(''); setShown(false); setCheck(null); setCheckError(null); setChecking(false); }, [round.at, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
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

  let actions: ToolActions;
  if (!prompt) actions = { primary: { label: 'More sentences', onPress: () => void load(), disabled: !readerApi } };
  else if (!shown) actions = { secondary: { label: 'Skip', onPress: () => { asking.current++; setRound(skipLine); } }, primary: { label: 'Show the sentence', onPress: show } };
  else actions = { secondary: { label: 'Missed it', onPress: () => mark(false) }, primary: { label: 'Got it', onPress: () => mark(true) } };

  const progress = roundProgress(round);
  const score = roundScore(round);
  return (
    <ToolScreen
      tool={tool}
      language={language}
      onLanguage={(l) => { answer.hide(); setLanguage(l); }}
      shown={false}
      onRandomize={() => void load()}
      onShow={show}
      onMark={mark}
      actions={actions}
    >
      {!readerApi ? (
        <Card><Help>{"Sentences are written on Read & Listen's server. Turn on Read & Listen in Settings to use them."}</Help></Card>
      ) : error ? <ErrorNote message={error} onRetry={() => void load()} /> : !loaded || loaded.language !== language ? <Loading /> : !prompt ? (
        <Card style={{ gap: space.s }}>
          {loaded.sentences.length ? (
            <>
              <Text style={{ ...type.title, color: c.text }}>{`${score.right} of ${score.asked} right the first time`}</Text>
              <Help>More sentences are written for your words in the background.</Help>
            </>
          ) : (
            <Help>
              {loaded.writing
                ? `Sentences for the ${name} words you've reviewed today or are still learning are being written. Try again in a minute.`
                : "Claude isn't set up on Read & Listen's server, so it can't write sentences. Add Claude's key to your Read & Listen server to turn this on."}
            </Help>
          )}
        </Card>
      ) : (
        <Reveal key={round.at} style={{ gap: space.m }}>
          <Text style={{ ...type.footnote, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{`Sentence ${progress.done} of ${progress.total}`}</Text>
          <Card style={{ gap: space.s, paddingVertical: space.l }}>
            <Text style={{ ...type.footnote, color: c.textSecondary }}>{`Say it in ${name}`}</Text>
            <Text selectable style={{ ...type.cardBack, color: c.text }}>{prompt.english}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s }}>
              <Text style={{ ...type.footnote, color: c.textSecondary }}>Use</Text>
              <View style={{ backgroundColor: c.accentFill, borderRadius: radius.pill, paddingHorizontal: space.m - 2, paddingVertical: 3 }}>
                <Text accessibilityLanguage={LANGUAGES[language].speech} style={{ ...type.subhead, fontWeight: '600', color: c.accent }}>{`${prompt.word} · ${prompt.meaning}`}</Text>
              </View>
              {prompt.reviewed_today ? <Text style={{ ...type.footnote, color: c.textSecondary }}>reviewed today</Text> : null}
            </View>
          </Card>
          {shown && comparison ? (
            <Card style={{ gap: space.m }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
                <View style={{ flex: 1 }}>
                  {typed.trim() ? (
                    <TypedDiff comparison={comparison} showExpected size="body" lang={LANGUAGES[language].speech} expectedLabel="The sentence" />
                  ) : (
                    <Text selectable accessibilityLanguage={LANGUAGES[language].speech} style={{ ...type.body, fontSize: 20, lineHeight: 28, fontWeight: '600', color: c.text }}>{prompt.sentence}</Text>
                  )}
                </View>
                <PlayButton label="Play the sentence" onPress={() => answer.speak({ text: prompt.sentence })} />
              </View>
              {typed.trim() && !comparison.exact && !check ? (
                <View style={{ gap: space.xs }}>
                  <Button variant="secondary" label="Check mine" busy={checking} onPress={checkMine} />
                  <Help>Yours can be right in other words. Claude checks it.</Help>
                </View>
              ) : null}
              {check ? <WritingResult check={check} attempt={typed.trim()} lang={LANGUAGES[language].speech} /> : null}
              {checkError ? <ErrorNote message={checkError} onRetry={checkMine} /> : null}
            </Card>
          ) : (
            <View style={{ gap: space.s }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              multiline
              autoCorrect={false}
              spellCheck={false}
              placeholder="Type it, or just say it"
              accessibilityLabel={`Your sentence, in ${name}`}
              placeholderTextColor={c.textTertiary}
              selectionColor={c.accent}
              keyboardAppearance={dark ? 'dark' : 'light'}
              style={{
                ...type.body, fontSize: 20, lineHeight: 28, color: c.text, backgroundColor: c.surface, ...smooth, borderRadius: radius.m,
                borderWidth: hairline, borderColor: c.border, paddingHorizontal: space.m, paddingVertical: space.s, minHeight: MIN_TAP * 2, flex: 1,
              }}
            />
            <SpeakButton spoken={spoken} />
            </View>
            <ListeningNote spoken={spoken} language={name} />
            </View>
          )}
          {shown ? <Help>A sentence you miss comes back at the end of the round.</Help> : null}
        </Reveal>
      )}
    </ToolScreen>
  );
}
