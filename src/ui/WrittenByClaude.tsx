import React from 'react';
import { Text, View } from 'react-native';
import { radius, smooth, space, type, useTheme } from './theme';

/**
 * The note on a grammar page Claude wrote (a topic of yours, a point written when the catalog ran
 * out): code checks its examples, but not that its explanation is right. `on` is the date it was
 * written, where there is one; `children` go under it (a topic's last failed write).
 */
export function WrittenByClaude({ on, children }: { on?: string; children?: React.ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ backgroundColor: c.accentFill, borderRadius: radius.l, ...smooth, padding: space.l, gap: space.xs }}>
      <Text style={{ ...type.subhead, color: c.text }}>
        {`Written by Claude${on ? ` on ${on}` : ''}, and not checked against a grammar book. Trust what you hear and read over it.`}
      </Text>
      {children}
    </View>
  );
}
