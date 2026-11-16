import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import type { StageStep } from '../reader/making';
import { Card, Icon } from './kit';
import { space, type, useTheme } from './theme';

/**
 * Something Claude or the server is making in the background (a text, an episode, a grammar page,
 * an audio lesson): its name, the steps it goes through with the finished ones checked and the
 * current one marked, and a spinner at the end. A thing with no stages of its own passes `detail`,
 * one line saying what is happening, instead of `steps`. Without a Group around it, use
 * `MakingCard`; a row inside a Group uses `MakingBody` (the lessons list).
 */
export function MakingBody({ title, steps, detail }: { title: string; steps?: StageStep[]; detail?: string }) {
  const c = useTheme();
  const at = steps ? steps.findIndex((s) => s.status === 'now') : -1;
  const now = steps && at >= 0 ? `${steps[at].label}, step ${at + 1} of ${steps.length}` : detail;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={now ? `${title}. ${now}` : title}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}
    >
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={{ ...type.body, color: c.text }}>{title}</Text>
        {steps?.map((s) => (
          <View key={s.label} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            <Icon
              name={s.status === 'done' ? 'checkmark.circle.fill' : s.status === 'now' ? 'circle.inset.filled' : 'circle'}
              size={14}
              color={s.status === 'todo' ? c.textTertiary : c.accent}
              effect={s.status === 'now' ? 'pulse' : undefined}
            />
            <Text style={{ ...type.footnote, color: s.status === 'now' ? c.text : s.status === 'done' ? c.textSecondary : c.textTertiary }}>{s.label}</Text>
          </View>
        ))}
        {detail && !steps ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{detail}</Text> : null}
      </View>
      <ActivityIndicator color={c.accent} />
    </View>
  );
}

/** `MakingBody` as a card of its own. */
export function MakingCard(props: { title: string; steps?: StageStep[]; detail?: string }) {
  return (
    <Card>
      <MakingBody {...props} />
    </Card>
  );
}
