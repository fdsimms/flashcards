import React from 'react';
import { View } from 'react-native';
import { languageKey, languageName } from '../core/voices';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { hairline, MIN_TAP, radius, smooth, space, useTheme } from './theme';
import { useVoiceLink } from './useVoiceLink';

/**
 * A play button for text read in the phone's voice: a play icon, and beside it, when the language
 * is known, a sliders icon that opens that language's voice and speed (Settings, Voices), so a
 * voice that sounds wrong can be changed from the screen that played it. `speech` is the language
 * the text is read in (th-TH); without one it's the play icon alone.
 */
export function PlayPill({ label, onPlay, speech }: { label: string; onPlay: () => void; speech?: string }) {
  const c = useTheme();
  const openVoice = useVoiceLink();
  const half = { minHeight: MIN_TAP, minWidth: MIN_TAP + space.s, alignItems: 'center', justifyContent: 'center' } as const;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'stretch', borderRadius: radius.pill, backgroundColor: c.fill, overflow: 'hidden', ...smooth }}>
      <Tappable onPress={() => { haptic.tap(); onPlay(); }} accessibilityRole="button" accessibilityLabel={label} scaleTo={0.94} style={half}>
        <Icon name="play.fill" size={18} color={c.accent} />
      </Tappable>
      {speech ? (
        <>
          <View style={{ width: hairline, backgroundColor: c.border }} />
          <Tappable
            onPress={() => { haptic.tap(); openVoice(speech); }}
            accessibilityRole="button"
            accessibilityLabel={`${languageName(languageKey(speech))} voice and speed`}
            scaleTo={0.94}
            style={half}
          >
            <Icon name="slider.horizontal.3" size={18} color={c.accent} />
          </Tappable>
        </>
      ) : null}
    </View>
  );
}

/** Review's Play button, fixed in the card's bottom right corner so it's under the thumb whatever the card's length. */
export function PlayButton({ onPlay, speech }: { onPlay: () => void; speech?: string }) {
  return (
    <View style={{ position: 'absolute', right: space.l, bottom: space.l }}>
      <PlayPill label="Play the word" onPlay={onPlay} speech={speech} />
    </View>
  );
}
