import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ANSWER_BUTTON_CHOICES, type AnswerButtons } from '../core/answerButtons';
import type { Repo } from '../db/repo';
import { Card, Help, NavRow, Screen } from './kit';
import { MIN_TAP, space, type, useTheme } from './theme';

/**
 * App-wide settings: the screens that aren't about studying (Anki, Stats, Backup), and which
 * answer buttons Review shows.
 */
export function Settings({ repo, backupText, onAnki, onStats, onBackup, onDone }: {
  repo: Repo;
  /** When the last backup was made (`backupStatus`). */
  backupText?: string;
  onAnki: () => void;
  onStats: () => void;
  onBackup: () => void;
  onDone: () => void;
}) {
  const c = useTheme();
  const [buttons, setButtons] = useState<AnswerButtons>();

  useEffect(() => { repo.answerButtons().then(setButtons); }, [repo]);

  const choose = async (value: AnswerButtons) => {
    setButtons(value);
    await repo.saveAnswerButtons(value);
  };

  return (
    <Screen onBack={onDone} title="Settings">
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
        <Card style={{ paddingVertical: 0, gap: 0 }}>
          <NavRow first label="Anki" detail="Sync, or send your collection to and from Anki by file" onPress={onAnki} />
          <NavRow label="Stats" detail="Answers, how much you remember, and what's coming due" onPress={onStats} />
          <NavRow label="Backup" detail={backupText ?? 'Save or restore everything in Franki'} onPress={onBackup} />
        </Card>
        <Card>
          <Text style={{ ...type.headline, color: c.text }}>Answer buttons</Text>
          <Help>
            The buttons shown after the answer, for every deck. Whether you remembered a card matters most to the
            schedule. Hard and Easy only move the next review a little closer or further out.
          </Help>
          <View accessibilityRole="radiogroup">
            {ANSWER_BUTTON_CHOICES.map((choice) => {
              const selected = buttons === choice.value;
              return (
                <Pressable
                  key={choice.value}
                  onPress={() => choose(choice.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => ({ minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s, opacity: pressed ? 0.6 : 1 })}
                >
                  <View style={{
                    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: selected ? c.accent : c.border,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {selected ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c.accent }} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...type.body, color: c.text }}>{choice.label}</Text>
                    <Text style={{ ...type.footnote, color: c.textSecondary }}>{choice.hint}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Help>
            Always press Again for a card you didn't remember, even one you nearly had. If you change how you use the
            buttons, run Optimize in each deck's options in Anki after a few weeks, so its schedule learns your new habit.
          </Help>
        </Card>
      </ScrollView>
    </Screen>
  );
}
