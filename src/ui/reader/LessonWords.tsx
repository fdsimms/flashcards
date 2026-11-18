import { useRouter } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';
import { LESSON_MAX_WORDS } from '../../core/cram';
import type { LessonWord } from '../../core/lessonWords';
import { haptic } from '../haptics';
import { Button, Icon, Tappable } from '../kit';
import { radius, space, type, useTheme } from '../theme';

/**
 * The New lesson card's "Words to teach" part: the words chosen so far, each with a button to take
 * it out, and the two ways to add more (from the decks, or typed in). Nothing here is required:
 * with none chosen, Claude picks the lesson's phrases from the scene.
 */
export function LessonWords({ words, onRemove, onClear }: { words: LessonWord[]; onRemove: (text: string) => void; onClear: () => void }) {
  const c = useTheme();
  const router = useRouter();
  return (
    <View style={{ gap: space.s }}>
      <Text style={{ ...type.subhead, color: c.textSecondary }}>Words to teach (optional)</Text>
      {words.length ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {words.map((w) => (
              <Tappable
                key={w.text}
                onPress={() => { haptic.tap(); onRemove(w.text); }}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${w.text}, ${w.english}`}
                scaleTo={0.95}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, backgroundColor: c.accentFill, borderRadius: radius.pill, paddingVertical: space.xs + 2, paddingLeft: space.m, paddingRight: space.s }}
              >
                <Text style={{ ...type.subhead, color: c.accentInk }}>{w.text}</Text>
                <Text style={{ ...type.caption, color: c.textSecondary }}>{w.english}</Text>
                <Icon name="xmark" size={11} color={c.textSecondary} />
              </Tappable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ ...type.footnote, color: c.textSecondary }}>{`${words.length} of ${LESSON_MAX_WORDS} words`}</Text>
            <Tappable onPress={() => { haptic.tap(); onClear(); }} accessibilityRole="button" accessibilityLabel="Remove all words">
              <Text style={{ ...type.footnote, color: c.accentInk }}>Remove all</Text>
            </Tappable>
          </View>
        </>
      ) : null}
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button variant="secondary" label="From my decks" onPress={() => router.push('/lesson-words')} style={{ flex: 1, paddingHorizontal: space.s }} />
        <Button variant="secondary" label="Type a phrase" onPress={() => router.push('/lesson-word-add')} style={{ flex: 1, paddingHorizontal: space.s }} />
      </View>
    </View>
  );
}
