import React from 'react';
import { Text, View } from 'react-native';
import type { TextChoice } from '../reader/api';
import { choiceText } from '../reader/choices';
import { haptic } from './haptics';
import { Card, ErrorNote, Help, Tappable } from './kit';
import { radius, space, type, useTheme } from './theme';
import type { ReadTextStyle } from './ReadWord';

/**
 * The end of a story episode: what could happen next, to pick one. The server writes the next
 * episode from the pick once this one is read. Each option is plain text with its English under it
 * rather than tappable words, since the option itself is the thing to tap. `onChoose` is null for
 * an episode already read, which shows only the option that was picked.
 */
export function ReadChoices({ choices, chosen, textStyle, onChoose, error }: {
  choices: TextChoice[];
  chosen: number | null;
  textStyle: ReadTextStyle;
  onChoose: ((index: number) => void) | null;
  error: string | null;
}) {
  const c = useTheme();
  return (
    <Card style={{ gap: space.s }}>
      <Text accessibilityRole="header" style={{ ...type.headline, color: c.text }}>What happens next?</Text>
      <Help>
        {onChoose
          ? "Your choice shapes the next episode. If you don't choose, the story carries on by itself."
          : 'You chose this for the next episode.'}
      </Help>
      <View accessibilityRole="radiogroup" style={{ gap: space.s }}>
        {choices.map((choice, i) => {
          const selected = chosen === i;
          if (!onChoose && !selected) return null;
          const look = {
            borderWidth: 1, borderRadius: radius.m, paddingHorizontal: space.l, paddingVertical: space.m, gap: 2,
            borderColor: selected ? c.accent : c.border, backgroundColor: selected ? c.accentFill : undefined,
          } as const;
          const body = (
            <>
              <Text style={{ fontSize: textStyle.fontSize, lineHeight: textStyle.lineHeight, fontFamily: textStyle.font.fontFamily, fontWeight: '600', color: selected ? c.accent : c.text }}>
                {choiceText(choice)}
              </Text>
              <Text style={{ ...type.footnote, color: selected ? c.accent : c.textSecondary }}>{choice.english}</Text>
            </>
          );
          return onChoose ? (
            <Tappable
              key={i}
              onPress={() => { haptic.select(); onChoose(i); }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${choiceText(choice)}. ${choice.english}`}
              scaleTo={0.98}
              style={look}
            >
              {body}
            </Tappable>
          ) : (
            <View key={i} style={look}>{body}</View>
          );
        })}
      </View>
      {error ? <ErrorNote message={error} /> : null}
    </Card>
  );
}
