import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { failureText } from '../core/failure';
import { FURIGANA_MODES, furiganaRuns, shownRuns, type FuriganaMode } from '../core/furigana';
import { JAPANESE_FONT } from '../core/script';
import type { Repo } from '../db/repo';
import { Card, CheckRow, Group, Help, Screen, Section, SECTION_GAP } from './kit';
import { Ruby } from './Ruby';
import { space, type, useTheme, readable } from './theme';

// The example under the choices: 劇団, with 団 taken as learned, so each choice shows what it does.
const EXAMPLE = furiganaRuns('劇団', 'げきだん', (k) => ({ 劇: ['げき'], 団: ['だん'] } as Record<string, string[]>)[k]);
const EXAMPLE_LEARNED = { kanji: new Set(['団']), vocabulary: new Set<string>() };

/** Settings, Furigana: where a Japanese word's reading is set above its kanji, once the answer shows. */
export function FuriganaSettings({ repo, wanikaniOn }: { repo: Repo; wanikaniOn: boolean }) {
  const c = useTheme();
  const [mode, setMode] = useState<FuriganaMode>();
  useFocusEffect(useCallback(() => { repo.furiganaMode().then(setMode).catch(() => undefined); }, [repo]));

  // Saved first, then shown, so the screen never shows a setting that isn't stored.
  const choose = async (value: FuriganaMode) => {
    try {
      await repo.saveFuriganaMode(value);
      setMode(value);
    } catch (e) {
      Alert.alert("Couldn't save this setting", failureText(e, { next: 'Try again.' }));
    }
  };

  const shown = shownRuns(EXAMPLE, mode ?? 'off', EXAMPLE_LEARNED, '劇団');
  return (
    <Screen title="Furigana">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: SECTION_GAP }}>
        <Section
          footer={(
            <Help>
              Shows a Japanese word's reading above its kanji once the answer is shown, on the word and in its example
              sentence. The front of a card never shows it, since the reading is often the answer.
              {mode === 'unlearned'
                ? wanikaniOn
                  ? " Hides the reading over kanji you've taken to Guru in WaniKani, and over words you learned there. In this example, you know 団."
                  : " Enter your WaniKani token in Settings, WaniKani to use this. Until then it shows a reading over every kanji."
                : ''}
            </Help>
          )}
        >
          <Group accessibilityRole="radiogroup">
            {FURIGANA_MODES.map((m, i) => (
              <CheckRow key={m.value} first={i === 0} label={m.label} selected={mode === m.value} onPress={() => void choose(m.value)} />
            ))}
          </Group>
          <Card style={{ alignItems: 'center' }}>
            <Ruby runs={shown} style={{ ...type.cardFront, fontFamily: JAPANESE_FONT, color: c.text }} rubyColor={c.textSecondary} center />
          </Card>
        </Section>
      </ScrollView>
    </Screen>
  );
}
