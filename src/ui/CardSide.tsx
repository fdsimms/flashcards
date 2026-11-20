import React, { useMemo, useState } from 'react';
import { Text, View, type TextStyle } from 'react-native';
import type { SFSymbol } from 'expo-symbols';
import { GENDER_WORDS } from '../core/cards';
import { NOT_PREFIX } from '../core/synonyms';
import { leadingArticle, withArticle, type Gender } from '../core/gender';
import type { Segment } from '../core/highlight';
import { DEFAULT_THAI_TEXT_SIZE, hasCyrillic, hasThai,japaneseFont, thaiTextStyle, withThaiLineHeight, type ThaiTextSize } from '../core/script';
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
import { EDIT_ICON_ROOM, EditableField } from './EditableField';
import type { EditableField as FieldName } from '../core/editField';
import type { SentenceGloss } from './useCardGlosses';

type Block = RenderedSide['blocks'][number];
type Item = { b: Block; i: number };

const isExample = (b: Block) => b.role === 'example' || b.role === 'exampleRomanized' || b.role === 'exampleTranslation';

/** A hint button's name and icon: an example's two lines are named by their role, the word's own by its tap label without "Show" (Transliteration). */
function hintButton(b: Block): { label: string; icon: SFSymbol } {
  if (b.role === 'exampleRomanized') return { label: 'Romanization', icon: 'textformat' };
  if (b.role === 'exampleTranslation') return { label: 'Translation', icon: 'globe' };
  const word = (b.tapLabel ?? '').replace(/^Show /, '');
  return { label: word.charAt(0).toUpperCase() + word.slice(1), icon: b.role === 'transliteration' || b.role === 'reading' ? 'textformat' : 'waveform' };
}

const genderColor =(c: Colors, g: Gender) => (g === 'm' ? c.genderM : g === 'f' ? c.genderF : c.genderN);
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

/** The gloss that splits a card's headword into the words it is made of, if the server has answered for it. */
const headwordGloss = (gloss: SentenceGloss[] | null | undefined, text: string) => gloss?.find((g) => g.parts && g.words.map((w) => w.text).join('') === text);

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
 * under it in smaller text with their labels. On the back, the tags are chips, the word's grammar
 * is a box of its forms, each under its name, an example sentence's lines sit close together with the word highlighted,
 * and a note, mnemonic, kanji or etymology is set off in a box under its label, laid out like the Example's.
 * `showHints` shows the lines Anki hides behind a tap (romanization, translation) without one.
 * With `gloss` (each example sentence's words from Read & Listen's server), an example sentence's words can
 * be tapped for their meanings (CardSentence).
 * With `speakSentence`, the Example heading has a speaker button that reads the sentence aloud.
 * With `furigana` (once the answer shows), a Japanese word is drawn with `wordRuns`, its reading over
 * its kanji, and the sentence's words with theirs; the "Show reading" line goes, as it says the same.
 */
