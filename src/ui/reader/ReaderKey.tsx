import React from 'react';
import { Modal, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GlossLanguage } from '../../reader/api';
import { glossInfo } from '../../reader/languages';
import { HIGHLIGHT_ABOUT, MARK_INFO, type Example, type Mark } from '../../reader/marks';
import { haptic } from '../haptics';
import { SheetHeader } from '../kit';
import { WordView, type ReadTextStyle } from './ReadWord';
import { hairline, MIN_TAP, radius, space, type, useTheme, smooth } from '../theme';

/**
 * What the marks on the words mean, with a switch for each, in a sheet the reader's header button
 * opens. It lists only the marks the open text uses, each shown on a word from the text, drawn by
 * the same WordView the text is. Switching a mark off only hides it: a tap still shows the
 * word's meaning and grammar.
 */
export function ReaderKey({ examples, language, textStyle, shown, onChange, onClose }: {
  examples: Example[];
  language: GlossLanguage;
  textStyle: ReadTextStyle;
  shown: (mark: Mark) => boolean;
  onChange: (mark: Mark, on: boolean) => void;
  onClose: () => void;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} backdropColor={c.surface}>
      <ScrollView
        style={{ flex: 1, backgroundColor: c.surface }}
        contentContainerStyle={{ paddingHorizontal: space.l, paddingTop: space.l, paddingBottom: Math.max(insets.bottom, space.l), gap: space.s }}
      >
        <SheetHeader onClose={onClose}>
          <Text accessibilityRole="header" style={{ ...type.headline, color: c.text }}>Key to the marks on words</Text>
        </SheetHeader>
        <View>
          {examples.map((e, i) => {
            const title = e.mark === 'highlight' ? glossInfo(language).highlightLabel : MARK_INFO[e.mark].title;
            const about = e.mark === 'highlight' ? HIGHLIGHT_ABOUT : MARK_INFO[e.mark].about;
            const on = shown(e.mark);
            return (
              <View
                key={e.mark}
                accessible
                accessibilityRole="switch"
                accessibilityLabel={`${title}. ${about}`}
                accessibilityState={{ checked: on }}
                accessibilityActions={[{ name: 'activate' }]}
                onAccessibilityAction={() => { haptic.select(); onChange(e.mark, !on); }}
                style={{ gap: space.m, paddingTop: i === 0 ? space.s : space.l, paddingBottom: space.l }}
              >
                {i > 0 ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: hairline, backgroundColor: c.border }} /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.m }}>
                  {/* The sample is a picture of the mark, on a tile so every row's sample sits the same way: not tappable, and not read aloud beside the row's own label. */}
                  <View
                    pointerEvents="none"
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={{ flexShrink: 1, backgroundColor: c.fill, borderRadius: radius.m, ...smooth, paddingHorizontal: space.m, paddingVertical: space.xs + 2 }}
                  >
                    <WordView
                      word={{ ...e.word, stretch: e.mark === 'stretch' }}
                      grammar={e.mark === 'practice' || e.mark === 'avoid' || e.mark === 'known' ? e.grammar : null}
                      textStyle={textStyle}
                      flagged={e.mark === 'marked'}
                      highlighted={e.mark === 'highlight'}
                      named={e.mark === 'name'}
                      selected={false}
                      onPress={() => {}}
                    />
                  </View>
                  <Switch
                    value={on}
                    onValueChange={(v) => { haptic.select(); onChange(e.mark, v); }}
                    trackColor={{ true: c.accent, false: c.border }}
                    ios_backgroundColor={c.border}
                    style={{ transform: [{ scale: 0.85 }], transformOrigin: 'right center' }}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  />
                </View>
                {/* Starts where the sample's own text starts inside its tile. */}
                <View style={{ gap: 6, paddingLeft: space.m }}>
                  <Text style={{ ...type.subhead, fontWeight: '600', color: c.text, opacity: on ? 1 : 0.55 }}>{title}</Text>
                  <Text style={{ ...type.footnote, color: c.textSecondary, opacity: on ? 1 : 0.55 }}>{about}</Text>
                </View>
              </View>
            );
          })}
          <View>
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: hairline, backgroundColor: c.border }} />
            <Text style={{ ...type.footnote, color: c.textSecondary, paddingTop: space.l }}>
              Switching a mark off only hides it. Tapping a word still shows its meaning and grammar.
            </Text>
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
}
