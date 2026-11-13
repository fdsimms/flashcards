import React, { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import type { Language } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { HIGHLIGHT_ABOUT, MARK_INFO, type Example, type Mark } from '../reader/marks';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { WordView, type ReadTextStyle } from './ReadWord';
import { MIN_TAP, space, type, useTheme } from './theme';

/**
 * What the marks on the words mean, with a switch for each. It lists only the marks the open text
 * uses, each shown on a word from the text, drawn by the same WordView the text is. Closed it's one
 * line, in the card under the title. Switching a mark off only hides it: a tap still shows the
 * word's meaning and grammar.
 */
export function ReaderKey({ examples, language, textStyle, shown, onChange }: {
  examples: Example[];
  language: Language;
  textStyle: ReadTextStyle;
  shown: (mark: Mark) => boolean;
  onChange: (mark: Mark, on: boolean) => void;
}) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  if (examples.length === 0) return null;
  return (
    <View>
      <Tappable
        onPress={() => { haptic.tap(); setOpen(!open); }}
        accessibilityRole="button"
        accessibilityLabel="Key to the marks on words"
        accessibilityState={{ expanded: open }}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TAP }}
      >
        <Text style={{ ...type.footnote, fontWeight: '600', color: c.textSecondary }}>Key</Text>
        <Icon name={open ? 'chevron.up' : 'chevron.down'} size={12} color={c.textSecondary} weight="semibold" />
      </Tappable>
      {open ? (
        <View>
          {examples.map((e, i) => {
            const title = e.mark === 'highlight' ? LANGUAGES[language].highlightLabel : MARK_INFO[e.mark].title;
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
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s, minHeight: MIN_TAP + space.m }}
              >
                {i > 0 ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: c.border }} /> : null}
                {/* The sample is a picture of the mark: not tappable, and not read aloud beside the row's own label. */}
                <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 112, alignItems: 'center' }}>
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
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ ...type.subhead, fontWeight: '600', color: c.text, opacity: on ? 1 : 0.55 }}>{title}</Text>
                  <Text style={{ ...type.footnote, color: c.textSecondary, opacity: on ? 1 : 0.55 }}>{about}</Text>
                </View>
                <Switch
                  value={on}
                  onValueChange={(v) => { haptic.select(); onChange(e.mark, v); }}
                  trackColor={{ true: c.accent, false: c.border }}
                  ios_backgroundColor={c.border}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                />
              </View>
            );
          })}
          <Text style={{ ...type.footnote, color: c.textSecondary, paddingTop: space.s }}>
            Switching a mark off only hides it. Tapping a word still shows its meaning and grammar.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
