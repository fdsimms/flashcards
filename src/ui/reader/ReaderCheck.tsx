import { useAudioPlayer } from 'expo-audio';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { Api, GlossLanguage, ReaderText, TextLine } from '../../reader/api';
import { canSteer, checkScore, isRight, steersDifficulty, type CheckPicks, type CheckQuestion } from '../../reader/check';
import { choiceText } from '../../reader/choices';
import { glossInfo } from '../../reader/languages';
import { isSlow, NORMAL_RATE, RATES } from '../../reader/playbackRate';
import { hasSlow } from '../../reader/prefs';
import { prefs, savePrefs } from '../../reader/storage';
import { saidAs } from '../../reader/wordAudio';
import { haptic } from '../haptics';
import { Button, Card, Chip, Help, Icon, ProgressBar, Segments, Tappable } from '../kit';
import { Reveal } from '../motion';
import { PlayPill } from '../PlayButton';
import { useSoundingButton, useTrackedPlayer } from '../useSoundingButton';
import { useOutputWake } from '../useOutputWake';
import type { ReadTextStyle } from './ReadWord';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme, readable } from '../theme';
import { TranslationRow } from '../TranslationRow';
import { PlayCircle } from '../PlayCircle';
import { RoundScore } from '../RoundScore';

/**
 * The check after reading (reader/check.ts), one question at a time, in place of the reader's end
 * view until it's done or left. Each answer is marked at once, with the line that answers it, and
 * stays until Next. `picks` lives in the reader, so the score is logged with the reading however the
 * screen is left. Nothing here grades a card.
 */
