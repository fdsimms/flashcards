import React, { useState } from 'react';
import { View } from 'react-native';
import { READABLE_WIDTH, twoColumnsFit } from '../core/wide';
import { space } from './theme';

/**
 * Today's content, in one column or two. One column is the order Today has always had: what
 * leads (the day's count, what needs doing), crams, the decks, then the extras. On a screen with
 * room for two (`twoColumnsFit`, by the width Today has, which the iPad's sidebar takes some of),
 * the cards to study keep the left column (what leads, then the decks) and the rest of the day
 * (crams, the extras) takes the right. With no crams and no extras the right column has nothing
 * in it, which is seen by measuring it, and Today is one centered column again.
 */
export function TodayColumns({ lead, crams, decks, extras }: { lead: React.ReactNode; crams: React.ReactNode; decks: React.ReactNode; extras: React.ReactNode }) {
  const [width, setWidth] = useState(0);
  // The right column's height once laid out: taken as holding something until it's measured empty.
  const [sideHeight, setSideHeight] = useState<number | null>(null);
  const two = twoColumnsFit(width);
  const column = { gap: space.m } as const;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ width: '100%' }}>
      {two ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: space.l, paddingHorizontal: space.l, paddingBottom: space.xl }}>
          <View style={{ ...column, flex: 1, maxWidth: READABLE_WIDTH }}>{lead}{decks}</View>
          <View style={sideHeight === 0 ? { width: 0, overflow: 'hidden' } : { flex: 1, maxWidth: READABLE_WIDTH }}>
            <View onLayout={(e) => setSideHeight(e.nativeEvent.layout.height)} style={column}>{crams}{extras}</View>
          </View>
        </View>
      ) : (
        <View style={{ ...column, width: '100%', maxWidth: READABLE_WIDTH, alignSelf: 'center', paddingHorizontal: space.l, paddingBottom: space.xl }}>
          {lead}{crams}{decks}{extras}
        </View>
      )}
    </View>
  );
}
