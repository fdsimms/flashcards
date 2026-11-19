import { Stack, useRouter } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { Animated, Image, PanResponder, ScrollView, Text, View } from 'react-native';
import { dropIndex, itemDetail, keyOf, languageOf, shiftFor, titleOf, type QueueItem } from '../../reader/audioQueue';
import { FLAG_IMAGES } from '../flagImages';
import { haptic } from '../haptics';
import { Group, Help, HeaderAction, Icon, NavRow, Screen, SectionTitle, SwipeAction, SwipeToReveal, SwitchRow, Tappable } from '../kit';
import { lift, MIN_TAP, radius, readable, smooth, space, type, useTheme } from '../theme';
import { useAudioQueue } from '../useAudioQueue';
import { useQueueMenu } from '../useQueueMenu';

/**
 * Up Next, over Now Playing: the one playing, then what comes after it in order. Drag a row by its
 * handle to move it, swipe it left to remove it, or tap it to play it now; VoiceOver's actions on a
 * row do the same. Clear empties the list, with Undo until something else changes. Under it: Keep
 * playing the shelf (go on with the shelf's next unread text once the list runs out) and Recently
 * played, to play one again. The queue itself is useAudioQueue.ts.
 */
export function UpNext() {
  const c = useTheme();
  const router = useRouter();
  const queue = useAudioQueue();
  const menu = useQueueMenu();
  const { now, next, history } = queue.queue;
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ count: number; run: () => void } | null>(null);
  const [dragging, setDragging] = useState(false);

  const clear = () => {
    const count = next.length;
    const run = queue.clear();
    haptic.tap();
    setUndo({ count, run });
  };

  return (
    <Screen
      title="Up Next"
      largeTitle={false}
      toolbar={next.length > 0 ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button accessibilityLabel={`Clear Up Next, ${next.length} ${next.length === 1 ? 'item' : 'items'}`} onPress={clear}>Clear</Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : undefined}
    >
      <ScrollView
        scrollEnabled={!dragging}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ ...readable, paddingTop: space.m, paddingBottom: space.xxl, gap: space.m }}
      >
        {now ? (
          <>
            <SectionTitle>Now Playing</SectionTitle>
            <Group>
              <NavRow first label={titleOf(now)} detail={queue.live && queue.line ? `Line ${queue.line.n} of ${queue.line.of}` : itemDetail(now)} onPress={() => router.back()} />
            </Group>
          </>
        ) : null}

        <SectionTitle>{next.length > 0 ? `Next · ${next.length}` : 'Next'}</SectionTitle>
        {undo ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.l }}>
            <Text style={{ ...type.footnote, color: c.textSecondary, flex: 1 }}>{`Cleared ${undo.count} ${undo.count === 1 ? 'item' : 'items'}.`}</Text>
            <HeaderAction label="Undo" onPress={() => { undo.run(); setUndo(null); }} />
          </View>
        ) : null}
        {next.length === 0 ? (
          <View style={{ paddingHorizontal: space.l }}>
            <Help>Nothing is queued. Touch and hold a text on the Read & Listen shelf or in Reread, or a lesson on the Lessons tab, and choose Play Next or Play Later.</Help>
          </View>
        ) : (
          <DragList
            items={next}
            openRow={openRow}
            onOpenRow={setOpenRow}
            onDragging={setDragging}
            onMove={(from, to) => { setUndo(null); queue.move(from, to); }}
            onRemove={(key) => { setUndo(null); queue.remove(key); }}
            onPlay={(item) => { setUndo(null); queue.playNow(item); router.back(); }}
          />
        )}

        <Group>
          <SwitchRow
            first
            label="Keep playing the shelf"
            hint="When Up Next runs out after a shelf text, play the next unread text in the same language."
            value={queue.queue.keepPlaying}
            onValueChange={queue.setKeepPlaying}
          />
        </Group>

        {history.length > 0 ? (
          <>
            <SectionTitle>Recently Played</SectionTitle>
            <Group>
              {history.map((item, i) => (
                <NavRow
                  key={keyOf(item)}
                  first={i === 0}
                  label={titleOf(item)}
                  detail={itemDetail(item)}
                  onPress={() => { haptic.tap(); queue.playNow(item); router.back(); }}
                  onLongPress={() => menu(item)}
                />
              ))}
            </Group>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/**
 * Up Next's rows, each moved by dragging its handle: the row lifts and follows the finger, and the
 * rows it passes slide aside to open the gap it would land in (`dropIndex`, `shiftFor`). Only the
 * lifted row's position is animated; the list re-renders when the gap moves to another row.
 */
function DragList({ items, openRow, onOpenRow, onDragging, onMove, onRemove, onPlay }: {
  items: QueueItem[];
  openRow: string | null;
  onOpenRow: (key: string | null) => void;
  onDragging: (on: boolean) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (key: string) => void;
  onPlay: (item: QueueItem) => void;
}) {
  const c = useTheme();
  const rowHeight = useRef(0);
  const dy = useRef(new Animated.Value(0)).current;
  const [held, setHeld] = useState<{ from: number; over: number } | null>(null);
  const latest = useRef({ items, held, onMove, onDragging });
  latest.current = { items, held, onMove, onDragging };

  const handles = useMemo(() => items.map((_, index) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      haptic.select();
      dy.setValue(0);
      setHeld({ from: index, over: index });
      latest.current.onDragging(true);
    },
    onPanResponderMove: (_, g) => {
      dy.setValue(g.dy);
      const over = dropIndex(index, g.dy, rowHeight.current, latest.current.items.length);
      if (latest.current.held && over !== latest.current.held.over) {
        haptic.select();
        setHeld({ from: index, over });
      }
    },
    onPanResponderRelease: (_, g) => {
      const to = dropIndex(index, g.dy, rowHeight.current, latest.current.items.length);
      setHeld(null);
      dy.setValue(0);
      latest.current.onDragging(false);
      if (to !== index) { haptic.tap(); latest.current.onMove(index, to); }
    },
    onPanResponderTerminate: () => {
      setHeld(null);
      dy.setValue(0);
      latest.current.onDragging(false);
    },
  })), [items, dy]);

  return (
    <Group accessibilityRole="list">
      {items.map((item, i) => {
        const key = keyOf(item);
        const lifted = held?.from === i;
        const shift = held ? shiftFor(i, held.from, held.over) * rowHeight.current : 0;
        return (
          <Animated.View
            key={key}
            onLayout={i === 0 ? (e) => { rowHeight.current = e.nativeEvent.layout.height; } : undefined}
            style={[
              { zIndex: lifted ? 2 : 0, transform: [{ translateY: lifted ? dy : shift }] },
              lifted ? { ...lift(c, 'high'), borderRadius: radius.m, ...smooth, backgroundColor: c.raised } : null,
            ]}
          >
            <SwipeToReveal
              open={openRow === key}
              onOpenChange={(open) => onOpenRow(open ? key : null)}
              onFullSwipe={() => onRemove(key)}
              action={<SwipeAction destructive icon="minus.circle" label="Remove" accessibilityLabel={`Remove ${titleOf(item)} from Up Next`} onPress={() => { onOpenRow(null); onRemove(key); }} />}
            >
              <Tappable
                onPress={() => (openRow === key ? onOpenRow(null) : onPlay(item))}
                accessibilityRole="button"
                accessibilityLabel={`${titleOf(item)}. ${itemDetail(item)}`}
                accessibilityHint="Plays it now"
                accessibilityActions={[
                  ...(i > 0 ? [{ name: 'up', label: 'Move up' }] : []),
                  ...(i < items.length - 1 ? [{ name: 'down', label: 'Move down' }] : []),
                  { name: 'remove', label: 'Remove from Up Next' },
                ]}
                onAccessibilityAction={(e) => {
                  const action = e.nativeEvent.actionName;
                  if (action === 'up') onMove(i, i - 1);
                  else if (action === 'down') onMove(i, i + 1);
                  else if (action === 'remove') onRemove(key);
                }}
                scaleTo={1}
                style={{ minHeight: MIN_TAP + space.m, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingLeft: space.l, paddingVertical: space.s }}
              >
                {i === 0 || lifted ? null : <View style={{ position: 'absolute', top: 0, left: space.l, right: 0, height: 0.5, backgroundColor: c.border }} />}
                <Image source={FLAG_IMAGES[languageOf(item)]} style={{ width: 28, height: 28, borderRadius: radius.pill }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text numberOfLines={1} style={{ ...type.body, color: c.text }}>{titleOf(item)}</Text>
                  <Text numberOfLines={1} style={{ ...type.footnote, color: c.textSecondary }}>{itemDetail(item)}</Text>
                </View>
                <View
                  {...handles[i].panHandlers}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={{ width: MIN_TAP + space.s, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon name="line.3.horizontal" size={18} color={c.textTertiary} />
                </View>
              </Tappable>
            </SwipeToReveal>
          </Animated.View>
        );
      })}
    </Group>
  );
}
