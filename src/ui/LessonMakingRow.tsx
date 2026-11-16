import React from 'react';
import { View } from 'react-native';
import type { AudioLesson } from '../reader/api';
import { stageSteps } from '../reader/lessons';
import { Divider } from './kit';
import { MakingBody } from './MakingCard';
import { space } from './theme';

/**
 * A lesson being made, as a row in the lessons list's Group: its name, the steps it goes through
 * and a spinner where an openable row has its chevron (it can't be opened yet). `lessonDetail`
 * says the same current step in a line, for the row's spoken label.
 */
export function LessonMakingRow({ lesson, first }: { lesson: AudioLesson; first?: boolean }) {
  return (
    <View style={{ paddingVertical: space.m, paddingHorizontal: space.l }}>
      {first ? null : <Divider inset={space.l} />}
      <MakingBody title={lesson.title} steps={stageSteps(lesson.stage)} />
    </View>
  );
}
