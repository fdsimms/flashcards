import React from 'react';
import { View } from 'react-native';
import { languageName } from '../core/voices';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { hairline, MIN_TAP, radius, smooth, space, useTheme } from './theme';

/**
 * Review's Play button, in the card's bottom right corner (fixed there, so it's under the thumb
 * whatever the card's length). Its right half, shown when the card has a language, opens that
 * language's voice and speed (Settings, Voices) so a voice that sounds wrong can be changed
 * from the card that played it.
 */
export function PlayButton({ onPlay, language, onVoice }: {
  onPlay: () => void;
  /** The card's language code (its key in the voice settings, e.g. th); absent when the card has none. */
  language?: string;
  onVoice?: () => void;
}) {
  const c = useTheme();
  const half = { minHeight: MIN_TAP, minWidth: MIN_TAP + space.s, alignItems: 'center', justifyContent: 'center' } as const;
  return (
    <View style={{
      position: 'absolute', right: space.l, bottom: space.l, flexDirection: 'row', alignItems: 'stretch',
      borderRadius: radius.pill, backgroundColor: c.fill, overflow: 'hidden', ...smooth,
    }}>
      <Tappable onPress={() => { haptic.tap(); onPlay(); }} accessibilityRole="button" accessibilityLabel="Play the word" scaleTo={0.94} style={half}>
        <Icon name="play.fill" size={18} color={c.accent} />
      </Tappable>
      {language && onVoice ? (
        <>
          <View style={{ width: hairline, backgroundColor: c.border }} />
          <Tappable onPress={() => { haptic.tap(); onVoice(); }} accessibilityRole="button" accessibilityLabel={`${languageName(language)} voice and speed`} scaleTo={0.94} style={half}>
            <Icon name="slider.horizontal.3" size={18} color={c.accent} />
          </Tappable>
        </>
      ) : null}
    </View>
  );
}