export function Side({ side, which, showHints, thaiSize = DEFAULT_THAI_TEXT_SIZE, gloss, speakSentence, speechLang, furigana, wordRuns, onEditField, onEditing }: {
  side: RenderedSide; which: 'front' | 'back'; showHints: boolean; thaiSize?: ThaiTextSize; gloss?: SentenceGloss[] | null;
  speakSentence?: (text: string) => void;
  /** The card's language, so Japanese text takes Japanese's face (script.ts). */
  speechLang?: string;
  /** The furigana setting, given once the answer shows (furigana.ts). */
  furigana?: FuriganaSetting;
  /** The card's word as runs with their readings (`cardWordRuns`), or null to draw it as before. */
  wordRuns?: Run[] | null;
  /** Given on the back: Mnemonic and Notes get an edit icon that edits them in place, saving the note through this. */
  onEditField?: (field: FieldName, text: string) => Promise<void>;
  /** Whether one of those boxes is open (the card holds off swipe-to-rate while it is). */
  onEditing?: (editing: boolean) => void;
}) {
  const c = useTheme();
  const thai = thaiTextStyle(thaiSize);
  const font = useFont();
  const ja = (text: string) => japaneseFont(text, speechLang, font);
  // Blocks with a tapLabel (Anki's {{hint:Field}}) stay hidden until tapped; each Side is keyed by card,
  // so what was tapped open is closed again on the next card.
  const [shownHints, setShownHints] = useState<ReadonlySet<number>>(new Set());

  // Consecutive lines of one example sentence are laid out together; every other block is its own group.
  // The hidden lines that follow one another outside an example (transliteration, pronunciation, reading) share
  // one bar of buttons, which comes ahead of the run; `bars` holds those groups. Each line keeps its own group
  // after it, drawn only while it is open.
  const { groups, bars } = useMemo(() => {
    const out: Item[][] = [];
    const bars = new Set<Item[]>();
    let bar: Item[] | null = null;
    side.blocks.forEach((b, i) => {
      // Furigana over the word says what the reading line would.
      if (b.role === 'reading' && furigana && wordRuns) return;
      const last = out[out.length - 1];
      // A note's second example starts its own box.
      if (isExample(b) && last && isExample(last[0].b) && !(b.role === 'example' && last.some((it) => it.b.role === 'example'))) { last.push({ b, i }); return; }
      if (b.tapLabel && !isExample(b) && !showHints) {
        if (!bar) { bar = []; bars.add(bar); out.push(bar); }
        bar.push({ b, i });
      } else bar = null;
      out.push([{ b, i }]);
    });
    return { groups: out, bars };
  }, [side.blocks, furigana, wordRuns, showHints]);

  // A block that shows a whole note field, with its edit icon when the card lets it be edited.
  const editable = (b: Block, node: React.ReactElement) => (b.field && onEditField
    ? <EditableField key={node.key} label={b.label ?? b.field} text={b.text} onSave={(text) => onEditField(b.field!, text)} onEditing={onEditing}>{node}</EditableField>
    : node);

  // An editable block's box leaves room at its right for the edit icon.
  const editRoom = (b: Block) => (b.field && onEditField ? { paddingRight: EDIT_ICON_ROOM } : null);

  // A hint button opens its line and closes it again.
  const toggle = (i: number) => { haptic.select(); setShownHints((prev) => { const next = new Set(prev); if (!next.delete(i)) next.add(i); return next; }); };

  // A row of buttons for hidden lines: under an Example's sentence (so several examples stay short), or on its own
  // for the word's transliteration, pronunciation and reading. A button highlights while its line is open, and a
  // second tap closes the line.
  const hintButtons = (items: Item[], topEdge: boolean) => (
    <View key="buttons" style={{ flexDirection: 'row', borderTopWidth: topEdge ? hairline : 0, borderTopColor: c.border }}>
      {items.map((it, k) => {
        const on = shownHints.has(it.i);
        const { label, icon } = hintButton(it.b);
        return (
          <Tappable
            key={it.i}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={label}
            onPress={() => toggle(it.i)}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs + 2, minHeight: MIN_TAP,
              backgroundColor: on ? c.accentFill : undefined, borderLeftWidth: k ? hairline : 0, borderLeftColor: c.border,
            }}
          >
            <Icon name={icon} size={16} color={c.accentInk} />
            <Text style={{ ...type.callout, color: c.accentInk }}>{label}</Text>
          </Tappable>
        );
      })}
    </View>
  );

  const line = ({ b, i }: Item) => {
    if (b.role === 'example') {
      const plain = hasCyrillic(b.text) ? { fontSize: 19, lineHeight: 28 } : { fontSize: type.title.fontSize, lineHeight: 34 };
      const style = { ...(hasThai(b.text) ? thai : plain), ...ja(b.text), color: c.textBody };
      const sentenceGloss = gloss?.find((g) => !g.parts && g.words.map((w) => w.text).join('') === b.text);
      if (sentenceGloss) return <CardSentence key={i} gloss={sentenceGloss} segments={b.segments} style={style} furigana={furigana} />;
      return <MarkedText key={i} text={b.text} segments={b.segments} c={c} style={style} />;
    }
    // The romanization is a small italic pronunciation guide, so it reads differently from the word's transliteration above and from the translation.
    if (b.role === 'exampleRomanized') {
      return <MarkedText key={i} text={b.text} segments={b.segments} c={c} tones={b.tones} style={{ ...type.subhead, lineHeight: 21, color: c.textSecondary, fontStyle: 'italic' }} />;
    }
    if (b.role === 'exampleTranslation') {
      return <MarkedText key={i} text={b.text} segments={b.segments} c={c} tones={b.tones} style={{ ...type.subhead, lineHeight: 21, color: c.textSecondary }} />;
    }
    return null;
  };

  // The shown translation is its own labeled row, so one that reads like a question isn't taken for a prompt.
  const translationRow = (it: Item) => (
    <View key={it.i} style={{ paddingHorizontal: space.m, paddingBottom: space.m }}>
      <TranslationRow literal={it.b.literal}>{line(it)}</TranslationRow>
    </View>
  );

  return (
    <View style={{ gap: space.l }}>
      {groups.map((group) => {
        const first = group[0];
        const hidden = (it: Item) => !!it.b.tapLabel && !showHints && !shownHints.has(it.i);

        if (isExample(first.b)) {
          const sentenceBlock = group.find((it) => it.b.role === 'example')?.b;
          const sentence = sentenceBlock?.text;
          const buttons = showHints ? [] : group.filter((it) => !!it.b.tapLabel);
          const opened = group.filter((it) => it.b.role !== 'example' && (!it.b.tapLabel || showHints || shownHints.has(it.i)));
          return (
            <View key={first.i} style={{ gap: space.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ ...type.overline, color: c.accent }}>
                  Example{sentenceBlock?.tag ? <Text style={{ color: c.textDim }}>{`  ${sentenceBlock.tag}`}</Text> : null}
                </Text>
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
                {group.filter((it) => it.b.role === 'example').map((it) => (
                  <View key={it.i} style={{ padding: space.m, paddingBottom: space.s }}>{line(it)}</View>))}
                {buttons.length ? hintButtons(buttons, true) : null}
                {opened.map((it) => (it.b.role === 'exampleTranslation' ? translationRow(it)
                  : <View key={it.i} style={{ padding: space.m, paddingTop: buttons.length ? space.s : 0, paddingBottom: space.s }}>{line(it)}</View>))}
              </View>
            </View>
          );
        }
        if (bars.has(group)) {
          return <View key={`bar-${first.i}`} style={{ backgroundColor: c.fill, borderRadius: radius.m, ...smooth, overflow: 'hidden' }}>{hintButtons(group, false)}</View>;
        }
        // A closed line shows through its button in the bar above.
        if (hidden(first)) return null;

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
              </View>
            </View>
          );
        }
        if (b.role === 'grammar') {
          const cells = b.cells ?? [];
          return (
            <View key={i} style={{ gap: space.xs }}>
              {b.label ? <Text style={{ ...type.overline, color: c.accent }}>{b.label}</Text> : null}
              <View style={{ backgroundColor: c.fill, borderRadius: radius.m, ...smooth, padding: space.m, gap: space.s + 2 }}>
                {b.pattern ? <Text style={{ ...type.subhead, color: c.textBody, lineHeight: 21 }}>{b.pattern}</Text> : null}
                {b.pattern && cells.length ? <View style={{ height: hairline, backgroundColor: c.border }} /> : null}
                {cells.length ? (
                  // Two forms to a row; what the word takes, and a line with no label, run the box's width.
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.s + 2 }}>
                    {cells.map((cell, k) => (
                      <View key={`${cell.label}-${k}`} style={{ width: cell.wide ? '100%' : '50%', paddingRight: space.m }}>
                        <Text style={{ ...type.footnote, color: c.textTertiary }}>{cell.label}</Text>
                        <Text style={{ ...(hasThai(cell.value) ? thai : { ...type.body, lineHeight: 24 }), ...ja(cell.value), color: c.text }}>
                          {(cell.segments ?? [{ text: cell.value, marked: false }]).map((s, n) => (
                            // The letters where the form leaves the word: in the accent, with its weight, so color isn't the only signal.
                            s.marked ? <Text key={n} style={{ color: c.accentInk, fontWeight: '600' }}>{s.text}</Text> : <React.Fragment key={n}>{s.text}</React.Fragment>
                          ))}
                        </Text>
                        {cell.detail ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{cell.detail}</Text> : null}
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
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
          // A hint, not a headline: a small pill under the meaning, "Not" set apart from the words it names.
          const names = b.text.startsWith(NOT_PREFIX);
          const words = names ? b.text.slice(NOT_PREFIX.length) : b.text;
          return (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s - 2, backgroundColor: c.fill, borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: space.xs }}>
              {names ? <Text style={{ ...type.overline, fontSize: 11, color: c.textDim }}>Not</Text> : null}
              <Text style={{ ...(hasThai(words) ? { ...thai, fontSize: 16, lineHeight: 24 } : { ...type.footnote, lineHeight: 18 }), ...ja(words), color: c.textBody }}>{words}</Text>
            </View>
          );
        }
        if (b.role === 'sense') {
          return (
            <Text key={i} style={{ ...type.subhead, lineHeight: 21, color: c.textSecondary, textAlign: 'center', marginTop: -space.s }}>
              {b.text}
            </Text>
          );
        }
        if (b.role === 'note') {
          return editable(b, (
            <View key={i} style={{ gap: space.xs }}>
              {b.label ? <Text style={{ ...type.overline, color: c.accent }}>{b.label}</Text> : null}
              <View style={{ backgroundColor: c.fill, borderRadius: radius.m, ...smooth, padding: space.m, ...editRoom(b) }}>
                <Text style={{ ...type.subhead, color: c.textBody, lineHeight: 21 }}>{b.text}</Text>
              </View>
            </View>
          ));
        }
        // A labeled detail (Mnemonic, Kanji or Hanzi, Etymology) is boxed under its label like a note and the example.
        const boxed = !!b.label && !b.emphasis && !b.icon;
        return editable(b, (
          <View key={i} style={{ gap: space.xs }}>
            {b.label ? <Text style={{ ...type.overline, color: c.accent }}>{b.label}</Text> : null}
            <View style={boxed ? { backgroundColor: c.fill, borderRadius: radius.m, ...smooth, padding: space.m, ...editRoom(b) } : b.icon ? { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s } : undefined}>
              {b.icon ? <Icon name={b.icon} size={28} color={c.text} /> : null}
              {b.emphasis && b.reading && furigana && wordRuns ? (
                <Ruby runs={wordRuns} style={{ ...type.cardFront, ...ja(b.text), color: c.text }} rubyColor={c.textSecondary} center />
              ) : b.emphasis && which === 'back' && headwordGloss(gloss, b.text) ? (
                // A compound's parts, each tapped for its meaning as an example sentence's words are (CardSentence).
                <CardSentence gloss={headwordGloss(gloss, b.text)!} style={{ ...withThaiLineHeight(type.cardFront, b.text), color: c.text }} center />
              ) : b.emphasis ? (
                <Text style={{ ...withThaiLineHeight(b.role === 'meaning' ? { ...type.reading, fontWeight: '400' as const } : type.cardFront, b.text), ...ja(b.text), color: c.text, textAlign: 'center' }}>
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
                    ? <Text key={k} style={{ ...thai, color: boxed ? c.textBody : c.text, textAlign: b.label ? undefined : 'center' }}>{ln}</Text>
                    // The word's transliteration is set larger and in the text color, apart from an example's small italic romanization.
                    : <Text key={k} style={{ ...(boxed ? { ...type.subhead, lineHeight: 21 } : b.role === 'transliteration' ? { ...type.title, fontWeight: '500', lineHeight: 28 } : { ...type.body, lineHeight: 24 }), ...ja(ln), color: boxed ? c.textBody : b.role === 'transliteration' ? c.text : c.textSecondary, textAlign: b.label ? undefined : 'center' }}>{b.tones ? <ToneSpans text={ln} c={c} /> : ln}</Text>))}
                </View>
              )}
            </View>
          </View>
        ));
      })}
    </View>
  );
}
