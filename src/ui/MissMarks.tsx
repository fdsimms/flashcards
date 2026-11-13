import React from 'react';
import { ActionSheetIOS, Text, View } from 'react-native';
import type { MissReason } from '../core/misses';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { hairline, radius, smooth, space, type, useTheme } from './theme';

/**
 * Review's Again button for a card that has reasons to choose from (src/core/misses.ts): a plain
 * tap is a plain Again, and the chevron, or pressing and holding the button, asks what went wrong
 * and answers Again with that reason. The reason never changes the rating.
 */
export function AgainSplit({ interval, reasons, onAnswer }: {
  /** When the card is next due after Again, as the other buttons show it. */
  interval: string | undefined;
  reasons: MissReason[];
  /** Answers Again; `miss` is the reason's key, absent for a plain Again. */
  onAnswer: (miss?: string) => void;
}) {
  const c = useTheme();
  const choose = () => {
    haptic.tap();
    const options = [...reasons.map((r) => r.label), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Again', message: 'What went wrong?', options, cancelButtonIndex: options.length - 1 },
      (i) => { if (i < reasons.length) onAnswer(reasons[i].key); },
    );
  };
  return (
    <View style={{ flex: 1, flexDirection: 'row', minHeight: 60, borderRadius: radius.m + 2, ...smooth, overflow: 'hidden', backgroundColor: c.again }}>
      <Tappable
        onPress={() => onAnswer()}
        onLongPress={choose}
        accessibilityRole="button"
        accessibilityLabel={`Again, next in ${interval ?? ''}`}
        accessibilityHint="Press and hold to say what went wrong"
        scaleTo={0.95}
        dimTo={0.85}
        style={{ flex: 1, paddingVertical: space.s, alignItems: 'center', justifyContent: 'center', gap: 2 }}
      >
        {/* The interval sits above the label, as on the other buttons. */}
        <Text style={{ ...type.caption, color: c.onRating, fontVariant: ['tabular-nums'] }}>{interval}</Text>
        <Text style={{ ...type.headline, color: c.onRating }}>Again</Text>
      </Tappable>
      <View style={{ width: hairline, marginVertical: space.s, backgroundColor: c.onRating, opacity: 0.3 }} />
      <Tappable
        onPress={choose}
        accessibilityRole="button"
        accessibilityLabel="Again, and say what went wrong"
        dimTo={0.85}
        style={{ width: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="chevron.down" size={16} color={c.onRating} weight="bold" />
      </Tappable>
    </View>
  );
}

/** The line under a card's front when an earlier answer chose a reason: "Last time: tone was wrong". */
export function MissReminder({ text }: { text: string }) {
  const c = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={text}
      style={{
        alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: space.s, ...smooth,
        borderRadius: radius.m, backgroundColor: c.highlight, paddingHorizontal: space.m, paddingVertical: space.s,
      }}
    >
      <Icon name="exclamationmark.circle.fill" size={16} color={c.warning} />
      <Text style={{ ...type.callout, color: c.warning, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}
