import React, { useMemo, useState } from 'react';
import { Text, View, type TextStyle } from 'react-native';
import { markSegments } from '../core/highlight';
import type { RenderedSide } from '../core/types';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { MIN_TAP, radius, smooth, space, type, useTheme, type Colors } from './theme';

type Block = RenderedSide['blocks'][number];
type Item = { b: Block; i: number };

const isExample = (b: Block) => b.role === 'example' || b.role === 'exampleRomanized' || b.role === 'exampleTranslation';

/** Text with `mark` picked out inside it, as a card's word is in its example sentence. */
function MarkedText({ text, mark, style, c }: { text: string; mark?: string; style: TextStyle; c: Colors }) {
  const segments = mark ? markSegments(text, mark) : [{ text, marked: false }];
  return (
    <Text style={style}>
      {segments.map((s, k) => (
        s.marked
          ? <Text key={k} style={{ color: c.accent, backgroundColor: c.accentFill, fontWeight: '600' }}>{s.text}</Text>
          : s.text
      ))}
    </Text>
  );
}

/**
 * One side of a natively rendered card: the word or question large and centered, the details
 * under it in smaller text with their labels. On the back, the tags are chips, an example
 * sentence's lines sit close together with the word highlighted, and a note is set off in a box.
 * `showHints` shows the lines Anki hides behind a tap (romanization, translation) without one.
 */
export function Side({ side, which, showHints }: { side: RenderedSide; which: 'front' | 'back'; showHints: boolean }) {
  const c = useTheme();
  // Blocks with a tapLabel (Anki's {{hint:Field}}) stay hidden until tapped; each Side is keyed by card,
  // so what was tapped open is closed again on the next card.
  const [shownHints, setShownHints] = useState<ReadonlySet<number>>(new Set());

  // Consecutive lines of one example sentence are laid out together; every other block is its own group.
  const groups = useMemo(() => {
    const out: Item[][] = [];
    side.blocks.forEach((b, i) => {
      const last = out[out.length - 1];
      if (isExample(b) && last && isExample(last[0].b)) last.push({ b, i });
      else out.push([{ b, i }]);
    });
    return out;
  }, [side.blocks]);

  const hint = ({ b, i }: Item, inExample: boolean) => (
    <Tappable
      key={i}
      accessibilityRole="button"
      onPress={() => { haptic.select(); setShownHints((prev) => new Set(prev).add(i)); }}
      style={{
        alignSelf: inExample ? 'flex-start' : 'center', minHeight: MIN_TAP, justifyContent: 'center',
        paddingHorizontal: inExample ? 0 : space.m,
      }}
    >
      <Text style={{ ...type.callout, color: c.accent }}>{b.tapLabel}</Text>
    </Tappable>
  );

  const line = ({ b, i }: Item) => {
    if (b.role === 'example') {
      return <MarkedText key={i} text={b.text} mark={b.mark} c={c} style={{ fontSize: type.title.fontSize, lineHeight: 34, color: c.text }} />;
    }
    if (b.role === 'exampleRomanized' || b.role === 'exampleTranslation') {
      return <MarkedText key={i} text={b.text} mark={b.mark} c={c} style={{ ...type.subhead, lineHeight: 21, color: c.textSecondary }} />;
    }
    return null;
  };

  return (
    <View style={{ gap: space.l }}>
      {groups.map((group) => {
        const first = group[0];
        const hidden = (it: Item) => !!it.b.tapLabel && !showHints && !shownHints.has(it.i);

        if (isExample(first.b)) {
          return (
            <View key={first.i} style={{ gap: space.xs }}>
              {group.map((it) => (hidden(it) ? hint(it, true) : line(it)))}
            </View>
          );
        }
        if (hidden(first)) return hint(first, false);

        const { b, i } = first;
        if (b.role === 'chips') {
          return (
            <View key={i} style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.xs + 2 }}>
              {(b.chips ?? []).map((chip) => (
                <View key={chip} style={{ backgroundColor: c.fill, borderRadius: radius.pill, paddingHorizontal: space.m - 1, paddingVertical: space.xs }}>
                  <Text style={{ ...type.footnote, color: c.textSecondary }}>{chip}</Text>
                </View>
              ))}
            </View>
          );
        }
        if (b.role === 'note') {
          return (
            <View key={i} style={{ backgroundColor: c.fill, borderRadius: radius.m, ...smooth, padding: space.m, gap: space.xs }}>
              {b.label ? <Text style={{ ...type.overline, color: c.accent }}>{b.label}</Text> : null}
              <Text style={{ ...type.subhead, color: c.textSecondary, lineHeight: 21 }}>{b.text}</Text>
            </View>
          );
        }
        return (
          <View key={i} style={{ gap: space.xs }}>
            {b.label ? <Text style={{ ...type.overline, color: c.accent }}>{b.label}</Text> : null}
            <View style={b.icon ? { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s } : undefined}>
              {b.icon ? <Icon name={b.icon} size={28} color={c.text} /> : null}
              <Text
                style={b.emphasis
                  ? { ...(which === 'front' ? type.cardFront : type.cardBack), color: c.text, textAlign: 'center' }
                  : { ...type.body, color: c.textSecondary, lineHeight: 24 }}
              >
                {b.text}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
