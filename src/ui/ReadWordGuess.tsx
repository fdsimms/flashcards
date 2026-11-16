import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { GUESS_HINT, type TapMode } from '../reader/guess';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { Pop } from './motion';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from './theme';

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

/**
 * The quiz's choices once answered: the right one marked (and springing in, with a check, when it
 * was picked), a wrong pick marked, the rest dimmed. Each mark has a word as well as a color.
 */
export function QuizChoices({ choices, answer, picked }: { choices: string[]; answer: number; picked: number | null }) {
  const c = useTheme();
  const gotIt = picked === answer;
  return (
    <View style={{ gap: space.s, marginTop: space.xs }}>
      {choices.map((choice, i) => {
        const right = i === answer;
        const wrongPick = i === picked && !right;
        const note = right ? (gotIt ? 'Right' : 'Meaning') : wrongPick ? 'Your pick' : null;
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
            {note ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                {right ? <Icon name="checkmark.circle.fill" size={18} color={c.good} effect={gotIt ? 'bounce' : undefined} /> : null}
                <Text style={{ ...type.footnote, color: right ? c.good : c.danger }}>{note}</Text>
              </View>
            ) : null}
          </View>
        );
        return right && gotIt ? <Pop key={`${i}:${choice}`} from={0.96} bounciness={10}>{row}</Pop> : <React.Fragment key={`${i}:${choice}`}>{row}</React.Fragment>;
      })}
    </View>
  );
}

/** Feedback for a right quiz answer, as the popover shows it. */
export const rightAnswer = () => haptic.success();
