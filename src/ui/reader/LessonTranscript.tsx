import React from 'react';
import { Text, View } from 'react-native';
import { heardSoFar, speakerLabel, type ScriptEntry } from '../../reader/lessonScript';
import { haptic } from '../haptics';
import { Divider, Group, Tappable } from '../kit';
import { space, type, useTheme } from '../theme';

/** How many of the latest things said the transcript shows. */
const SHOWN = 8;

/**
 * An audio lesson's transcript as it plays (lessonScript.ts): what's been said so far, the latest at
 * the bottom and the one playing marked. What's coming isn't shown, so an answer stays hidden until
 * it's been said. A tap on something said goes back to it. Each speaker's name has a line of its
 * own above what they say, so a long name or a large text size never runs into the words.
 */
export function LessonTranscript({ entries, seconds, onSeek }: { entries: readonly ScriptEntry[]; seconds: number; onSeek: (ms: number) => void }) {
  const c = useTheme();
  const ms = seconds * 1000;
  const heard = heardSoFar(entries, seconds).slice(-SHOWN);
  if (!heard.length) {
    return <Group><Text style={{ ...type.subhead, color: c.textSecondary, padding: space.l }}>The transcript follows the lesson once it plays.</Text></Group>;
  }
  return (
    <Group accessibilityRole="list">
      {heard.map((e, i) => {
        const now = ms >= e.start && ms < e.end;
        const turn = e.kind === 'turn';
        const row = (
          <View style={{ paddingVertical: space.m, paddingHorizontal: space.l, gap: space.xs, backgroundColor: now ? c.accentFill : undefined, opacity: now || i >= heard.length - 3 ? 1 : 0.6 }}>
            {i === 0 ? null : <Divider inset={space.l} />}
            <Text style={{ ...type.caption, fontWeight: now ? '600' : '400', color: now ? c.accentInk : c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 }}>{speakerLabel(e)}</Text>
            <Text style={{ ...type.body, color: turn ? c.accentInk : c.text, fontStyle: turn ? 'italic' : 'normal' }}>{turn ? 'Your turn' : e.text}</Text>
            {!turn && e.voice === 'native' && e.english ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{e.english}</Text> : null}
          </View>
        );
        return turn ? <View key={`${e.start}-turn`}>{row}</View> : (
          <Tappable key={`${e.start}-say`} onPress={() => { haptic.tap(); onSeek(e.start); }} accessibilityRole="button" accessibilityLabel={`${speakerLabel(e)}: ${e.text}`} accessibilityHint="Plays the lesson from here" scaleTo={0.99}>
            {row}
          </Tappable>
        );
      })}
    </Group>
  );
}
