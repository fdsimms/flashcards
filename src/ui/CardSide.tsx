import React, { useMemo, useState } from 'react';
import { Text, View, type TextStyle } from 'react-native';
import { GENDER_WORDS } from '../core/cards';
import { leadingArticle, withArticle, type Gender } from '../core/gender';
import type { Segment } from '../core/highlight';
import { DEFAULT_THAI_TEXT_SIZE, hasThai, japaneseFont, thaiTextStyle, withThaiLineHeight, type ThaiTextSize } from '../core/script';
import { toneSpans, type Tone } from '../core/toneColors';
import type { RenderedSide } from '../core/types';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { MIN_TAP, hairline, radius, smooth, space, type, useTheme, type Colors } from './theme';
import { useFont } from './AppFont';
import { Ruby } from './Ruby';
import type { FuriganaSetting, Run } from '../core/furigana';
import { CardSentence } from './CardSentence';
import { TranslationRow } from './TranslationRow';
import type { SentenceGloss } from './useCardGlosses';

type Block = RenderedSide['blocks'][number];
type Item = { b: Block; i: number };

const isExample = (b: Block) => b.role === 'example' || b.role === 'exampleRomanized' || b.role === 'exampleTranslation';

const genderColor = (c: Colors, g: Gender) => (g === 'm' ? c.genderM : g === 'f' ? c.genderF : c.genderN);
const toneColor = (c: Colors, t: Tone) => (t === 'low' ? c.toneLow : t === 'falling' ? c.toneFalling : t === 'high' ? c.toneHigh : c.toneRising);

/** A Thai romanization with each syllable colored by its tone; mid tone keeps the text's own color. The tone marks stay, so color is never the only signal. */
function ToneSpans({ text, c }: { text: string; c: Colors }) {
  return <>{toneSpans(text).map((s, k) => (s.tone ? <Text key={k} style={{ color: toneColor(c, s.tone) }}>{s.text}</Text> : s.text))}</>;
}

/** A word with its leading article (der, la, ο) in its gender's color, when the note names a gender and the word has one. */
function EntryText({ text, gender, c }: { text: string; gender?: Gender; c: Colors }) {
  const split = gender ? leadingArticle(text) : null;
  if (!gender || !split) return <>{text}</>;
  return <><Text style={{ color: genderColor(c, gender) }}>{split.article}</Text>{split.rest}</>;
}

