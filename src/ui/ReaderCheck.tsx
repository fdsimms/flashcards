import { useAudioPlayer } from 'expo-audio';
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { Api, ReaderText, TextLine } from '../reader/api';
import { canSteer, checkScore, isRight, steersDifficulty, type CheckPicks, type CheckQuestion } from '../reader/check';
import { choiceText } from '../reader/choices';
import { prefs, savePrefs } from '../reader/storage';
import { haptic } from './haptics';
import { Button, Card, Chip, Help, Icon, Tappable } from './kit';
import { Reveal } from './motion';
import type { ReadTextStyle } from './ReadWord';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from './theme';

/**
 * The check after reading (reader/check.ts), one question at a time, in place of the reader's end
 * view until it's done or left. Each answer is marked at once, with the line that answers it, and
 * stays until Next. `picks` lives in the reader, so the score is logged with the reading however the
 * screen is left. Nothing here grades a card.
 */
export function ReaderCheck({ api, text, questions, picks, textStyle, onPick, onDone }: {
  api: Api;
  text: ReaderText;
  questions: CheckQuestion[];
  picks: CheckPicks;
  textStyle: ReadTextStyle;
  onPick: (key: string, pick: number | null) => void;
  onDone: () => void;
}) {
  const c = useTheme();
  // The first question not answered yet; a question answered stays shown until Next.
  const [at, setAt] = useState(() => Math.max(0, questions.findIndex((q) => !(q.key in picks))));
  const [english, setEnglish] = useState(prefs().checkEnglish);
  const q = questions[at];
  const answered = q ? q.key in picks : false;
  const play = useLinePlayer(api, text);

  // A listening question plays its line as it comes up.
  useEffect(() => {
    if (q?.kind === 'listen') play(q.line);
  }, [q?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!q) return null;
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
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ ...type.footnote, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{`Question ${at + 1} of ${questions.length}`}</Text>
        <Text style={{ ...type.footnote, color: c.textSecondary }}>{KIND_LABEL[q.kind]}</Text>
      </View>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: questions.length, now: at }} style={{ height: 4, borderRadius: radius.pill, backgroundColor: c.fill, overflow: 'hidden' }}>
        <View style={{ height: 4, width: `${(at / questions.length) * 100}%`, backgroundColor: c.accent }} />
      </View>
      <Reveal key={q.key} rise={10} style={{ gap: space.m }}>
        <Card style={{ gap: space.s, paddingVertical: space.l }}>
          {q.kind === 'text' ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
                <Text selectable style={{ fontSize: textStyle.fontSize, lineHeight: textStyle.lineHeight, fontFamily: textStyle.font.fontFamily, fontWeight: '600', color: c.text, flex: 1 }}>
                  {q.question}
                </Text>
                <Chip label="English" selected={english} onPress={toggleEnglish} />
              </View>
              {english || answered ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{q.english}</Text> : null}
            </>
          ) : q.kind === 'listen' ? (
            <View style={{ alignItems: 'center', gap: space.s }}>
              <Text style={{ ...type.headline, color: c.text, textAlign: 'center' }}>Which line did you hear?</Text>
              <Tappable
                onPress={() => { haptic.tap(); play(q.line); }}
                accessibilityRole="button"
                accessibilityLabel="Play the line again"
                style={{ width: 64, height: 64, borderRadius: radius.pill, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="play.fill" size={24} color={c.onAccent} />
              </Tappable>
              <Help>Play it as often as you like.</Help>
            </View>
          ) : (
            <View style={{ alignItems: 'center', gap: space.xs }}>
              <Text style={{ ...type.footnote, color: c.textSecondary }}>What does this mean here?</Text>
              <Text selectable style={{ fontSize: textStyle.fontSize * 1.4, lineHeight: textStyle.lineHeight * 1.4, fontFamily: textStyle.font.fontFamily, fontWeight: '600', color: c.text, textAlign: 'center' }}>
                {q.word}
              </Text>
              <LineWords line={line} word={q.word} textStyle={textStyle} centered />
            </View>
          )}
        </Card>
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
                  minHeight: MIN_TAP, justifyContent: 'center', gap: 2, paddingHorizontal: space.l, paddingVertical: space.m,
                  borderRadius: radius.m, ...smooth,
                  backgroundColor: right ? c.goodFill : wrongPick ? c.dangerFill : c.surface,
                  borderColor: mark ?? c.border, borderWidth: mark ? 1 : hairline,
                  opacity: answered && !mark ? 0.5 : 1,
                }}
              >
                {typeof choice === 'string' ? (
                  <Text style={{ ...type.body, color: c.text, fontWeight: right ? '600' : '400' }}>{label}</Text>
                ) : (
                  <Text style={{ fontSize: textStyle.fontSize, lineHeight: textStyle.lineHeight, fontFamily: textStyle.font.fontFamily, color: c.text, fontWeight: right ? '600' : '400' }}>{label}</Text>
                )}
                {under && (english || answered) ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{under}</Text> : null}
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
          style={{ minHeight: 52, justifyContent: 'center', paddingHorizontal: space.l, paddingVertical: space.m, borderRadius: radius.m, ...smooth, borderColor: c.border, borderWidth: 1, borderStyle: 'dashed' }}
        >
          <Text style={{ ...type.body, color: c.textSecondary }}>I don't know</Text>
        </Tappable>
      )}
    </ScrollView>
  );
}

const KIND_LABEL: Record<CheckQuestion['kind'], string> = { text: 'About the text', listen: 'Listening', word: 'A word from the text' };

/** Plays one of the text's lines at the reader's speed, on a player of its own. */
function useLinePlayer(api: Api, text: ReaderText) {
  const player = useAudioPlayer(null, { keepAudioSessionActive: true });
  return (line: number) => {
    if (!text.lines[line]?.audio) return;
    player.replace(api.audioSource(text.id, line));
    player.setPlaybackRate(prefs().rate, 'high');
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
        <View style={{ flex: 1, gap: 2 }}>
          <LineWords line={line} word={word} textStyle={textStyle} />
          <Text style={{ ...type.footnote, color: c.textSecondary }}>{line.english}</Text>
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
      ? ' A low score makes the next text a little easier.'
      : ' A low score makes the next text a little easier. Questions on words don\'t count toward it.';
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
      <View style={{ alignItems: 'center', gap: 2, paddingVertical: space.xs }}>
        <Text accessibilityRole="header" style={{ ...type.largeTitle, color: c.accent, fontVariant: ['tabular-nums'] }}>{`${right} of ${asked}`}</Text>
        <Text style={{ ...type.subhead, color: c.textSecondary }}>right on this text</Text>
      </View>
      {questions.filter((q) => q.key in picks).map((q) => {
        const ok = isRight(q, picks);
        const pick = picks[q.key];
        return (
          <View key={q.key} accessible style={{ flexDirection: 'row', gap: space.s, paddingVertical: space.xs }}>
            <Icon name={ok ? 'checkmark.circle.fill' : 'xmark.circle.fill'} size={18} color={ok ? c.good : c.danger} />
            <View style={{ flex: 1, gap: 2 }}>
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
