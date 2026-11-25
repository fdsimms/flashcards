import React, { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MissMnemonic } from '../core/missMnemonic';
import { Button } from './kit';
import { Reveal } from './motion';
import { radius, smooth, space, type, useTheme } from './theme';

/**
 * After a card is answered Again and its note has a Mnemonic, this covers the screen with the
 * word, its meaning and the mnemonic until Continue is tapped, so the mnemonic is seen at the
 * moment of the miss. Review has already moved on to the next card underneath; this only reminds,
 * and never touches the rating or the schedule (`src/core/missMnemonic.ts`).
 */

/** The reminder's state. `show(null)` takes it away. */
export function useMissMnemonic() {
  const [shown, show] = useState<MissMnemonic | null>(null);
  const hide = useCallback(() => show(null), []);
  return { shown, show, hide };
}

export function MissMnemonicCover({ shown, onContinue }: { shown: MissMnemonic; onContinue: () => void }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View accessibilityViewIsModal style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.xl, gap: space.l, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
        <Reveal rise={10} style={{ gap: space.l, alignItems: 'center' }}>
          <View style={{ backgroundColor: c.dangerFill, borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: space.xs }}>
            <Text style={{ ...type.overline, color: c.danger }}>Again</Text>
          </View>
          <Text style={{ ...type.cardFront, color: c.text, textAlign: 'center' }}>{shown.word}</Text>
          {shown.meaning ? <Text style={{ ...type.title, fontWeight: '400', color: c.textBody, textAlign: 'center' }}>{shown.meaning}</Text> : null}
          <View style={{ alignSelf: 'stretch', gap: space.xs }}>
            <Text style={{ ...type.overline, color: c.accent }}>Mnemonic</Text>
            <View style={{ backgroundColor: c.accentFill, borderColor: c.accent, borderWidth: 1.5, borderRadius: radius.m, ...smooth, padding: space.l }}>
              <Text style={{ ...type.body, lineHeight: 26, color: c.text }}>{shown.mnemonic}</Text>
            </View>
          </View>
        </Reveal>
      </ScrollView>
      <View style={{ padding: space.l, paddingBottom: space.l + insets.bottom }}>
        <Button label="Continue" onPress={onContinue} />
      </View>
    </View>
  );
}
