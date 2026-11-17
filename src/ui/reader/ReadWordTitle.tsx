import { Text, View } from 'react-native';
import { ipaNote } from '../../reader/languages';
import type { Pronunciation } from '../../reader/mining';
import { prefs } from '../../reader/storage';
import { thaiToneMarks } from '../../reader/thaiTones';
import { radius, space, type, useTheme } from '../theme';

/**
 * A word with its IPA beside it (the gloss popover's title, the marked words list's rows), wrapping the
 * IPA under the word when the two don't fit one line. IPA written by AI carries an "AI" label here
 * and its status note elsewhere (`ipaNote`), since nothing checks it.
 */
export function ReadWordTitle({ text, pronunciation, titleStyle }: {
  text: string;
  pronunciation: Pronunciation;
  titleStyle?: Parameters<typeof Text>[0]['style'];
}) {
  const c = useTheme();
  const ipa = pronunciation.ipa && prefs().thaiToneMarks ? thaiToneMarks(pronunciation.ipa) : pronunciation.ipa;
  const ai = !!pronunciation.ipa && pronunciation.ipa_source === 'ai';
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.s }}>
      <Text style={[{ ...type.title, color: c.text }, titleStyle]}>{text}</Text>
      {ipa ? (
        <Text style={{ ...type.body, color: c.textSecondary }} selectable accessibilityHint={ipaNote(pronunciation) ?? undefined}>{ipa}</Text>
      ) : null}
      {ai ? (
        <View style={{ backgroundColor: c.warningFill, borderRadius: radius.pill, paddingHorizontal: space.s, paddingVertical: 2 }} accessible accessibilityLabel="Written by AI">
          <Text style={{ ...type.caption, fontWeight: '600', color: c.warning }}>AI</Text>
        </View>
      ) : null}
    </View>
  );
}
