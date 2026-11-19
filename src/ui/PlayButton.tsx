import React from 'react';
import { View } from 'react-native';
import { languageKey, languageName } from '../core/voices';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { hairline, lift, MIN_TAP, radius, smooth, space, useTheme } from './theme';
import { useSoundingButton } from './useSoundingButton';
import { useVoiceLink } from './useVoiceLink';

/**
 * A play button for text read in the phone's voice: a play icon, and beside it, when the language
 * is known, a gear icon that opens that language's voice and speed (Settings, Voices), so a
 * voice that sounds wrong can be changed from the screen that played it. While its sound plays the
 * play icon is a pause icon, and tapping it stops the sound. `speech` is the language
 * the text is read in (th-TH); without one it's the play icon alone.
 */
export function PlayPill({ label, onPlay, speech, raised }: { label: string; onPlay: () => void; speech?: string; raised?: boolean }) {
  const c = useTheme();
  const openVoice = useVoiceLink();
  const { playing, tap } = useSoundingButton();
  const half = { minHeight: MIN_TAP, minWidth: MIN_TAP + space.s, alignItems: 'center', justifyContent: 'center' } as const;
  // Raised: floating over a card, whose own fill is the pill's usual fill, so it's the accent color with a shadow to stand off it.
  const icon = raised ? c.onAccent : c.accent;
  const pill = (
    <View style={{ flexDirection: 'row', alignItems: 'stretch', borderRadius: radius.pill, backgroundColor: raised ? c.accent : c.fill, overflow: 'hidden', ...smooth }}>
      <Tappable onPress={() => tap(onPlay)} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : label} scaleTo={0.94} style={half}>
        <Icon name={playing ? 'pause.fill' : 'play.fill'} size={18} color={icon} />
      </Tappable>
      {speech ? (
        <>
          <View style={raised ? { width: hairline, backgroundColor: c.onAccent, opacity: 0.35 } : { width: hairline, backgroundColor: c.border }} />
          <Tappable
            onPress={() => { haptic.tap(); openVoice(speech); }}
            accessibilityRole="button"
            accessibilityLabel={`${languageName(languageKey(speech))} voice and speed`}
            scaleTo={0.94}
            style={half}
          >
            <Icon name="gearshape" size={18} color={icon} />
          </Tappable>
        </>
      ) : null}
    </View>
  );
  // The shadow goes on a wrapper: the pill clips its contents, which would clip its own shadow.
  return raised ? <View style={{ borderRadius: radius.pill, ...lift(c, 'high') }}>{pill}</View> : pill;
}

/** Room the card's scrolling content leaves under its last line, so the floating Play button never covers it. */
export const PLAY_BUTTON_CLEARANCE = MIN_TAP + space.l + space.m;

/** Review's Play button, fixed in the card's bottom right corner so it's under the thumb whatever the card's length. */
export function PlayButton({ onPlay, speech }: { onPlay: () => void; speech?: string }) {
  return (
    <View style={{ position: 'absolute', right: space.l, bottom: space.l }}>
      <PlayPill label="Play the word" onPlay={onPlay} speech={speech} raised />
    </View>
  );
}
