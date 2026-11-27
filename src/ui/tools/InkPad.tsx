import React, { useRef, useState } from 'react';
import { Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { japaneseFont, thaiDescentRoom } from '../../core/script';
import type { Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { extendStroke, inkViewBox, strokePath, type Stroke } from '../../tools/ink';
import type { StrokeOrder } from '../../tools/strokeOrder';
import { StrokeGlyph } from './StrokeGlyph';
import { useLanguageFont } from '../AppFont';
import { radius, smooth, useTheme } from '../theme';

/** The ink's width in the writing box, in points. */
const INK_WIDTH = 6;

/**
 * A letter, word or kanji drawn to fill a box of `width` by `height`: the faint guide under Trace
 * it, and the real one beside the learner's writing. One line, shrunk to fit a long word.
 */
export function Glyph({ text, language, width, height, color, opacity, face }: { text: string; language: Language; width: number; height: number; color: string; opacity?: number; /** A face to draw it in other than the language's own: joined handwriting. */ face?: string }) {
  const font = useLanguageFont(language);
  const fontSize = Math.round(height * (language === 'th' ? 0.5 : 0.62));
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height, alignItems: 'center', justifyContent: 'center', opacity }}>
      <Text
        accessibilityLanguage={LANGUAGES[language].speech}
        allowFontScaling={false}
        adjustsFontSizeToFit
        minimumFontScale={0.2}
        numberOfLines={1}
        style={{ width: width * 0.88, textAlign: 'center', fontSize, lineHeight: Math.round(fontSize * (language === 'th' ? 1.5 : 1.25)), ...(language === 'th' ? { paddingBottom: thaiDescentRoom(fontSize) } : null), ...japaneseFont(text, language === 'ja' ? 'ja' : undefined, font), ...(face ? { fontFamily: face } : null), color }}
      >
        {text}
      </Text>
    </View>
  );
}

/**
 * Writing by hand's box: a finger draws strokes in it (src/tools/ink.ts). `guide` is the answer
 * shown faintly underneath, to trace. The box takes the touch as soon as it lands and keeps it,
 * so a stroke is never read as a scroll or a swipe; nothing inside it takes touches of its own,
 * which keeps each touch's position measured from the box's corner.
 */
export function InkPad({ strokes, onChange, width, height, guide, guideStrokes, face, language }: {
  strokes: Stroke[];
  onChange: (strokes: Stroke[]) => void;
  width: number;
  height: number;
  /** The answer, drawn faintly to trace over. */
  guide?: string;
  /** The guide's own strokes, numbered in the order they're written, drawn in place of the font's (Japanese, strokeOrder.ts). */
  guideStrokes?: StrokeOrder | null;
  /** The face the guide is drawn in, as `Glyph`'s. */
  face?: string;
  language: Language;
}) {
  const c = useTheme();
  // The stroke being drawn: in a ref so each move builds on the last, and in state so it shows.
  const drawing = useRef<Stroke | null>(null);
  const [current, setCurrent] = useState<Stroke | null>(null);
  const at = (e: GestureResponderEvent) => ({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY });
  const end = () => {
    const stroke = drawing.current;
    drawing.current = null;
    setCurrent(null);
    if (stroke?.length) onChange([...strokes, stroke]);
  };
  return (
    <View
      accessible
      accessibilityLabel="Writing box"
      accessibilityHint="Draw with a finger. This needs VoiceOver turned off."
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => { drawing.current = [at(e)]; setCurrent(drawing.current); }}
      onResponderMove={(e) => {
        if (!drawing.current) return;
        const next = extendStroke(drawing.current, at(e));
        if (next !== drawing.current) { drawing.current = next; setCurrent(next); }
      }}
      onResponderRelease={end}
      onResponderTerminate={end}
      style={{ width, height, borderRadius: radius.l, ...smooth, overflow: 'hidden', backgroundColor: c.fill }}
    >
      <Svg pointerEvents="none" width={width} height={height} style={{ position: 'absolute' }}>
        <Line x1={width / 2} y1={0} x2={width / 2} y2={height} stroke={c.border} strokeWidth={1} strokeDasharray="4 5" />
        <Line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={c.border} strokeWidth={1} strokeDasharray="4 5" />
      </Svg>
      {guide && guideStrokes ? <StrokeGlyph order={guideStrokes} width={width} height={height} faint /> : guide ? <Glyph text={guide} language={language} width={width} height={height} color={c.textTertiary} opacity={0.35} face={face} /> : null}
      <Svg pointerEvents="none" width={width} height={height} style={{ position: 'absolute' }}>
        <Ink strokes={strokes} color={c.text} width={INK_WIDTH} />
        {current ? <Path d={strokePath(current)} stroke={c.text} strokeWidth={INK_WIDTH} strokeLinecap="round" strokeLinejoin="round" fill="none" /> : null}
      </Svg>
    </View>
  );
}

/** Finished strokes: memoized, so a move of the finger redraws only the stroke under it. */
const Ink = React.memo(function Ink({ strokes, color, width }: { strokes: Stroke[]; color: string; width: number }) {
  return <>{strokes.map((s, i) => <Path key={i} d={strokePath(s)} stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}</>;
});

/** The learner's writing drawn again in a smaller frame, fitted to it whatever size it was written (`inkViewBox`). */
export function InkCopy({ strokes, pad, aspect }: { strokes: Stroke[]; pad: { width: number; height: number }; aspect: number }) {
  const c = useTheme();
  const box = inkViewBox(strokes, pad, aspect);
  return (
    <Svg width="100%" height="100%" viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}>
      {/* As heavy in the copy as in the box it was written in, however much of it the copy shows. */}
      <Ink strokes={strokes} color={c.text} width={(INK_WIDTH * box.width) / Math.max(pad.width * 0.55, 1)} />
    </Svg>
  );
}
