import React from 'react';
import type { AudioLesson } from '../../reader/api';
import { scriptOf } from '../../reader/lessonScript';
import { waitHint } from '../../reader/lessonWaits';
import { SwitchRow } from '../kit';
import type { LessonTurns } from '../useLessonTurns';
import type { LessonWaits } from '../useLessonWaits';

/**
 * The lesson player's switches, the same settings as Settings, Lessons: Wait for my answer, Carry on
 * when I stop talking (which only applies while the lesson waits, so it shows only then), and Play my
 * answer back. Rows of the player's Group, `first` on the first.
 */
export function LessonTurnSettings({ lesson, waits, turns }: { lesson?: Pick<AudioLesson, 'pauses' | 'script'>; waits: LessonWaits; turns: LessonTurns }) {
  const transcript = !lesson || scriptOf(lesson) !== null;
  return (
    <>
      <SwitchRow first label="Wait for my answer" hint={lesson ? waitHint(lesson) : 'Stops at each pause until you tap Continue'} value={waits.on} onValueChange={waits.setOn} />
      {waits.on ? (
        <SwitchRow label="Carry on when I stop talking" hint="Listens at each pause, so you don't need to tap" value={turns.listen} onValueChange={turns.setListen} />
      ) : null}
      <SwitchRow
        label="Play my answer back"
        hint={transcript ? 'After each answer, then the lesson goes on' : 'This lesson was made before transcripts were kept, so it has no answers to play back.'}
        value={turns.playBack}
        onValueChange={turns.setPlayBack}
      />
    </>
  );
}
