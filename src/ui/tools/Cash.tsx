import React from 'react';
import { Text, View } from 'react-native';
import { pieceLabel, type Currency, type Piece } from '../../tools/money';
import { hairline, radius, space, type, useTheme } from '../theme';

/**
 * Notes and coins laid out to count: plain tints with the amount on, never a picture of a real
 * note. A note's tint goes by its place in the currency's notes, so the same note always looks
 * the same. VoiceOver reads the pile as a list of what's in it, not the total.
 */
export function Cash({ pieces, currency }: { pieces: Piece[]; currency: Currency }) {
  const c = useTheme();
  const label = pieces.map((p) => pieceLabel(p.value, currency)).join(', ');
  return (
    <View accessible accessibilityLabel={`Notes and coins: ${label}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, justifyContent: 'center', alignItems: 'center' }}>
      {pieces.map((p, i) => p.kind === 'note' ? (
        <View key={i} style={{
          minWidth: 88, minHeight: 46, paddingHorizontal: space.s, borderRadius: radius.s - 2, alignItems: 'center', justifyContent: 'center',
          backgroundColor: c.cashNotes[currency.notes.indexOf(p.value) % c.cashNotes.length], borderWidth: hairline, borderColor: c.border,
        }}>
          <Text style={{ ...type.subhead, fontWeight: '700', color: c.onCash }}>{pieceLabel(p.value, currency)}</Text>
        </View>
      ) : (
        <View key={i} style={{
          minWidth: 46, minHeight: 46, paddingHorizontal: space.xs, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
          backgroundColor: c.cashCoin, borderWidth: 2, borderColor: c.border,
        }}>
          <Text style={{ ...type.caption, fontWeight: '700', color: c.onCash }}>{pieceLabel(p.value, currency)}</Text>
        </View>
      ))}
    </View>
  );
}
