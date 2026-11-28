import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { TONE_NAMES, TONES, type Tone } from '../../tools/thai/script';
import { answerLook, Icon, Tappable } from '../kit';
import { space, type, useTheme } from '../theme';

/**
 * Thai's five tones as the pitch line each one draws, left to right on a 40 by 30 field (high at the
 * top): mid is level, low slopes down a little, falling rises and drops, high lifts a little, rising dips and
 * climbs. A picture, so the choices differ in shape rather than being five words in a row.
 */
const PATHS: Record<Tone, string> = {
  mid: 'M4 15 L36 15',
  low: 'M4 19 C14 19 24 22 36 26',
  falling: 'M4 10 C10 3 16 3 22 10 S32 20 36 24',
  high: 'M4 9 C14 7 24 6 36 4',
  rising: 'M4 17 C10 24 14 26 18 22 S28 10 36 4',
};

/** One tone's pitch line, drawn in the accent. `width` is its width; the height follows (3 to 4). */
export function ToneContour({ tone, width = 46, color }: { tone: Tone; width?: number; color?: string }) {
  const c = useTheme();
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={(width * 30) / 40} viewBox="0 0 40 30">
        <Path d={PATHS[tone]} stroke={color ?? c.accent} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      </Svg>
    </View>
  );
}

/** The five tones to choose from, each a pitch line over its name; the right one and a wrong pick are marked once chosen. `picked.tone` is null when the answer was shown without picking. */
export function ToneContours({ tone, picked, onChoose }: { tone: Tone; picked: { tone: Tone | null } | null; onChoose: (t: Tone) => void }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space.xs + 2 }}>
      {TONES.map((t) => {
        const isRight = !!picked && t === tone;
        const isWrong = picked?.tone === t && t !== tone;
        return (
          <Tappable
            key={t}
            onPress={() => onChoose(t)}
            disabled={!!picked}
            accessibilityRole="button"
            accessibilityLabel={`${TONE_NAMES[t]}${isRight ? ', right' : isWrong ? ', wrong' : ''}`}
            accessibilityState={{ selected: picked?.tone === t, disabled: !!picked }}
            scaleTo={0.96}
            style={{
              flex: 1, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: space.s,
              ...answerLook(c, isRight ? 'right' : isWrong ? 'wrong' : 'open'),
              opacity: picked && !isRight && !isWrong ? 0.55 : 1,
            }}
          >
            <ToneContour tone={t} width={36} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Text maxFontSizeMultiplier={1.3} style={{ ...type.caption, color: isRight ? c.text : c.textSecondary, fontWeight: isRight ? '600' : '400' }}>{TONE_NAMES[t]}</Text>
              {isRight ? <Icon name="checkmark.circle.fill" size={11} color={c.countDue} /> : null}
              {isWrong ? <Icon name="xmark.circle.fill" size={11} color={c.danger} /> : null}
            </View>
          </Tappable>
        );
      })}
    </View>
  );
}
