import React, { useMemo, useState } from 'react';
import { Text, View, type TextStyle } from 'react-native';
import type { Segment } from '../core/highlight';
import { DEFAULT_THAI_TEXT_SIZE, hasThai, thaiTextStyle, withThaiLineHeight, type ThaiTextSize } from '../core/script';
import type { RenderedSide } from '../core/types';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { MIN_TAP, hairline, radius, smooth, space, type, useTheme, type Colors } from './theme';
import { CardSentence } from './CardSentence';
import type { SentenceGloss } from './useCardGlosses';

type Block = RenderedSide['blocks'][number];
type Item = { b: Block; i: number };

const isExample = (b: Block) => b.role === 'example' || b.role === 'exampleRomanized' || b.role === 'exampleTranslation';

/** Text with its marked segments picked out, as a card's word is in its example sentence. */
function MarkedText({ text, segments, style, c }: { text: string; segments?: Segment[]; style: TextStyle; c: Colors }) {
  return (
    <Text style={style}>
      {(segments ?? [{ text, marked: false }]).map((s, k) => (
        s.marked
          ? <Text key={k} style={{ color: c.accent, backgroundColor: c.accentFill, fontWeight: '600' }}>{s.text}</Text>
          : s.text
      ))}
    </Text>
  );
}

/**
 * One side of a natively rendered card: the word or question large and centered, the details
 * under it in smaller text with their labels. On the back, the tags are chips, the word's forms
 * are a labeled list, an example sentence's lines sit close together with the word highlighted,
 * and a note is set off in a box.
 * `showHints` shows the lines Anki hides behind a tap (romanization, translation) without one.
 * With `gloss` (the sentence's words from Read & Listen's server), the example sentence's words can
 * be tapped for their meanings (CardSentence).
 */
export function Side({ side, which, showHints, thaiSize = DEFAULT_THAI_TEXT_SIZE, gloss }: {
  side: RenderedSide; which: 'front' | 'back'; showHints: boolean; thaiSize?: ThaiTextSize; gloss?: SentenceGloss | null;
}) {
  const c = useTheme();
  const thai = thaiTextStyle(thaiSize);
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

  const reveal = (i: number) => { haptic.select(); setShownHints((prev) => new Set(prev).add(i)); };

  // A hidden line outside the example sentence: a centered link.
  const hint = ({ b, i }: Item) => (
    <Tappable
      key={i}
      accessibilityRole="button"
      onPress={() => reveal(i)}
      style={{ alignSelf: 'center', minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: space.m }}
    >
      <Text style={{ ...type.callout, color: c.accent }}>{b.tapLabel}</Text>
    </Tappable>
  );

  // A hidden line inside the Example box: a full-width row under the sentence.
  const hintRow = ({ b, i }: Item) => (
    <Tappable
      key={i}
      accessibilityRole="button"
      onPress={() => reveal(i)}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: MIN_TAP, paddingHorizontal: space.m,
        borderTopWidth: hairline, borderTopColor: c.border,
      }}
    >
      <Icon name="eye" size={16} color={c.accent} />
      <Text style={{ ...type.callout, color: c.accent }}>{b.tapLabel}</Text>
    </Tappable>
  );

  const line = ({ b, i }: Item) => {
    if (b.role === 'example') {
      const style = { ...(hasThai(b.text) ? thai : { fontSize: type.title.fontSize, lineHeight: 34 }), color: c.text };
      if (gloss && gloss.words.map((w) => w.text).join('') === b.text) return <CardSentence key={i} gloss={gloss} segments={b.segments} style={style} />;
      return <MarkedText key={i} text={b.text} segments={b.segments} c={c} style={style} />;
    }
    if (b.role === 'exampleRomanized' || b.role === 'exampleTranslation') {
      return <MarkedText key={i} text={b.text} segments={b.segments} c={c} style={{ ...type.subhead, lineHeight: 21, color: c.textSecondary }} />;
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
              <Text style={{ ...type.overline, color: c.accent }}>Example</Text>
              <View style={{ backgroundColor: c.fill, borderRadius: radius.m, ...smooth, overflow: 'hidden' }}>
                {group.map((it) => (hidden(it)
                  ? hintRow(it)
                  : <View key={it.i} style={{ padding: space.m, paddingTop: it.b.role === 'example' ? space.m : space.s }}>{line(it)}</View>))}
              </View>
            </View>
          );
        }
        if (hidden(first)) return hint(first);

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
        if (b.role === 'forms') {
          return (
            <View key={i} style={{ gap: space.xs }}>
              {b.label ? <Text style={{ ...type.overline, color: c.accent }}>{b.label}</Text> : null}
              {(b.rows ?? []).map((r) => (
                <View key={r.label} style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.m }}>
                  <Text style={{ ...type.footnote, color: c.textTertiary, minWidth: 104 }}>{r.label}</Text>
                  <Text style={{ ...(hasThai(r.value) ? thai : { ...type.body, lineHeight: 24 }), color: c.text, flex: 1 }}>{r.value}</Text>
                </View>
              ))}
            </View>
          );
        }
        if (b.role === 'wanted') {
          return (
            <Text key={i} style={{ ...(hasThai(b.text) ? thai : { ...type.subhead, lineHeight: 21 }), color: c.textSecondary, textAlign: 'center' }}>
              {b.text}
            </Text>
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
              {b.emphasis ? (
                <Text style={{ ...withThaiLineHeight(type.cardFront, b.text), color: c.text, textAlign: 'center' }}>
                  {b.prefix ? <Text style={{ color: c.textTertiary, fontWeight: '400' }}>{b.prefix} </Text> : null}
                  {b.text}
                </Text>
              ) : (
                // A field can hold Thai and its romanization on separate lines; the Thai lines get the
                // size of an example sentence, since Thai is hard to read at body size (the size is a setting).
                <View style={{ gap: space.xs }}>
                  {b.text.split('\n').map((ln, k) => (hasThai(ln)
                    ? <Text key={k} style={{ ...thai, color: c.text }}>{ln}</Text>
                    : <Text key={k} style={{ ...type.body, color: c.textSecondary, lineHeight: 24 }}>{ln}</Text>))}
                </View>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}
