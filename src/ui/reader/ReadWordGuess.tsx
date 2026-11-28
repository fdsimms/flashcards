import React from 'react';
import { Text, View } from 'react-native';
import { GUESS_HINT, type TapMode } from '../../reader/guess';
import { haptic } from '../haptics';
import { Button, Icon } from '../kit';
import { Collapse } from '../motion';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from '../theme';
import { HoverPressable } from '../hover';

/**
 * What a known word's popover shows while its meaning is held back (src/reader/guess.ts): a line
 * saying what to try, and with the quiz on, four meanings to choose from. Once the meaning is shown,
 * the quiz's choices stay as a record of the answer, right or wrong (`QuizChoices`).
 */

const CHOICE_PAD = space.m;

export function GuessPrompt({ mode, onPick, onGiveUp }: {
  mode: NonNullable<TapMode>;
  /** A choice picked, by position, when the mode is a quiz. */
  onPick: (choice: number) => void;
  /** "I don't know" on a quiz. */
  onGiveUp: () => void;
}) {
  const c = useTheme();
  if (mode.quiz) {
    return (
      <View style={{ gap: space.s, marginTop: space.xs }}>
        <Text style={{ ...type.footnote, color: c.textSecondary }}>What does it mean?</Text>
        {mode.quiz.choices.map((choice, i) => (
          <HoverPressable hover="lift"
            key={`${i}:${choice}`}
            onPress={() => onPick(i)}
            accessibilityRole="button"
            accessibilityLabel={choice}
            style={({ pressed }) => ({
              minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: CHOICE_PAD, borderRadius: radius.m, ...smooth,
              backgroundColor: pressed ? c.border : c.fill,
            })}
          >
            <Text style={{ ...type.body, color: c.text }}>{choice}</Text>
          </HoverPressable>
        ))}
        <Button variant="tinted" label="I don't know" onPress={onGiveUp} />
        <View style={{ height: hairline, backgroundColor: c.border, marginVertical: space.xs }} />
      </View>
    );
  }
  return (
    <View style={{ gap: space.s }}>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{GUESS_HINT[mode.kind]}</Text>
    </View>
  );
}

/** The gap between each unpicked choice folding away. They start folding as soon as an answer is picked. */
const FOLD_STAGGER_MS = 90;

/**
 * The quiz's choices once answered: the right one marked (with a check alone when it was picked)
 * and a wrong pick marked, each with a word or icon as well as a color. The wrong choices that
 * weren't picked are dimmed and fold away top to bottom, giving the popover its space back (`settled`:
 * shown again on a later tap, they are simply not drawn). Nothing
 * bounces: the marks appear as they are.
 */
export function QuizChoices({ choices, answer, picked, settled = false }: {
  choices: string[]; answer: number; picked: number | null;
  /** The answer was given on an earlier tap: the unpicked choices are left out rather than folded away again. */
  settled?: boolean;
}) {
  const c = useTheme();
  const gotIt = picked === answer;
  let folded = 0;
  return (
    // Each row carries its own bottom padding (not a gap) so a folded row leaves no space; the
    // negative margin takes back the last row's.
    // maxWidth keeps it inside the popover's text column, clear of the play button beside it.
    <View style={{ marginTop: space.xs, marginBottom: -space.s, flexShrink: 1, maxWidth: '100%' }}>
      {choices.map((choice, i) => {
        const right = i === answer;
        const wrongPick = i === picked && !right;
        // A right pick is marked by the check alone; the meaning, when it wasn't picked, says so. A
        // wrong pick is marked by an X alone (its row is dimmer red, and VoiceOver says "your pick").
        const note = right && !gotIt ? 'Meaning' : null;
        const row = (
          <View
            accessible
            accessibilityLabel={`${choice}${right ? (gotIt ? ', right' : ', the meaning') : wrongPick ? ', your pick' : ''}`}
            style={{
              minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s,
              paddingHorizontal: CHOICE_PAD, borderRadius: radius.m, ...smooth,
              backgroundColor: right ? c.goodFill : wrongPick ? c.dangerFill : c.fill, opacity: right || wrongPick ? 1 : 0.5,
            }}
          >
            <Text style={{ ...type.body, color: c.text, fontWeight: right ? '600' : '400', flexShrink: 1 }}>{choice}</Text>
            {right || wrongPick ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                {right ? <Icon name="checkmark.circle.fill" size={18} color={c.good} /> : null}
                {wrongPick ? <Icon name="xmark.circle.fill" size={18} color={c.danger} /> : null}
                {note ? <Text style={{ ...type.footnote, color: c.goodInk }}>{note}</Text> : null}
              </View>
            ) : null}
          </View>
        );
        const key = `${i}:${choice}`;
        const padded = (inner: React.ReactNode) => <View key={key} style={{ paddingBottom: space.s }}>{inner}</View>;
        if (right || wrongPick) return padded(row);
        if (settled) return null;
        return <Collapse key={key} delay={FOLD_STAGGER_MS * folded++}>{padded(row)}</Collapse>;
      })}
    </View>
  );
}

/** Feedback for a right quiz answer, as the popover shows it. */
export const rightAnswer = () => haptic.success();
