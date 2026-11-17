import { useRouter } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import React from 'react';
import { Text, View } from 'react-native';
import { haptic } from '../haptics';
import { Icon, Tappable } from '../kit';
import { MIN_TAP, space, type, useTheme } from '../theme';
import { useReaderPlayerHost } from '../useReaderPlayer';

/**
 * What the tab bar's bottom accessory holds while Play all carries on after the reader was closed:
 * the text's title, which line it's on, and pause, skip and stop. A tap on the title opens the text
 * in the reader again, which stops this one (the reader takes the player back). Drawn on the
 * system's glass, so it has no background of its own; the compact form (`inline`, once the tab bar
 * shrinks as a list scrolls) drops the line count but keeps Stop, so the player can be closed from
 * a list without scrolling back up.
 */
export function ReaderMiniPlayer() {
  const c = useTheme();
  const router = useRouter();
  const host = useReaderPlayerHost();
  const placement = NativeTabs.BottomAccessory.usePlacement();
  const mini = host.mini;
  if (!mini) return null;
  const compact = placement === 'inline';
  const open = () => router.push({ pathname: '/reader', params: { source: JSON.stringify({ kind: 'shelf', textId: mini.textId, order: [mini.textId] }) } });
  const button = (icon: 'pause.fill' | 'play.fill' | 'forward.fill' | 'xmark', label: string, onPress: () => void) => (
    <Tappable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={label}
      scaleTo={0.9}
      style={{ width: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name={icon} size={18} color={c.text} weight="semibold" />
    </Tappable>
  );
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: space.l, paddingRight: space.xs, gap: space.s }}>
      <Tappable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`${mini.title}, line ${mini.line.n} of ${mini.line.of}`}
        accessibilityHint="Opens the text"
        scaleTo={0.98}
        style={{ flex: 1, minHeight: MIN_TAP, justifyContent: 'center' }}
      >
        <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: '600', color: c.text }}>{mini.title}</Text>
        {compact ? null : <Text numberOfLines={1} style={{ ...type.caption, color: c.textSecondary }}>Line {mini.line.n} of {mini.line.of}</Text>}
      </Tappable>
      {button(mini.playing ? 'pause.fill' : 'play.fill', mini.playing ? 'Pause' : 'Play', host.toggle)}
      {button('forward.fill', 'Next line', () => host.skip(1))}
      {button('xmark', 'Stop', host.stop)}
    </View>
  );
}
