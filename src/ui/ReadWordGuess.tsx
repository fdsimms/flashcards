import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { GUESS_HINT, type TapMode } from '../reader/guess';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from './theme';

/**
 * What a known word's popover shows while its meaning is held back (src/reader/guess.ts): a line
 * saying what to try, and with the quiz on, four meanings to choose from. Once the meaning is shown,
 * the quiz's choices stay as a record of the answer (`QuizChoices`).
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
          <Pressable
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
          </Pressable>
        ))}
        <Tappable
          onPress={onGiveUp}
          accessibilityRole="button"
          accessibilityLabel="I don't know"
          style={{
            minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s,
            borderRadius: radius.m, ...smooth, borderColor: c.border, borderWidth: 1,
          }}
        >
          <Icon name="questionmark.circle" size={18} color={c.textSecondary} />
          <Text style={{ ...type.body, color: c.textSecondary }}>I don't know</Text>
        </Tappable>
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

/** The quiz's choices once answered: the right one and a wrong pick marked, the rest dimmed. */
export function QuizChoices({ choices, answer, picked }: { choices: string[]; answer: number; picked: number | null }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.s, marginTop: space.xs }}>
      {choices.map((choice, i) => {
        const right = i === answer;
        const wrongPick = i === picked && !right;
        return (
          <View
            key={`${i}:${choice}`}
            accessible
            accessibilityLabel={`${choice}${right ? ', the meaning' : wrongPick ? ', your pick' : ''}`}
            style={{
              minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: CHOICE_PAD, borderRadius: radius.m, ...smooth,
              backgroundColor: right ? c.goodFill : wrongPick ? c.dangerFill : c.fill, opacity: right || wrongPick ? 1 : 0.5,
            }}
          >
            <Text style={{ ...type.body, color: c.text, fontWeight: right ? '600' : '400' }}>{choice}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** Feedback for a right quiz answer, before the popover closes. */
export const rightAnswer = () => haptic.success();
