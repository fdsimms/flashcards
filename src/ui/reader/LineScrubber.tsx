import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import { lineAtX } from '../../reader/playback';
import { haptic } from '../haptics';
import { radius, space, useTheme } from '../theme';

/** The touch area; the line itself is thinner and sits in the middle. */
const TOUCH_HEIGHT = 28;

/**
 * Where the player is in a text, by line, and a way to move it. The fill shows the lines played so
 * far (the current one included) and a thumb marks the current line while a finger is on it.
 * Dragging shows the line under the finger and ticks as it crosses to the next; the player jumps
 * when the finger lifts, so a drag doesn't start and cut off a line for every one it passes.
 * `onDrag` gives the line under the finger (null once it lifts) for the label above to show.
 */
export function LineScrubber({ current, total, onDrag, onSeek }: {
  /** The line sounding or paused on, 0-based; null before anything has played. */
  current: number | null;
  total: number;
  onDrag: (line: number | null) => void;
  /** Called once, with the line the finger lifted on. */
  onSeek: (line: number) => void;
}) {
  const c = useTheme();
  const [dragAt, setDragAt] = useState<number | null>(null);
  const width = useRef(0);
  // The pan handlers outlive a render, so what they need is read from here.
  const latest = useRef({ total, onDrag, onSeek, dragAt });
  latest.current = { total, onDrag, onSeek, dragAt };

  const pan = useMemo(() => {
    const move = (x: number) => {
      const line = lineAtX(x, width.current, latest.current.total);
      if (line !== latest.current.dragAt) {
        if (latest.current.dragAt !== null) haptic.select();
        latest.current.dragAt = line;
        setDragAt(line);
        latest.current.onDrag(line);
      }
    };
    const end = (x: number | null) => {
      const { total: n, onDrag: report, onSeek: seek } = latest.current;
      setDragAt(null);
      latest.current.dragAt = null;
      report(null);
      if (x !== null) seek(lineAtX(x, width.current, n));
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Once a finger is on the line it keeps the drag, so a scroll behind it can't take it.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => { haptic.tap(); move(e.nativeEvent.locationX); },
      onPanResponderMove: (e) => move(e.nativeEvent.locationX),
      onPanResponderRelease: (e) => end(e.nativeEvent.locationX),
      onPanResponderTerminate: () => end(null),
    });
  }, []);

  const shown = dragAt ?? current;
  const progress = total > 0 ? (shown === null ? 0 : shown + 1) / total : 0;
  const dragging = dragAt !== null;
  const line = dragging ? 6 : 4;
  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => { width.current = e.nativeEvent.layout.width; }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Position in the text"
      accessibilityValue={{ text: shown === null ? `Not started, ${total} lines` : `Line ${shown + 1} of ${total}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const to = (shown ?? -1) + (e.nativeEvent.actionName === 'increment' ? 1 : -1);
        if (to >= 0 && to < total) onSeek(to);
      }}
      style={{ height: TOUCH_HEIGHT, justifyContent: 'center', marginHorizontal: space.s }}
    >
      <View pointerEvents="none" style={{ height: line, borderRadius: radius.pill, backgroundColor: c.fill }}>
        <View style={{ width: `${progress * 100}%`, height: '100%', borderRadius: radius.pill, backgroundColor: c.accent }} />
        {dragging ? (
          <View style={{ position: 'absolute', left: `${progress * 100}%`, top: -3, marginLeft: -6, width: 12, height: 12, borderRadius: radius.pill, backgroundColor: c.accent }} />
        ) : null}
      </View>
    </View>
  );
}
