import React from 'react';
import { Text, View } from 'react-native';
import { compareTyped } from '../core/typedCompare';
import type { WritingCheck } from '../reader/api';
import { verdictLine } from '../reader/production';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { MIN_TAP, radius, smooth, space, type, useTheme } from './theme';
import { TypedDiff } from './TypedDiff';

/**
 * Claude's check of something the owner wrote (reader/production.ts): how it went, what they wrote
 * against the corrected version (only the mistakes picked out, typedCompare.ts), its English, and the
 * notes on what changed. Shared by Use today's words, Sentences' Check mine and Retell it. Nothing here
 * grades a card.
 */
export function WritingResult({ check, attempt, lang, onPlay }: {
  check: WritingCheck;
  attempt: string;
  /** The language's speech tag, for VoiceOver. */
  lang?: string;
  /** Reads the corrected version aloud. */
  onPlay?: () => void;
}) {
  const c = useTheme();
  const tone = check.used_word === false || check.verdict === 'almost' ? c.warning : check.verdict === 'right' ? c.countDue : c.danger;
  const icon = check.verdict === 'right' && check.used_word !== false ? 'checkmark.circle.fill' : check.verdict === 'wrong' ? 'xmark.circle.fill' : 'exclamationmark.circle.fill';
  const comparison = compareTyped(check.corrected, attempt);
  return (
    <View style={{ gap: space.m }}>
      <View accessible accessibilityRole="text" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}>
        <Icon name={icon} size={20} color={tone} />
        <Text style={{ ...type.headline, color: tone, flex: 1 }}>{verdictLine(check)}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
        <View style={{ flex: 1 }}>
          <TypedDiff comparison={comparison} showExpected size="body" lang={lang} expectedLabel="Corrected" showLine={false} />
        </View>
        {onPlay ? (
          <Tappable
            onPress={() => { haptic.tap(); onPlay(); }}
            accessibilityRole="button"
            accessibilityLabel="Play the corrected version"
            style={{ width: MIN_TAP, height: MIN_TAP, borderRadius: radius.pill, backgroundColor: c.accentFill, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="play.fill" size={16} color={c.accent} />
          </Tappable>
        ) : null}
      </View>
      {check.english ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{check.english}</Text> : null}
      {check.notes.length ? (
        <View style={{ backgroundColor: c.fill, borderRadius: radius.m, ...smooth, padding: space.m, gap: space.s }}>
          {check.notes.map((n) => <Text key={n} style={{ ...type.subhead, color: c.text }}>{n}</Text>)}
        </View>
      ) : null}
    </View>
  );
}
