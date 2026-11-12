import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import type { ReaderText } from '../reader/api';
import { drawCharacter, HEAD_ORIGIN, speakerCharacter, VIEW_BOX, type Shape, type Tone } from '../reader/characters';
import { radius, space, type, useTheme, type Colors } from './theme';

/** The A or B badge's size, and a drawn character's: the character needs more room to read. */
export const BADGE_SIZE = 26;
export const CHARACTER_SIZE = 36;

type Who = 'A' | 'B';

/** How tall a speaker's mark is on a line of the text, so the line can center it on its first row of words. */
export function speakerSize(text: Pick<ReaderText, 'characters' | 'genders'>, who: Who, small = false): number {
  if (!speakerCharacter(text, who)) return BADGE_SIZE;
  return small ? BADGE_SIZE : CHARACTER_SIZE;
}

function speakerColors(c: Colors, who: Who) {
  return who === 'A' ? { bg: c.accentFill, fg: c.accent } : { bg: c.speakerB, fg: c.onSpeakerB };
}

function tones(c: Colors, who: Who): Record<Tone, string> {
  const a = who === 'A';
  return {
    hair: a ? c.accent : c.onSpeakerB,
    body: a ? c.speakerABody : c.speakerBBody,
    face: a ? c.speakerAFace : c.speakerBFace,
    acc: c.characterWhite,
  };
}

function ShapeView({ shape, color }: { shape: Shape; color: string }) {
  const paint = shape.stroke
    ? { fill: 'none', stroke: color, strokeWidth: shape.stroke, strokeLinecap: 'round' as const }
    : { fill: color };
  if ('d' in shape) return <Path d={shape.d} {...paint} />;
  if ('circle' in shape) return <Circle cx={shape.circle[0]} cy={shape.circle[1]} r={shape.circle[2]} {...paint} />;
  if ('ellipse' in shape) return <Ellipse cx={shape.ellipse[0]} cy={shape.ellipse[1]} rx={shape.ellipse[2]} ry={shape.ellipse[3]} {...paint} />;
  const [x, y, width, height, rx] = shape.rect;
  return <Rect x={x} y={y} width={width} height={height} rx={rx} {...paint} />;
}

/**
 * A dialogue speaker's mark: the character the server chose for them, drawn in the speaker's two
 * colors, or the A or B badge for a text without one. `size`: a character's width and height.
 */
export function Speaker({ text, who, size = CHARACTER_SIZE }: { text: Pick<ReaderText, 'characters' | 'genders'>; who: Who; size?: number }) {
  const c = useTheme();
  const { bg, fg } = speakerColors(c, who);
  const look = speakerCharacter(text, who);
  if (!look) {
    return (
      <View style={{ minWidth: BADGE_SIZE, minHeight: BADGE_SIZE, borderRadius: radius.pill, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xs }}>
        <Text style={{ ...type.footnote, fontWeight: '700', color: fg }}>{who}</Text>
      </View>
    );
  }
  const drawing = drawCharacter(look.key, look.gender, look.variant);
  const color = tones(c, who);
  const { x, y } = HEAD_ORIGIN;
  const head = `translate(${x} ${y}) scale(${drawing.headScale}) translate(${-x} ${-y})`;
  // Back-to-front, with the head's parts (which scale for a child) grouped where the first one falls.
  const parts = drawing.shapes.map((shape, i) => ({ shape, i }));
  return (
    <View style={{ width: size, height: size, borderRadius: radius.pill, backgroundColor: bg, overflow: 'hidden' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${VIEW_BOX} ${VIEW_BOX}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {parts.filter((p) => !p.shape.head).map(({ shape, i }) => <ShapeView key={i} shape={shape} color={color[shape.tone]} />)}
        <G transform={head}>
          {parts.filter((p) => p.shape.head).map(({ shape, i }) => <ShapeView key={i} shape={shape} color={color[shape.tone]} />)}
        </G>
      </Svg>
    </View>
  );
}