export function ReaderCheck({ api, text, questions, picks, textStyle, onPick, onPlayWord, onDone }: {
  api: Api;
  text: ReaderText;
  questions: CheckQuestion[];
  picks: CheckPicks;
  textStyle: ReadTextStyle;
  onPick: (key: string, pick: number | null) => void;
  /** Plays a word: its deck recording, else the phone's voice (useWordAudio). */
  onPlayWord: (word: string, language: GlossLanguage, say?: string) => void;
  onDone: () => void;
}) {
  const c = useTheme();
  // The first question not answered yet; a question answered stays shown until Next.
  const [at, setAt] = useState(() => Math.max(0, questions.findIndex((q) => !(q.key in picks))));
  const [english, setEnglish] = useState(prefs().checkEnglish);
  const q = questions[at];
  const answered = q ? q.key in picks : false;
  // The reader's speed (the story page's Slow and Normal), shared through the saved setting.
  const slowOffered = hasSlow(prefs(), text.language);
  const [chosenRate, setRate] = useState(prefs().rate);
  const rate = slowOffered ? chosenRate : NORMAL_RATE;
  const play = useLinePlayer(api, text, rate);
  const listenButton = useSoundingButton();

  // A listening question plays its line as it comes up.
  useEffect(() => {
    if (q?.kind === 'listen') play(q.line);
  }, [q?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!q) return null;
  // The speed is a different recording, so the line starts again at the new one.
  const changeRate = (next: number) => {
    savePrefs({ ...prefs(), rate: next });
    setRate(next);
    play(q.line, next);
  };
  const toggleEnglish = () => {
    setEnglish(!english);
    savePrefs({ ...prefs(), checkEnglish: !english });
  };
  const choose = (pick: number | null) => {
    if (answered) return;
    if (pick === q.answer) haptic.success();
    else haptic.select();
    onPick(q.key, pick);
  };
  const last = at + 1 >= questions.length;
  const line = text.lines[q.line];

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ ...type.footnote, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{`Question ${at + 1} of ${questions.length}`}</Text>
        <Text style={{ ...type.footnote, color: c.textSecondary }}>{KIND_LABEL[q.kind]}</Text>
      </View>
      <ProgressBar value={at / questions.length} label="Progress through this check" />
      <Reveal key={q.key} rise={10} style={{ gap: space.m }}>
        {q.kind === 'text' ? (
          // The question sits on the screen itself, not in a card, so a boxed row is always something to tap.
          <View style={{ gap: space.s, paddingHorizontal: space.xs, paddingTop: space.s }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.m }}>
              <Text style={{ ...type.overline, color: c.accentInk }}>Question</Text>
              <Chip label="English" selected={english} onPress={toggleEnglish} />
            </View>
            <Text selectable style={{ fontSize: textStyle.fontSize * 1.25, lineHeight: textStyle.lineHeight * 1.25, ...textStyle.font.strong, color: c.text }}>
              {q.question}
            </Text>
            {english || answered ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{q.english}</Text> : null}
            <View style={{ height: hairline, backgroundColor: c.border, marginTop: space.xs }} />
          </View>
        ) : (
        <Card style={{ gap: space.s, paddingVertical: space.l }}>
          {q.kind === 'listen' ? (
            <View style={{ alignItems: 'center', gap: space.s }}>
              <Text style={{ ...type.headline, color: c.text, textAlign: 'center' }}>Which line did you hear?</Text>
              <PlayCircle playing={listenButton.playing} onPress={() => listenButton.tap(() => play(q.line))} accessibilityLabel={listenButton.playing ? 'Pause' : 'Play the line again'} />
              {slowOffered ? (
                <Segments
                  style={{ alignSelf: 'stretch' }}
                  options={RATES.map((r) => ({ value: r, label: isSlow(r) ? 'Slow' : 'Normal', accessibilityLabel: isSlow(r) ? 'Slow speed' : 'Normal speed' }))}
                  value={rate}
                  onChange={changeRate}
                />
              ) : null}
              <Help>Play it as often as you like.</Help>
            </View>
          ) : (
            <View style={{ alignItems: 'center', gap: space.xs }}>
              <Text style={{ ...type.footnote, color: c.textSecondary }}>What does this mean here?</Text>
              <Text selectable style={{ fontSize: textStyle.fontSize * 1.4, lineHeight: textStyle.lineHeight * 1.4, ...textStyle.font.strong, color: c.text, textAlign: 'center' }}>
                {q.word}
              </Text>
              <LineWords line={line} word={q.word} textStyle={textStyle} centered />
              <View style={{ marginTop: space.xs }}>
                <PlayPill
                  label={`Play ${q.word}`}
                  onPlay={() => onPlayWord(q.word, text.language, saidAs(text.language, q.word, line?.words.find((w) => w.text === q.word)?.translit))}
                  speech={glossInfo(text.language).speech}
                />
              </View>
            </View>
          )}
        </Card>
        )}
        <View accessibilityRole="radiogroup" style={{ gap: space.s }}>
          {q.choices.map((choice, i) => {
            const label = typeof choice === 'string' ? choice : choice.text;
            const under = typeof choice === 'string' ? null : choice.english;
            const right = answered && i === q.answer;
            const wrongPick = answered && picks[q.key] === i && i !== q.answer;
            const mark = right ? c.good : wrongPick ? c.danger : null;
            return (
              <Tappable
                key={i}
                onPress={() => choose(i)}
                disabled={answered}
                accessibilityRole="radio"
                accessibilityState={{ selected: picks[q.key] === i, disabled: answered }}
                accessibilityLabel={`${label}${under ? `. ${under}` : ''}${right ? '. Right answer' : wrongPick ? '. Your answer' : ''}`}
                scaleTo={0.98}
                style={{
                  minHeight: MIN_TAP, justifyContent: 'center', gap: space.xs, paddingHorizontal: space.l, paddingVertical: under === null ? space.m : space.s,
                  borderRadius: radius.m, ...smooth,
                  backgroundColor: right ? c.goodFill : wrongPick ? c.dangerFill : c.surface,
                  borderColor: mark ?? c.border, borderWidth: mark ? 1 : hairline,
                  opacity: answered && !mark ? 0.5 : 1,
                }}
              >
                {typeof choice === 'string' ? (
                  <Text style={{ ...type.body, color: c.text, fontWeight: right ? '600' : '400' }}>{label}</Text>
                ) : (
                  // The text and its English share a line so four answers fit above the evidence and Next;
                  // a long text wraps and the English drops under it.
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: space.m }}>
                    <Text style={{ fontSize: textStyle.fontSize, lineHeight: textStyle.lineHeight, fontFamily: textStyle.font.fontFamily, ...(right ? textStyle.font.strong : { fontWeight: '400' as const }), color: c.text, flexShrink: 1 }}>{label}</Text>
                    {under && (english || answered) ? <Text style={{ ...type.footnote, color: c.textSecondary, marginLeft: 'auto', textAlign: 'right' }}>{under}</Text> : null}
                  </View>
                )}
                {wrongPick ? <Text style={{ ...type.caption, color: c.textSecondary }}>Your answer</Text> : null}
              </Tappable>
            );
          })}
        </View>
      </Reveal>
      {answered ? (
        <Reveal rise={6} style={{ gap: space.m }}>
          {line ? <Evidence line={line} index={q.line} word={q.kind === 'word' ? q.word : null} textStyle={textStyle} onPlay={line.audio ? () => play(q.line) : null} /> : null}
          <Button label={last ? 'See how you did' : 'Next'} onPress={() => (last ? onDone() : setAt(at + 1))} />
        </Reveal>
      ) : (
        <Tappable
          onPress={() => choose(null)}
          accessibilityRole="button"
          accessibilityLabel="I don't know"
          style={{ minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.l, paddingVertical: space.m, borderRadius: radius.m, ...smooth, backgroundColor: c.accentFill }}
        >
          <Text style={{ ...type.body, color: c.accentInk, fontWeight: '600' }}>I don't know</Text>
        </Tappable>
      )}
    </ScrollView>
  );
}

