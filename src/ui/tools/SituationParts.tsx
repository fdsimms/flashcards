import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { compareTyped } from '../../core/typedCompare';
import type { SituationFeedback, SituationTurn } from '../../reader/api';
import { lineParts } from '../../reader/situations';
import { haptic } from '../haptics';
import { Button, Card, Icon, Tappable } from '../kit';
import { MIN_TAP, radius, smooth, space, type, useTheme } from '../theme';
import { TypedDiff } from '../TypedDiff';

type TextLook = { fontSize: number; lineHeight: number; fontFamily?: string };

/**
 * One of their lines in a Situation (SituationsTool.tsx): its words, a word outside the deck picked
 * out and glossed on a tap, a play button, and its English behind a tap. In "Heard only", the words
 * wait behind Show the text too.
 */
export function TheirLine({ turn, name, look, lang, heardOnly, onPlay }: {
  turn: SituationTurn;
  name: string;
  look: TextLook;
  lang: string;
  heardOnly: boolean;
  onPlay?: () => void;
}) {
  const c = useTheme();
  const [english, setEnglish] = useState(false);
  const [shown, setShown] = useState(!heardOnly);
  const [tapped, setTapped] = useState<number | null>(null);
  const word = tapped === null ? null : turn.words[tapped];
  return (
    <View style={{ alignSelf: 'flex-start', maxWidth: '88%', backgroundColor: c.surface, borderRadius: radius.l, borderBottomLeftRadius: radius.s / 2, ...smooth, padding: space.m, gap: space.xs }}>
      <Text style={{ ...type.caption, fontWeight: '600', color: c.onSpeakerB }}>{name}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}>
        {shown ? (
          <Text accessibilityLanguage={lang} style={{ ...look, color: c.text, flex: 1 }}>
            {turn.words.length ? turn.words.map((w, i) => (w.status === null ? w.text : (
              <Text
                key={i}
                onPress={() => { haptic.select(); setTapped(tapped === i ? null : i); }}
                accessibilityRole="button"
                accessibilityHint="Shows what it means"
                style={w.status === 'known' ? (tapped === i ? { backgroundColor: c.accentFill } : undefined) : { backgroundColor: c.highlight }}
              >
                {w.text}
              </Text>
            ))) : turn.line}
          </Text>
        ) : (
          <Tappable onPress={() => { haptic.select(); setShown(true); }} accessibilityRole="button" style={{ flex: 1, minHeight: MIN_TAP, justifyContent: 'center' }}>
            <Text style={{ ...type.callout, color: c.accent }}>Show the text</Text>
          </Tappable>
        )}
        {onPlay ? (
          <Tappable
            onPress={() => { haptic.tap(); onPlay(); }}
            accessibilityRole="button"
            accessibilityLabel={`Play ${name}'s line`}
            style={{ width: MIN_TAP - 8, height: MIN_TAP - 8, borderRadius: radius.pill, backgroundColor: c.accentFill, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="play.fill" size={13} color={c.accent} />
          </Tappable>
        ) : null}
      </View>
      {word ? (
        <Text style={{ ...type.footnote, color: c.textSecondary }}>
          {`${word.text}${word.translit ? ` (${word.translit})` : ''}: ${word.gloss ?? word.parts ?? 'no meaning yet'}`}
        </Text>
      ) : null}
      {english ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{turn.english}</Text> : (
        <Tappable onPress={() => { haptic.select(); setEnglish(true); }} accessibilityRole="button" style={{ alignSelf: 'flex-start', minHeight: 28, justifyContent: 'center' }}>
          <Text style={{ ...type.footnote, color: c.accent }}>Show English</Text>
        </Tappable>
      )}
    </View>
  );
}

/** One of the owner's lines, an English word asked for in [brackets] set apart. */
export function MyLine({ text, look, lang }: { text: string; look: TextLook; lang: string }) {
  const c = useTheme();
  return (
    <View style={{ alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: c.accentFill, borderRadius: radius.l, borderBottomRightRadius: radius.s / 2, ...smooth, padding: space.m }}>
      <Text accessibilityLanguage={lang} style={{ ...look, color: c.text }}>
        {lineParts(text).map((p, i) => (p.asked
          ? <Text key={i} style={{ ...type.callout, color: c.textSecondary, fontStyle: 'italic' }}>{p.text}</Text>
          : p.text))}
      </Text>
    </View>
  );
}

/**
 * How it went: each of the owner's lines with Claude's correction against it and a note, then the
 * words worth adding, each with Add (to the note queue, filled in there and saved in the note editor:
 * nothing reaches the deck until it's saved).
 */
export function SituationResult({ feedback, mine, look, lang, added, onAdd }: {
  feedback: SituationFeedback;
  /** The owner's lines, by their index in the conversation. */
  mine: Map<number, string>;
  look: TextLook;
  lang: string;
  /** Words already put in the queue (or being put there), and any that failed. */
  added: Record<string, 'adding' | 'added' | 'failed'>;
  /** Null when there's no deck to add to (an older server). */
  onAdd: ((word: { word: string; english: string }) => void) | null;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: space.m }}>
      <Card style={{ gap: space.m }}>
        <Text style={{ ...type.overline, color: c.textSecondary }}>Your lines</Text>
        {feedback.lines.map((l, i) => {
          const own = mine.get(l.index) ?? '';
          const right = l.verdict === 'right';
          return (
            <View key={l.index} style={{ gap: space.xs, borderTopWidth: i ? 0.5 : 0, borderTopColor: c.border, paddingTop: i ? space.m : 0 }}>
              {right ? (
                <Text accessibilityLanguage={lang} style={{ ...look, color: c.text }}>{own}</Text>
              ) : (
                <TypedDiff comparison={compareTyped(l.corrected, own)} showExpected size="body" lang={lang} expectedLabel="Corrected" showLine={false} />
              )}
              <Text style={{ ...type.footnote, color: right ? c.countDue : c.textSecondary }}>{l.note}</Text>
            </View>
          );
        })}
        {feedback.lines.length < mine.size ? (
          <Text style={{ ...type.footnote, color: c.textSecondary }}>{`Claude said nothing about ${mine.size - feedback.lines.length} of your lines.`}</Text>
        ) : null}
      </Card>
      {feedback.words.length ? (
        <Card style={{ gap: space.s }}>
          <Text style={{ ...type.overline, color: c.textSecondary }}>Words to add</Text>
          {feedback.words.map((w) => {
            const state = added[w.word];
            return (
              <View key={w.word} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: MIN_TAP }}>
                <Text accessibilityLanguage={lang} style={{ ...look, color: c.text }}>{w.word}</Text>
                <Text style={{ ...type.subhead, color: c.textSecondary, flex: 1 }}>{`${w.english} · ${w.why === 'asked' ? 'you asked for it' : 'you heard it'}`}</Text>
                {onAdd ? (
                  state === 'added' ? <Text style={{ ...type.subhead, color: c.countDue }}>In the queue</Text> : (
                    <Button variant="secondary" label={state === 'failed' ? 'Try again' : 'Add'} busy={state === 'adding'} onPress={() => onAdd(w)} style={{ minHeight: MIN_TAP - 8, paddingVertical: space.xs }} />
                  )
                ) : null}
              </View>
            );
          })}
          <Text style={{ ...type.footnote, color: c.textSecondary }}>
            Add puts the word in the note queue, filled in, for you to save in the note editor.
          </Text>
        </Card>
      ) : null}
    </View>
  );
}
