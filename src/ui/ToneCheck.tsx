import React from 'react';
import { Text, View } from 'react-native';
import { shapeName, toneCheckLabel, type SyllableCheck } from '../core/toneCheck';
import { hairline, radius, space, type, useTheme } from './theme';

/**
 * The tone check under Record yourself's pitch line (src/core/toneCheck.ts): each syllable of a Thai
 * word, the recording's tone shape and the take's, and Same or Different, or that the pitch wasn't
 * clear enough to say. A guide, never a score or a rating.
 */
export function ToneCheck({ checks }: { checks: readonly SyllableCheck[] }) {
  const c = useTheme();
  if (!checks.length) return null;
  return (
    <View style={{ gap: space.s }} accessible accessibilityLabel={`Tone check. ${toneCheckLabel(checks)}.`}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {checks.map((check, i) => {
          const different = check.verdict === 'different';
          return (
            <View
              key={`${check.syllable}:${i}`}
              style={{
                flexGrow: 1, flexBasis: 90, alignItems: 'center', gap: 2, padding: space.s, borderRadius: radius.m,
                backgroundColor: c.fill, borderWidth: hairline * 2, borderColor: different ? c.danger : 'transparent',
              }}
            >
              <Text style={{ ...type.callout, fontWeight: '600', color: c.text }}>{check.syllable}</Text>
              {check.verdict === 'unclear' ? (
                <Text style={{ ...type.caption, color: c.textSecondary, textAlign: 'center' }}>Pitch not clear enough to say</Text>
              ) : (
                <>
                  <Text style={{ ...type.caption, color: c.textSecondary, textAlign: 'center' }}>{`Recording: ${shapeName(check.recording!).toLowerCase()}`}</Text>
                  <Text style={{ ...type.caption, color: c.textSecondary, textAlign: 'center' }}>{`You: ${shapeName(check.yours!).toLowerCase()}`}</Text>
                  <Text style={{ ...type.caption, fontWeight: '700', color: different ? c.danger : c.goodInk }}>{different ? 'Different' : 'Same'}</Text>
                </>
              )}
            </View>
          );
        })}
      </View>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>A guide, not a score: the phone hears pitch, and a creaky or quiet take can throw it. It never changes how a card is rated.</Text>
    </View>
  );
}