const KIND_LABEL: Record<CheckQuestion['kind'], string> = { text: 'About the text', listen: 'Listening', word: 'A word from the text' };

/** Plays one of the text's lines at `rate` (the reader's speed unless one is given), on a player of its own. */
function useLinePlayer(api: Api, text: ReaderText, rate: number) {
  const player = useAudioPlayer(null, { keepAudioSessionActive: true });
  useTrackedPlayer(player);
  // Bluetooth headphones that have been quiet lose the start of the next sound (useOutputWake). Only the latest tap plays.
  const wake = useOutputWake();
  const latest = useRef(0);
  return async (line: number, at = rate) => {
    if (!text.lines[line]?.audio) return;
    const mine = ++latest.current;
    await wake();
    if (mine !== latest.current) return;
    player.replace(api.audioSource(text.id, line, at));
    player.play();
  };
}

/** A line's words, with `word` drawn in the accent. */
function LineWords({ line, word, textStyle, centered }: { line: TextLine; word: string | null; textStyle: ReadTextStyle; centered?: boolean }) {
  const c = useTheme();
  const fold = (s: string) => s.toLocaleLowerCase();
  return (
    <Text selectable style={{ fontSize: textStyle.fontSize, lineHeight: textStyle.lineHeight, fontFamily: textStyle.font.fontFamily, color: c.text, textAlign: centered ? 'center' : 'left' }}>
      {line.words.map((w, i) => (
        <Text key={i} style={word && fold(w.text) === fold(word) ? { color: c.accent, fontWeight: '600' } : undefined}>{w.text}</Text>
      ))}
    </Text>
  );
}

