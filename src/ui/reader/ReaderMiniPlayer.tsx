import { useRouter } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import React from 'react';
import { Text, View } from 'react-native';
import { haptic } from '../haptics';
import { Icon, Tappable } from '../kit';
import { SKIP_SECONDS } from '../../reader/lessons';
import { MIN_TAP, space, type, useTheme } from '../theme';
import { useReaderPlayerHost } from '../useReaderPlayer';

/**
 * What the tab bar's bottom accessory holds while Play all carries on after the reader was closed:
 * the text's title, which line it's on, and pause, skip and stop. A tap on the title opens the text
 * in the reader again, which stops this one (the reader takes the player back). An audio lesson left
 * while it plays is here too, with back and forward 15 seconds in place of the line skip; a tap on
 * its title opens the lesson, which carries on from where it is. Drawn on the
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
  const open = () => (mini.kind === 'lesson'
    ? router.push({ pathname: '/read-lesson', params: { lesson: JSON.stringify(mini.lesson) } })
    : router.push({ pathname: '/reader', params: { source: JSON.stringify({ kind: 'shelf', textId: mini.textId, order: [mini.textId] }) } }));
  const button = (icon: 'pause.fill' | 'play.fill' | 'forward.fill' | 'gobackward.15' | 'goforward.15' | 'xmark', label: string, onPress: () => void) => (
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
        accessibilityLabel={mini.kind === 'lesson' ? `${mini.title}, audio lesson` : `${mini.title}, line ${mini.line.n} of ${mini.line.of}`}
        accessibilityHint={mini.kind === 'lesson' ? 'Opens the lesson' : 'Opens the text'}
        scaleTo={0.98}
        style={{ flex: 1, minHeight: MIN_TAP, justifyContent: 'center' }}
      >
        <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: '600', color: c.text }}>{mini.title}</Text>
        {compact ? null : <Text numberOfLines={1} style={{ ...type.caption, color: c.textSecondary }}>{mini.kind === 'lesson' ? 'Audio lesson' : `Line ${mini.line.n} of ${mini.line.of}`}</Text>}
      </Tappable>
      {mini.kind === 'lesson' ? button('gobackward.15', `Back ${SKIP_SECONDS} seconds`, () => host.skip(-1)) : null}
      {button(mini.playing ? 'pause.fill' : 'play.fill', mini.playing ? 'Pause' : 'Play', host.toggle)}
      {mini.kind === 'lesson'
        ? button('goforward.15', `Forward ${SKIP_SECONDS} seconds`, () => host.skip(1))
        : button('forward.fill', 'Next line', () => host.skip(1))}
      {button('xmark', 'Stop', host.stop)}
    </View>
  );
}
