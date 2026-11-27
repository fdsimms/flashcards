import { useRouter } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';
import { studiedCount, TEXTS_AT } from '../../core/fromZero';
import type { GlossLanguage } from '../../reader/api';
import { glossInfo } from '../../reader/languages';
import { usePathWords } from '../FromZeroCards';
import { useFromZero } from '../fromZeroStorage';
import { Button, Card } from '../kit';
import { LESSONS_PATH } from '../tabPaths';
import { radius, space, type, useTheme } from '../theme';

/**
 * The shelf's note for a language started from zero (src/core/fromZero.ts): a text needs most of its words
 * known, so until about `TEXTS_AT` words are studied it says when texts start, and sends the learner to the
 * lessons made from their first words. Drawn above the shelf; nothing when the language isn't on a path.
 */
export function ReadFromZero({ language }: { language: GlossLanguage }) {
  const c = useTheme();
  const router = useRouter();
  const path = useFromZero().find((z) => z.language === language);
  const { words } = usePathWords(path);
  if (!path) return null;
  const studied = studiedCount(words);
  return (
    <Card style={{ gap: space.s }}>
      <Text style={{ ...type.overline, color: c.textSecondary }}>{`${glossInfo(language).name} from zero`}</Text>
      <Text style={{ ...type.body, color: c.text }}>{`Texts start once you've studied about ${TEXTS_AT} words.`}</Text>
      <View style={{ height: 6, borderRadius: radius.pill, backgroundColor: c.fill, overflow: 'hidden' }}>
        <View style={{ width: `${Math.round(Math.min(1, studied / TEXTS_AT) * 100)}%`, height: '100%', backgroundColor: c.accent }} />
      </View>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{`You've studied ${studied}. Until then, the lessons made from your first words are in Lessons.`}</Text>
      <Button label="Go to Lessons" variant="secondary" onPress={() => router.push(LESSONS_PATH)} />
    </Card>
  );
}
