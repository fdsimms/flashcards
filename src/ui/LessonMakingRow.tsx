import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import type { AudioLesson } from '../reader/api';
import { stageSteps } from '../reader/lessons';
import { Divider, Icon } from './kit';
import { space, type, useTheme } from './theme';

/**
 * A lesson being made, as a row in the lessons list's Group: its name, the steps it goes through
 * with the finished ones checked and the current one marked, and a spinner where an openable row
 * has its chevron (it can't be opened yet). `lessonDetail` says the same current step in a line,
 * for the row's spoken label.
 */
export function LessonMakingRow({ lesson, first }: { lesson: AudioLesson; first?: boolean }) {
  const c = useTheme();
  const steps = stageSteps(lesson.stage);
  const at = steps.findIndex((s) => s.status === 'now');
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${lesson.title}. ${steps[at].label}, step ${at + 1} of ${steps.length}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m, paddingHorizontal: space.l }}
    >
      {first ? null : <Divider inset={space.l} />}
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={{ ...type.body, color: c.text }}>{lesson.title}</Text>
        {steps.map((s) => (
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
      </View>
      <ActivityIndicator color={c.accent} />
    </View>
  );
}