/** The line that answers a question, shown once it's answered: its words, its English and its audio. */
function Evidence({ line, index, word, textStyle, onPlay }: { line: TextLine; index: number; word: string | null; textStyle: ReadTextStyle; onPlay: (() => void) | null }) {
  const c = useTheme();
  return (
    <View style={{ backgroundColor: c.fill, borderRadius: radius.m, ...smooth, padding: space.m, gap: space.xs }}>
      <Text style={{ ...type.overline, color: c.textSecondary }}>{`From line ${index + 1}`}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
        <View style={{ flex: 1, gap: space.xs }}>
          <LineWords line={line} word={word} textStyle={textStyle} />
          <TranslationRow><Text style={{ ...type.footnote, color: c.textSecondary }}>{line.english}</Text></TranslationRow>
        </View>
        {onPlay ? (
          <Tappable
            onPress={() => { haptic.tap(); onPlay(); }}
            accessibilityRole="button"
            accessibilityLabel={`Play line ${index + 1}`}
            hitSlop={space.xs}
            style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: c.accentFill, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="speaker.wave.2.fill" size={15} color={c.accent} />
          </Tappable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The check's card in the end view: an offer to start it, then once it's been taken, how it went,
 * with each miss's right answer. Shown only when the text has something to ask about.
 */
export function CheckCard({ text, questions, picks, onStart }: {
  text: ReaderText;
  questions: CheckQuestion[];
  picks: CheckPicks | null;
  onStart: () => void;
}) {
  const c = useTheme();
  const listening = questions.filter((q) => q.kind === 'listen').length;
  const effect = !canSteer(questions)
    ? ''
    : questions.every(steersDifficulty)
      ? ' Low scores on this text and your last one make new texts a level easier, and high scores a level harder (Settings, Text difficulty).'
      : ' Low scores on this text and your last one make new texts a level easier, and high scores a level harder (Settings, Text difficulty). Questions on words don\'t count toward it.';
  if (!picks) {
    return (
      <Card style={{ gap: space.s }}>
        <Text accessibilityRole="header" style={{ ...type.title, color: c.text }}>Check what you understood</Text>
        <Help>
          {`${questions.length} ${questions.length === 1 ? 'question' : 'questions'} on this text${listening ? `, ${listening === 1 ? 'one' : listening} by ear` : ''}.${effect}`}
        </Help>
        <Button label="Start" onPress={onStart} />
      </Card>
    );
  }
  const { right, asked } = checkScore(questions, picks);
  const unanswered = questions.length - asked;
  return (
    <Card style={{ gap: space.s }}>
      <View style={{ paddingVertical: space.xs }}>
        <RoundScore right={right} asked={asked} what="right on this text" />
      </View>
      {questions.filter((q) => q.key in picks).map((q) => {
        const ok = isRight(q, picks);
        const pick = picks[q.key];
        return (
          <View key={q.key} accessible style={{ flexDirection: 'row', gap: space.s, paddingVertical: space.xs }}>
            <Icon name={ok ? 'checkmark.circle.fill' : 'xmark.circle.fill'} size={18} color={ok ? c.good : c.danger} />
            <View style={{ flex: 1, gap: space.xs }}>
              <Text style={{ ...type.callout, color: c.text }}>{summary(q, text)}</Text>
              {ok ? null : (
                <Text style={{ ...type.footnote, color: c.textSecondary }}>
                  {`${answerText(q, q.answer)}. ${pick === null || pick === undefined ? 'You chose not to answer.' : `You chose: ${answerText(q, pick)}.`}`}
                </Text>
              )}
            </View>
          </View>
        );
      })}
      {unanswered > 0 ? <Help>{`${unanswered} not answered, so not counted.`}</Help> : null}
    </Card>
  );
}

function summary(q: CheckQuestion, text: ReaderText): string {
  if (q.kind === 'text') return q.english;
  if (q.kind === 'word') return `What "${q.word}" means`;
  const line = text.lines[q.line];
  return line ? `Listening: ${choiceText(line)}` : 'Listening';
}

function answerText(q: CheckQuestion, i: number): string {
  const choice = q.choices[i];
  return typeof choice === 'string' ? choice : `${choice.text} (${choice.english})`;
}
