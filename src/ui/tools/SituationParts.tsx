import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { compareTyped } from '../../core/typedCompare';
import type { SituationFeedback, SituationTurn } from '../../reader/api';
import { needsMeaning } from '../../reader/languages';
import { lineParts } from '../../reader/situations';
import { haptic } from '../haptics';
import { Button, Icon, Tappable } from '../kit';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from '../theme';
import { useSoundingButton } from '../useSoundingButton';
import { TypedDiff } from '../TypedDiff';
import { RoundRing } from './RoundRing';

type TextLook = { fontSize: number; lineHeight: number; fontFamily?: string };

/**
 * One of their lines in a Situation (SituationsTool.tsx): its words, a word outside the deck picked
 * out and glossed on a tap, a play button, and its English behind a tap. In "Heard only", the words
 * wait behind Show the text too.
 */
export function TheirLine({ turn, name, look, lang, heardOnly, onPlay, lookup }: {
  turn: SituationTurn;
  name: string;
  look: TextLook;
  lang: string;
  heardOnly: boolean;
  onPlay?: () => void;
  /** Asks the server for the meaning of a word Claude gave no gloss for (the line's English says which sense). */
  lookup?: (word: string, english: string) => Promise<string | null>;
}) {
  const c = useTheme();
  const { playing, tap } = useSoundingButton();
  const [english, setEnglish] = useState(false);
  const [shown, setShown] = useState(!heardOnly);
  const [tapped, setTapped] = useState<number | null>(null);
  // Meanings looked up by word index: null while asked for, '' when none came back.
  const [looked, setLooked] = useState<Record<number, string | null>>({});
  const word = tapped === null ? null : turn.words[tapped];
  const pick = (i: number) => {
    haptic.select();
    const next = tapped === i ? null : i;
    setTapped(next);
    const w = next === null ? null : turn.words[next];
    if (next === null || !w || !lookup || !needsMeaning(w) || looked[next]) return;
    setLooked((l) => ({ ...l, [next]: null }));
    lookup(w.text, turn.english).then(
      (meaning) => setLooked((l) => ({ ...l, [next]: meaning ?? '' })),
      () => setLooked((l) => ({ ...l, [next]: '' })),
    );
  };
  const meaning = word === null || tapped === null ? '' : word.gloss ?? word.parts ?? looked[tapped] ?? (lookup && needsMeaning(word) ? 'Looking up the meaning...' : '');
  return (
    <View style={{ alignSelf: 'flex-start', maxWidth: '88%', backgroundColor: c.surface, borderRadius: radius.l, borderBottomLeftRadius: radius.s / 2, ...smooth, padding: space.m, gap: space.xs }}>
      <Text style={{ ...type.headline, color: c.onSpeakerB }}>{name}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}>
        {shown ? (
          <Text accessibilityLanguage={lang} style={{ ...look, color: c.text, flexShrink: 1 }}>
            {turn.words.length ? turn.words.map((w, i) => (w.status === null ? w.text : (
              <Text
                key={i}
                onPress={() => pick(i)}
                accessibilityRole="button"
                accessibilityHint="Shows what it means"
                style={w.status === 'known' ? (tapped === i ? { backgroundColor: c.accentFill } : undefined) : { backgroundColor: c.highlight }}
              >
                {w.text}
              </Text>
            ))) : turn.line}
          </Text>
        ) : (
          <Tappable onPress={() => { haptic.select(); setShown(true); }} accessibilityRole="button" style={{ flexShrink: 1, minHeight: MIN_TAP, justifyContent: 'center' }}>
            <Text style={{ ...type.callout, color: c.accent }}>Show the text</Text>
          </Tappable>
        )}
        {onPlay ? (
          <Tappable
            onPress={() => tap(onPlay)}
            accessibilityRole="button"
            accessibilityLabel={playing ? 'Pause' : `Play ${name}'s line`}
            hitSlop={space.xs}
            style={{ width: MIN_TAP - 8, height: MIN_TAP - 8, borderRadius: radius.pill, backgroundColor: c.accentFill, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name={playing ? 'pause.fill' : 'play.fill'} size={13} color={c.accent} />
          </Tappable>
        ) : null}
      </View>
      {word ? (
        <Text style={{ ...type.footnote, color: c.textSecondary }}>
          <Text accessibilityLanguage={lang}>{word.text}</Text>
          {`${word.translit ? ` (${word.translit})` : ''}: ${meaning || 'no meaning yet'}`}
        </Text>
      ) : null}
      {english ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{turn.english}</Text> : (
        <Tappable onPress={() => { haptic.select(); setEnglish(true); }} accessibilityRole="button" hitSlop={{ top: space.s, bottom: space.s }} style={{ alignSelf: 'flex-start', minHeight: 28, justifyContent: 'center' }}>
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
 * How it went, as the body of a card: a ring for how many of the owner's lines were right, each of
 * those lines with Claude's correction against it and a note, then the words worth adding, each with
 * Add (to the note queue, filled in there and saved in the note editor: nothing reaches the deck until
 * it's saved).
 */
export function SituationResult({ feedback, mine, look, lang, added, inDeck, onAdd, scene }: {
  feedback: SituationFeedback;
  /** The owner's lines, by their index in the conversation. */
  mine: Map<number, string>;
  look: TextLook;
  lang: string;
  /** Words already put in the queue (or being put there), and any that failed. */
  added: Record<string, 'adding' | 'added' | 'failed'>;
  /** Whether the deck already has a word (a new card not studied yet), so it isn't offered (`useWordInDeck`). */
  inDeck: (word: string) => boolean;
  /** Null when there's no deck to add to (an older server). */
  onAdd: ((word: { word: string; english: string }) => void) | null;
  /** The scene, over the ring. */
  scene: string;
}) {
  const c = useTheme();
  const right = feedback.lines.filter((l) => l.verdict === 'right').length;
  return (
    <View style={{ gap: space.l, width: '100%' }}>
      {feedback.lines.length ? (
        <View style={{ alignItems: 'center', gap: space.s }}>
          <Text numberOfLines={2} style={{ ...type.overline, color: c.textSecondary, textAlign: 'center' }}>{scene}</Text>
          <RoundRing right={right} asked={feedback.lines.length} what="lines right" />
          <Text style={{ ...type.body, color: c.text }}>of your lines were right</Text>
        </View>
      ) : null}
      <View style={{ gap: space.m }}>
        <Text style={{ ...type.overline, color: c.textSecondary }}>Your lines</Text>
        {feedback.lines.map((l, i) => {
          const own = mine.get(l.index) ?? '';
          const ok = l.verdict === 'right';
          return (
            <View key={l.index} style={{ gap: space.xs, borderTopWidth: i ? hairline : 0, borderTopColor: c.border, paddingTop: i ? space.m : 0 }}>
              {ok ? (
                <Text accessibilityLanguage={lang} style={{ ...look, color: c.text }}>{own}</Text>
              ) : (
                <TypedDiff comparison={compareTyped(l.corrected, own)} showExpected size="body" lang={lang} expectedLabel="Corrected" showLine={false} />
              )}
              {l.heard || l.meant ? (
                <Text style={{ ...type.footnote, color: c.textSecondary }}>
                  {'Heard as: '}
                  {l.heard ? <Text accessibilityLanguage={lang} style={{ ...type.footnote, color: c.text }}>{l.heard}</Text> : null}
                  {l.heard && l.meant ? ' · ' : ''}
                  {l.meant ? `“${l.meant}”` : ''}
                </Text>
              ) : null}
              <Text style={{ ...type.footnote, color: ok ? c.countDue : c.textSecondary }}>{l.note}</Text>
            </View>
          );
        })}
        {feedback.lines.length < mine.size ? (
          <Text style={{ ...type.footnote, color: c.textSecondary }}>{`Claude said nothing about ${mine.size - feedback.lines.length} of your lines.`}</Text>
        ) : null}
      </View>
      {feedback.words.length ? (
        <View style={{ gap: space.s, borderTopWidth: hairline, borderTopColor: c.border, paddingTop: space.m }}>
          <Text style={{ ...type.overline, color: c.textSecondary }}>Words to add</Text>
          {feedback.words.map((w) => {
            const state = added[w.word];
            return (
              <View key={w.word} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: MIN_TAP }}>
                <View style={{ flex: 1, gap: space.xs }}>
                  <Text accessibilityLanguage={lang} style={{ ...look, color: c.text }}>{w.word}</Text>
                  <Text style={{ ...type.subhead, color: c.textSecondary }}>{w.english}</Text>
                  <Text style={{ ...type.footnote, color: c.textSecondary }}>{w.why === 'asked' ? 'You asked for it' : 'You heard it'}</Text>
                </View>
                {onAdd ? (
                  state === 'added' ? <Text style={{ ...type.subhead, color: c.countDue }}>Added</Text>
                  : !state && inDeck(w.word) ? <Text style={{ ...type.footnote, color: c.textSecondary }}>In your deck</Text> : (
                    <Button variant="secondary" label={state === 'failed' ? 'Try again' : 'Add'} busy={state === 'adding'} onPress={() => onAdd(w)} style={{ minHeight: MIN_TAP, paddingVertical: space.xs }} />
                  )
                ) : null}
              </View>
            );
          })}
          <Text style={{ ...type.footnote, color: c.textSecondary }}>
            Add has Claude fill in the word. Save it in the note editor.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
