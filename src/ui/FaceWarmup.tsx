import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { WARMED_WEIGHTS, warmupKey } from '../core/faceWarmup';
import type { AppFont } from '../core/fonts';
import { CardFontScope } from './AppFont';
import { type } from './theme';

// What this session has laid out already, by `warmupKey`. A face stays loaded, so each is paid for once.
const warmed = new Set<string>();

/** How long the text stays mounted: long enough to be laid out, short enough not to be re-laid-out per card. */
const WARM_MS = 400;

/**
 * Lays out a card's back in every weight a side draws in, out of sight, while its front is showing
 * (src/core/faceWarmup.ts says why). It takes no space, no taps and no VoiceOver focus, and draws
 * nothing once its font and scripts have been warmed in this session.
 *
 * The same `Text` the card uses, in the card's own `CardFontScope`, so it asks for exactly the faces
 * the back will. Laid out is enough: iOS loads a face and its script's fallback glyphs to measure
 * text, so the opacity of 0 doesn't skip the work this is for.
 */
export function FaceWarmup({ font, text }: { font: AppFont; text: string }) {
  const key = warmupKey(font, text);
  const [doneKey, setDoneKey] = useState<string>();
  const done = warmed.has(key) || doneKey === key;
  useEffect(() => {
    if (done || !text) return undefined;
    const id = setTimeout(() => { warmed.add(key); setDoneKey(key); }, WARM_MS);
    return () => clearTimeout(id);
  }, [key, done, text]);
  if (done || !text) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 }}
    >
      <CardFontScope font={font}>
        {WARMED_WEIGHTS.map((weight) => (
          <Text key={weight} numberOfLines={1} style={{ fontSize: type.cardFront.fontSize, fontWeight: weight }}>{text}</Text>
        ))}
      </CardFontScope>
    </View>
  );
}
