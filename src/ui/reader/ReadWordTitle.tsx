import { useState } from 'react';
import { Text, View } from 'react-native';
import { ipaNote } from '../../reader/languages';
import type { Pronunciation } from '../../reader/mining';
import { prefs } from '../../reader/storage';
import { thaiToneMarks } from '../../reader/thaiTones';
import { TipBubble, useTip } from './ReadWordTips';
import { space, type, useTheme } from '../theme';

/**
 * A word with its IPA beside it (the gloss popover's title, the marked words list's rows), wrapping the
 * IPA under the word when the two don't fit one line. IPA written by AI is drawn in the warning color
 * (it isn't checked), and where `ipaTip` is passed the IPA opens a tooltip with where it's from.
 */
export function ReadWordTitle({ text, pronunciation, titleStyle, ipaTip }: {
  text: string;
  pronunciation: Pronunciation;
  titleStyle?: Parameters<typeof Text>[0]['style'];
  /** Whether the tooltip opens below the title (no room above it). Without it the IPA isn't tappable. */
  ipaTip?: { below: boolean };
}) {
  const c = useTheme();
  const tip = useTip();
  const [ipaX, setIpaX] = useState(0);
  const ipa = pronunciation.ipa && prefs().thaiToneMarks ? thaiToneMarks(pronunciation.ipa) : pronunciation.ipa;
  const note = ipaNote(pronunciation);
  const ai = !!pronunciation.ipa && pronunciation.ipa_source === 'ai';
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.s }}>
      <Text style={[{ ...type.title, color: c.text }, titleStyle]}>{text}</Text>
      {ipa ? (
        <Text
          onLayout={(e) => setIpaX(e.nativeEvent.layout.x)}
          onPress={ipaTip ? tip.toggle : undefined}
          selectable={!ipaTip}
          accessibilityRole={ipaTip ? 'button' : undefined}
          accessibilityHint={note ?? undefined}
          style={{
            ...type.body, color: ai ? c.warningInk : c.textSecondary,
            ...(ipaTip ? { textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: c.border } : null),
          }}
        >
          {ipa}
        </Text>
      ) : null}
      {ipaTip && note && tip.open ? <TipBubble text={note} x={ipaX} below={ipaTip.below} warn={ai} /> : null}
    </View>
  );
}
