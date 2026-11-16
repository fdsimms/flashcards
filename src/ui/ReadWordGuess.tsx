import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { GUESS_HINT, type TapMode } from '../reader/guess';
import { haptic } from './haptics';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from './theme';

/**
 * What a tapped word's popover shows while its meaning is held back (src/reader/guess.ts): a line
 * saying what to try, for a word outside the deck an optional box for a guess, and for a known word
 * with the quiz on four meanings to choose from. Once the meaning is shown, the quiz's choices stay
 * as a record of the answer (`QuizChoices`) and a guess is shown beside it (`GuessLine`). A guess is
 * kept only while the popover is open: it isn't graded, saved or sent anywhere.
 */

const CHOICE_PAD = space.m;

export function GuessPrompt({ mode, guess, onGuess, onFocus, onBlur, onPick, onGiveUp }: {
  mode: NonNullable<TapMode>;
  guess: string;
  onGuess: (text: string) => void;
  /** The box is focused: the popover moves up out of the keyboard's way. */
  onFocus: () => void;
  onBlur: () => void;
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
        <Pressable
          onPress={onGiveUp}
          accessibilityRole="button"
          accessibilityLabel="I don't know"
          style={{ minHeight: MIN_TAP, justifyContent: 'center', alignItems: 'center', borderRadius: radius.m, ...smooth, backgroundColor: c.accentFill }}
        >
          <Text style={{ ...type.body, color: c.accent, fontWeight: '600' }}>I don't know</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={{ gap: space.s }}>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{GUESS_HINT[mode.kind]}</Text>
      {mode.kind === 'infer' ? (
        <TextInput
          value={guess}
          onChangeText={onGuess}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder="Your guess (optional)"
          placeholderTextColor={c.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          accessibilityLabel="Your guess"
          style={{
            ...type.body, color: c.text, minHeight: MIN_TAP, paddingHorizontal: CHOICE_PAD, borderRadius: radius.m, ...smooth,
            backgroundColor: c.fill, borderColor: c.border, borderWidth: hairline,
          }}
        />
      ) : null}
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

/** What was guessed, beside the meaning. Nothing when the box was left empty. */
export function GuessLine({ guess }: { guess: string }) {
  const c = useTheme();
  const text = guess.trim();
  return text ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{`Your guess: ${text}`}</Text> : null;
}

/** Feedback for a right quiz answer, before the popover closes. */
export const rightAnswer = () => haptic.success();
