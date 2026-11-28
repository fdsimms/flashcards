import React from 'react';
import { Text, View } from 'react-native';
import { accentCheckLabel, accentPattern, type AccentCheck as Check } from '../core/pitchAccent';
import { radius, space, type, useTheme } from './theme';

/**
 * The pitch accent check under Record yourself's pitch line (src/core/pitchAccent.ts): a Japanese
 * word's morae for the recording and for the take, a line over each high one and ꜜ where the pitch
 * drops, then whether they drop in the same place. A guide, never a score or a rating.
 */
export function AccentCheck({ check }: { check: Check }) {
  const c = useTheme();
  const different = check.verdict === 'different';
  return (
    <View style={{ gap: space.s, padding: space.s, borderRadius: radius.m, backgroundColor: c.fill }} accessible accessibilityLabel={`Pitch accent check. ${accentCheckLabel(check)}`}>
      <Row label="Recording" split={check.morae} drop={check.recording} />
      <Row label="You" split={check.morae} drop={check.yours} />
      <Text style={{ ...type.footnote, fontWeight: '600', color: check.verdict === 'unclear' ? c.textSecondary : different ? c.danger : c.goodInk }}>{accentCheckLabel(check)}</Text>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>
        A guide, not a score. A word that doesn't drop inside it sounds the same whether it's flat or drops on the particle after it. It never changes how a card is rated.
      </Text>
    </View>
  );
}

function Row({ label, split, drop }: { label: string; split: readonly string[]; drop: number | null | undefined }) {
  const c = useTheme();
  const pattern = drop === undefined ? null : accentPattern(split.length, drop);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
      <Text style={{ ...type.footnote, color: c.textSecondary, width: 76 }}>{label}</Text>
      {pattern ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          {split.map((m, i) => (
            <React.Fragment key={i}>
              <Text style={{ ...type.title, fontWeight: '500', color: c.text, paddingTop: 4, paddingHorizontal: 2, borderTopWidth: 2, borderColor: pattern[i] === 'high' ? c.accent : 'transparent' }}>{m}</Text>
              {drop === i && i < split.length - 1 ? <Text style={{ ...type.callout, color: c.accentInk }}>ꜜ</Text> : null}
            </React.Fragment>
          ))}
        </View>
      ) : (
        <Text style={{ ...type.footnote, color: c.textSecondary, flexShrink: 1 }}>{`${split.join('')}: pitch not clear enough to say`}</Text>
      )}
    </View>
  );
}