/** Text with its marked segments picked out, as a card's word is in its example sentence. */
function MarkedText({ text, segments, style, c, tones }: { text: string; segments?: Segment[]; style: TextStyle; c: Colors; tones?: boolean }) {
  const plain = (t: string) => (tones ? <ToneSpans text={t} c={c} /> : t);
  return (
    <Text style={style}>
      {(segments ?? [{ text, marked: false }]).map((s, k) => (
        s.marked
          ? <Text key={k} style={{ color: c.accentInk, backgroundColor: c.accentFill, fontWeight: '600' }}>{plain(s.text)}</Text>
          : <React.Fragment key={k}>{plain(s.text)}</React.Fragment>
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
 * With `speakSentence`, the Example heading has a speaker button that reads the sentence aloud.
 * With `furigana` (once the answer shows), a Japanese word is drawn with `wordRuns`, its reading over
 * its kanji, and the sentence's words with theirs; the "Show reading" line goes, as it says the same.
 */
export function Side({ side, which, showHints, thaiSize = DEFAULT_THAI_TEXT_SIZE, gloss, speakSentence, speechLang, furigana, wordRuns }: {
  side: RenderedSide; which: 'front' | 'back'; showHints: boolean; thaiSize?: ThaiTextSize; gloss?: SentenceGloss | null;
  speakSentence?: (text: string) => void;
  /** The card's language, so Japanese text takes Japanese's face (script.ts). */
  speechLang?: string;
  /** The furigana setting, given once the answer shows (furigana.ts). */
  furigana?: FuriganaSetting;
  /** The card's word as runs with their readings (`cardWordRuns`), or null to draw it as before. */
  wordRuns?: Run[] | null;
}) {
  const c = useTheme();
  const thai = thaiTextStyle(thaiSize);
  const font = useFont();
  const ja = (text: string) => japaneseFont(text, speechLang, font);
  // Blocks with a tapLabel (Anki's {{hint:Field}}) stay hidden until tapped; each Side is keyed by card,
  // so what was tapped open is closed again on the next card.
  const [shownHints, setShownHints] = useState<ReadonlySet<number>>(new Set());

  // Consecutive lines of one example sentence are laid out together; every other block is its own group.
  const groups = useMemo(() => {
    const out: Item[][] = [];
    side.blocks.forEach((b, i) => {
      // Furigana over the word says what the reading line would.
      if (b.role === 'reading' && furigana && wordRuns) return;
      const last = out[out.length - 1];
      if (isExample(b) && last && isExample(last[0].b)) last.push({ b, i });
      else out.push([{ b, i }]);
    });
    return out;
  }, [side.blocks, furigana, wordRuns]);

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
      const style = { ...(hasThai(b.text) ? thai : { fontSize: type.title.fontSize, lineHeight: 34 }), ...ja(b.text), color: c.text };
      if (gloss && gloss.words.map((w) => w.text).join('') === b.text) return <CardSentence key={i} gloss={gloss} segments={b.segments} style={style} furigana={furigana} />;
      return <MarkedText key={i} text={b.text} segments={b.segments} c={c} style={style} />;
    }
    if (b.role === 'exampleRomanized' || b.role === 'exampleTranslation') {
      return <MarkedText key={i} text={b.text} segments={b.segments} c={c} tones={b.tones} style={{ ...type.subhead, lineHeight: 21, color: c.textSecondary }} />;
    }
    return null;
  };

  // The shown translation is its own labeled row, so one that reads like a question isn't taken for a prompt.
  const translationRow = (it: Item) => (
    <View key={it.i} style={{ paddingHorizontal: space.m, paddingBottom: space.m }}>
      <TranslationRow>{line(it)}</TranslationRow>
    </View>
  );

  return (
    <View style={{ gap: space.l }}>
      {groups.map((group) => {
        const first = group[0];
        const hidden = (it: Item) => !!it.b.tapLabel && !showHints && !shownHints.has(it.i);

        if (isExample(first.b)) {
          const sentence = group.find((it) => it.b.role === 'example')?.b.text;
          return (
            <View key={first.i} style={{ gap: space.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ ...type.overline, color: c.accent }}>Example</Text>
                {sentence && speakSentence ? (
                  <Tappable
                    accessibilityRole="button"
                    accessibilityLabel="Read the example sentence aloud"
                    onPress={() => { haptic.tap(); speakSentence(sentence); }}
                    hitSlop={space.m}
                    scaleTo={0.9}
                  >
                    <Icon name="speaker.wave.2.fill" size={18} color={c.accent} />
                  </Tappable>
                ) : null}
              </View>
              <View style={{ backgroundColor: c.fill, borderRadius: radius.m, ...smooth, overflow: 'hidden' }}>
                {group.map((it) => (hidden(it)
                  ? hintRow(it)
                  : it.b.role === 'exampleTranslation' ? translationRow(it)
                  : <View key={it.i} style={{ padding: space.m, paddingTop: it.b.role === 'example' ? space.m : 0, paddingBottom: space.s }}>{line(it)}</View>))}
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
                <View key={chip} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, backgroundColor: c.fill, borderRadius: radius.pill, paddingHorizontal: space.m - 1, paddingVertical: space.xs }}>
                  {b.gender && chip === GENDER_WORDS[b.gender] ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: genderColor(c, b.gender) }} /> : null}
                  <Text style={{ ...type.footnote, color: c.textSecondary }}>{chip}</Text>
                </View>
              ))}
            </View>
          );
        }
        if (b.role === 'counting') {
          return (
            <View key={i} style={{ gap: space.xs }}>
              {b.label ? <Text style={{ ...type.overline, color: c.accent }}>{b.label}</Text> : null}
              <View style={{ backgroundColor: c.fill, borderRadius: radius.m, ...smooth, padding: space.m, gap: space.xs }}>
                {(b.rows ?? []).map((r) => {
                  const cut = r.value.length - r.label.length;
                  return (
                    <Text key={r.label} style={{ ...thai, color: c.text }}>
                      {r.value.slice(0, cut)}
                      <Text style={{ color: c.accent, fontWeight: '600' }}>{r.label}</Text>
                    </Text>
                  );
                })}
                {(b.rows ?? []).filter((r) => r.counts).map((r) => (
                  <Text key={`${r.label}-counts`} style={{ ...type.subhead, color: c.textSecondary, lineHeight: 21 }}>
                    <Text style={{ ...thai, fontSize: type.subhead.fontSize, color: c.text }}>{r.label}</Text>
                    {` (${r.counts?.roman}) counts ${r.counts?.what}.`}
                  </Text>
                ))}
                <Text style={{ ...type.subhead, color: c.textSecondary, lineHeight: 21 }}>
                  Say the noun, the number, then the counting word.
                </Text>
              </View>
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
                  <Text style={{ ...(hasThai(r.value) ? thai : { ...type.body, lineHeight: 24 }), ...ja(r.value), color: c.text, flex: 1 }}>{r.value}</Text>
                </View>
              ))}
            </View>
          );
        }
        if (b.role === 'gloss') {
          return (
            <Text key={i} style={{ ...type.title, fontWeight: '400', lineHeight: 28, color: c.textSecondary, textAlign: 'center' }}>
              {b.text}
            </Text>
          );
        }
        if (b.role === 'wanted') {
          return (
            <Text key={i} style={{ ...(hasThai(b.text) ? thai : { ...type.subhead, lineHeight: 21 }), ...ja(b.text), color: c.textSecondary, textAlign: 'center' }}>
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
              {b.emphasis && b.reading && furigana && wordRuns ? (
                <Ruby runs={wordRuns} style={{ ...type.cardFront, ...ja(b.text), color: c.text }} rubyColor={c.textSecondary} center />
              ) : b.emphasis ? (
                <Text style={{ ...withThaiLineHeight(type.cardFront, b.text), ...ja(b.text), color: c.text, textAlign: 'center' }}>
                  {b.prefix ? <Text style={{ color: b.gender ? genderColor(c, b.gender) : c.textTertiary, fontWeight: b.gender ? '600' : '400' }}>{b.prefix}{withArticle(b.prefix, '').endsWith(' ') ? ' ' : ''}</Text> : null}
                  <EntryText text={b.text} gender={b.gender} c={c} />
                </Text>
              ) : (
                // A field can hold Thai and its romanization on separate lines; the Thai lines get the
                // size of an example sentence, since Thai is hard to read at body size (the size is a setting).
                // A line with no label (pronunciation, transliteration, reading) is centered under the word,
                // as the headline is; a labeled one (Mnemonic) stays left-aligned under its label.
                <View style={{ gap: space.xs }}>
                  {b.text.split('\n').map((ln, k) => (hasThai(ln)
                    ? <Text key={k} style={{ ...thai, color: c.text, textAlign: b.label ? undefined : 'center' }}>{ln}</Text>
                    : <Text key={k} style={{ ...type.body, ...ja(ln), color: c.textSecondary, lineHeight: 24, textAlign: b.label ? undefined : 'center' }}>{b.tones ? <ToneSpans text={ln} c={c} /> : ln}</Text>))}
                </View>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}
