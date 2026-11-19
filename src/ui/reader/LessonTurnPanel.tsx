import React from 'react';
import { Text, View } from 'react-native';
import { haptic } from '../haptics';
import { Divider, Group, Icon, Tappable } from '../kit';
import { MIN_TAP, radius, space, type, useTheme } from '../theme';
import type { LessonTurns } from '../useLessonTurns';

/**
 * What the lesson's player shows about the learner's turn (useLessonTurns): that it's listening for
 * the end of the answer, Again while it waits, and after the answer the two takes to hear again (the
 * lesson's recording, then yours; or yours alone).
 */
export function LessonTurnPanel({ turns, held }: { turns: LessonTurns; held: boolean }) {
  const c = useTheme();
  const listening = held && turns.recording && turns.listen;
  return (
    <>
      {listening ? (
        <View style={{ alignItems: 'center', gap: space.xs }}>
          <View accessible accessibilityLabel="Listening for your answer" style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: space.s, paddingHorizontal: space.l, borderRadius: radius.pill, backgroundColor: c.accentFill }}>
            <Icon name="mic.fill" size={16} color={c.accentInk} effect="pulse" />
            <Text style={{ ...type.subhead, fontWeight: '600', color: c.accentInk }}>Listening</Text>
          </View>
          <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>Goes on by itself a second after you stop talking.</Text>
        </View>
      ) : null}
      {held && turns.canAgain ? (
        <View style={{ alignItems: 'center' }}>
          <Tappable
            onPress={() => { haptic.tap(); turns.again(); }}
            accessibilityRole="button"
            accessibilityLabel="Again"
            accessibilityHint="Plays the question once more, and keeps the phrase for a review"
            style={{ minHeight: MIN_TAP, paddingHorizontal: space.l, borderRadius: radius.pill, backgroundColor: c.fill, flexDirection: 'row', alignItems: 'center', gap: space.s }}
          >
            <Icon name="arrow.counterclockwise" size={16} color={c.text} />
            <Text style={{ ...type.subhead, fontWeight: '600', color: c.text }}>Again</Text>
          </Tappable>
        </View>
      ) : null}
      {turns.take ? (
        <Group>
          <TakeRow first label="Recording" detail={turns.take.turn.text} icon="play.fill" onPress={turns.replayAnswer} hint="Plays the answer, then your take" />
          <TakeRow label="You" detail="Your answer" icon={turns.take.playing ? 'speaker.wave.2.fill' : 'play.fill'} onPress={turns.playTake} hint="Plays your take" />
        </Group>
      ) : null}
    </>
  );
}

function TakeRow({ label, detail, icon, onPress, hint, first }: { label: string; detail: string; icon: 'play.fill' | 'speaker.wave.2.fill'; onPress: () => void; hint: string; first?: boolean }) {
  const c = useTheme();
  return (
    <Tappable onPress={() => { haptic.tap(); onPress(); }} accessibilityRole="button" accessibilityLabel={`${label}, ${detail}`} accessibilityHint={hint} scaleTo={0.99}>
      <View style={{ minHeight: MIN_TAP + space.m, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m, paddingHorizontal: space.l }}>
        {first ? null : <Divider inset={space.l} />}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...type.body, color: c.text }}>{label}</Text>
          <Text numberOfLines={1} style={{ ...type.footnote, color: c.textSecondary }}>{detail}</Text>
        </View>
        <Icon name={icon} size={18} color={c.accent} />
      </View>
    </Tappable>
  );
}
