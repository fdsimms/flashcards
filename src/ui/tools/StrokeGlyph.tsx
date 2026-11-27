import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import { STROKE_BOX, STROKE_GAP_MS, STROKE_MS, strokeLength, strokesAt, type StrokeOrder } from '../../tools/strokeOrder';
import { useReduceMotion } from '../motion';
import { useTheme } from '../theme';

/** A stroke's width in KanjiVG's own units, a little heavier than it draws them so they read at a tile's size. */
const STROKE_WIDTH = 3.4;
/** A dash longer than any stroke in the box, for one whose length can't be measured. */
const LONGEST = 400;

/**
 * A kana or kanji drawn from its strokes (src/tools/strokeOrder.ts) in a box of `width` by
 * `height`: each stroke with its number where KanjiVG puts it and a dot at the end it starts from.
 * `faint` is Trace it's guide. `playing` counts the plays asked for: each new one draws the
 * strokes one at a time, in order and in the direction they're written, then leaves them all
 * showing; with Reduce Motion on they stay as they are, numbered.
 */
export function StrokeGlyph({ order, width, height, faint = false, playing = 0 }: { order: StrokeOrder; width: number; height: number; faint?: boolean; playing?: number }) {
  const c = useTheme();
  const reduce = useReduceMotion();
  const lengths = useMemo(() => order.strokes.map((d) => strokeLength(d) ?? LONGEST), [order]);
  // Null when nothing is playing: every stroke shows.
  const [at, setAt] = useState<{ done: number; drawing: number } | null>(null);
  useEffect(() => {
    if (!playing || reduce) { setAt(null); return undefined; }
    const began = Date.now();
    const total = order.strokes.length * (STROKE_MS + STROKE_GAP_MS);
    let frame = 0;
    const tick = () => {
      const elapsed = Date.now() - began;
      if (elapsed >= total) { setAt(null); return; }
      setAt(strokesAt(elapsed, order.strokes.length));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [playing, reduce, order]);
  const size = Math.min(width, height);
  const ink = faint ? c.textTertiary : c.text;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${STROKE_BOX} ${STROKE_BOX}`}>
        {order.strokes.map((d, i) => {
          if (at && i > at.done) return null;
          const partly = at && i === at.done;
          if (partly && at.drawing === 0) return null;
          return (
            <Path
              key={i}
              d={d}
              stroke={ink}
              strokeOpacity={faint ? 0.4 : 1}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              // The stroke being drawn shows as much of itself as it has got to, from the end it starts at.
              strokeDasharray={partly ? [lengths[i], lengths[i]] : undefined}
              strokeDashoffset={partly ? lengths[i] * (1 - at.drawing) : undefined}
            />
          );
        })}
        {at ? null : order.starts.map((p, i) => <Circle key={`dot${i}`} cx={p.x} cy={p.y} r={2.4} fill={c.accent} />)}
        {at ? null : order.labels.map((p, i) => (
          <SvgText key={`n${i}`} x={p.x} y={p.y} fontSize={8} fontWeight="600" fill={c.accentInk}>{i + 1}</SvgText>
        ))}
      </Svg>
    </View>
  );
}
