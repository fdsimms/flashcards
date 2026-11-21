import React from 'react';
import { Text, View } from 'react-native';
import type { WordChoice } from '../core/quickAdd';
import { Button, CheckRow, Group, Help } from './kit';
import { radius, smooth, space, type, useTheme } from './theme';

/**
 * Above a queued note in the note editor, when the word was typed the way it sounds and could be more
 * than one word ("bit": быть or бить): the note is filled in for the first, which is checked. Choosing
 * another closes the editor and queues that word to be filled in instead; Remove takes the word off the
 * queue. Both go back to the queue's screen through the editor's result (read-note-queue.tsx).
 */
export function WordChoiceCard({ choice, onChoose, onRemove }: {
  choice: WordChoice;
  onChoose: (word: { entry: string; meaning: string }) => void;
  onRemove: () => void;
}) {
  const c = useTheme();
  const [current, ...others] = choice.words;
  return (
    <View style={{ gap: space.s }}>
      <View style={{ backgroundColor: c.warningFill, borderRadius: radius.m, ...smooth, padding: space.m }}>
        <Text style={{ ...type.subhead, color: c.warningInk }}>
          {`You typed ${choice.typed}. That could be ${choice.words.length} words. Choose the one you meant.`}
        </Text>
      </View>
      <Group accessibilityRole="radiogroup">
        <CheckRow first label={current.entry} hint={current.meaning} selected onPress={() => {}} />
        {others.map((w) => (
          <CheckRow key={w.entry} label={w.entry} hint={w.meaning} selected={false} onPress={() => onChoose(w)} />
        ))}
      </Group>
      <Help>Choosing another word starts a new note for it. It'll be in the list again, ready to review.</Help>
      <Button label={`Neither. Remove ${choice.typed} from the queue`} variant="destructive" onPress={onRemove} />
    </View>
  );
}
