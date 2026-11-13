import React from 'react';
import { Pressable, Text, View, type GestureResponderEvent, type ViewInstance } from 'react-native';
import type { TextGrammar, Word } from '../reader/api';
import type { ReadFont } from '../reader/fonts';
import type { HideableMark } from '../reader/marks';
import { radius, useTheme } from './theme';

/**
 * One word of a text, with the marks it wears (the key in ReaderKey.tsx explains them): a fill
 * behind a word outside the deck or a name, gold bold text and a dot on a practice word, an
 * underline for its grammar point, a blue underline once marked unknown. Also the sample beside each
 * switch in the key, so the key can't drift from how a word is drawn.
 */

export type PhrasePart = 'only' | 'first' | 'middle' | 'last';

/**
 * A selected phrase is drawn as one band across its pieces, spaces and punctuation included: each
 * piece fills its own box and draws a bar along its bottom edge. Only the top corners at the
 * phrase's two ends are rounded, so the band reads the same where the phrase wraps onto a second
 * line (an outline had ends to close at every wrap, and drew open boxes there). Like the selection
 * ring, the bar is an overlay, so the band moves nothing.
 */
function phraseCorners(part: PhrasePart) {
  const r = radius.s - 2;
  const left = part === 'only' || part === 'first' ? r : 0;
  const right = part === 'only' || part === 'last' ? r : 0;
  return { borderTopLeftRadius: left, borderTopRightRadius: right, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 };
}

function PhraseBar() {
  const c = useTheme();
  return <View pointerEvents="none" style={{ position: 'absolute', right: 0, bottom: 0, left: 0, height: 2, backgroundColor: c.accent }} />;
}

export type ReadTextStyle = { fontSize: number; lineHeight: number; font: ReadFont };

export function WordView({ word, grammar, textStyle, flagged, highlighted, named, selected, hidden = [], phrasePart = null, phraseStart = false, dimmed = false, playing = false, spoken = false, onPress, onLongPress, viewRef }: {
  word: Word;
  grammar: TextGrammar | null;
  textStyle: ReadTextStyle;
  flagged: boolean;
  highlighted: boolean;
  /** A name the model marked, with names marked on. */
  named: boolean;
  selected: boolean;
  /** Marks the reader switched off in the key: not drawn, though the word still has them (a tap still shows its grammar). */
  hidden?: readonly HideableMark[];
  /** Where it sits in the selected phrase, if it's in one. */
  phrasePart?: PhrasePart | null;
  /** The phrase's first word, while its last is being chosen: ringed like a tapped word. */
  phraseStart?: boolean;
  /** In a line the phrase being selected can't reach. */
  dimmed?: boolean;
  /** In the line being played, in a story read as continuous text (a line row is shaded as a whole). */
  playing?: boolean;
  /** Being spoken now, as the line plays (useSpokenWords). */
  spoken?: boolean;
  onPress: (word: Word, x: number, y: number) => void;
  /** Held: starts selecting a phrase by dragging (usePhraseDrag). */
  onLongPress?: (word: Word, e: GestureResponderEvent) => void;
  /** The word's view, measured when a phrase is dragged. */
  viewRef?: (v: ViewInstance | null) => void;
}) {
  const c = useTheme();
  if (word.status === null) {
    // A space becomes a gap; punctuation is shown but can't be tapped. Inside a selected phrase
    // either one takes a tapped word's height (padding, plus the underline's border), so the band
    // runs through it unbroken.
    const piece = word.text.trim()
      ? <Text style={{ fontSize: textStyle.fontSize, lineHeight: textStyle.lineHeight, fontFamily: textStyle.font.fontFamily, color: c.text }}>{word.text}</Text>
      : <View style={{ width: textStyle.fontSize * 0.3 }} />;
    if (!phrasePart && !dimmed && !playing) return piece;
    return (
      <View style={[
        { opacity: dimmed ? 0.35 : 1 },
        phrasePart ? { backgroundColor: c.accentFill, height: textStyle.lineHeight + 4.5, justifyContent: 'center' }
          : playing ? { backgroundColor: c.fill, height: textStyle.lineHeight + 4.5, justifyContent: 'center' } : null,
      ]}>
        {piece}
        {phrasePart ? <PhraseBar /> : null}
      </View>
    );
  }
  const ringed = selected || phraseStart;
  const stretch = word.stretch && !hidden.includes('stretch');
  const showFlag = flagged && !hidden.includes('marked');
  const role = grammar && !hidden.includes(grammar.role === 'practice' ? 'practice' : grammar.role === 'avoid' ? 'avoid' : 'known') ? grammar.role : null;
  // A fill behind the glyphs, not the whole box: the box is as tall as Thai's stacked marks need,
  // which is far taller than the letters, so a full-height fill read as a block.
  const bandInset = Math.max(0, (textStyle.lineHeight - textStyle.fontSize * 1.1) / 2);
  // The word being spoken takes the band over a highlight or a name, as it moves on in a moment.
  const band = ringed || phrasePart ? null : spoken ? c.spoken : highlighted ? c.highlight : named ? c.nameFill : null;
  return (
    <Pressable
      ref={viewRef}
      onPress={(e) => onPress(word, e.nativeEvent.pageX, e.nativeEvent.pageY)}
      onLongPress={onLongPress ? (e) => onLongPress(word, e) : undefined}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={[word.text, word.stretch && 'practice word', grammar && grammar.name, highlighted && 'not in your deck', named && 'name', flagged && 'marked unknown']
        .filter(Boolean).join(', ')}
      accessibilityHint="Shows what this word means"
      style={{
        // Thai has no spaces between words, so tappable words sit flush and only real spaces in the
        // text show as gaps. The selection ring is an overlay inside the word's own box: a border
        // cancelled by a negative margin pushed each box past its slot and overlapped its neighbors.
        // A playing line is one band, so its words are square and flush; a phrase or a ring inside it keeps its own corners.
        borderRadius: playing && !phrasePart && !ringed ? 0 : radius.s - 2, paddingVertical: 1.5, opacity: dimmed ? 0.35 : 1,
        backgroundColor: ringed || phrasePart ? c.accentFill : playing ? c.fill : undefined,
        ...(phrasePart && !ringed ? phraseCorners(phrasePart) : null),
      }}
    >
      {band ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: bandInset, bottom: bandInset, left: 0, right: 0, borderRadius: radius.s - 2, backgroundColor: band }}
        />
      ) : null}
      {phrasePart && !ringed ? <PhraseBar /> : null}
      {ringed ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius.s - 2, borderWidth: 1.5, borderColor: c.accent }}
        />
      ) : null}
      {stretch ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: 3, right: 1, width: 6, height: 6, borderRadius: radius.pill, backgroundColor: c.accent }} />
      ) : null}
      <Text
        style={[
          { fontSize: textStyle.fontSize, lineHeight: textStyle.lineHeight, fontFamily: textStyle.font.fontFamily, color: stretch ? c.accent : c.text },
          stretch ? textStyle.font.emphasis : null,
          // The underline is a bottom border, not textDecoration: iOS draws a text underline through
          // Thai's below-the-line vowels and consonant feet. The border is always there (transparent
          // when unused) so every word is the same height and a row stays aligned.
          // Grammar is underlined solid when practiced, dashed when it slipped in while avoided, and
          // with a thin gray line when it's a known point worked in or one not set yet (thinner by
          // half a point, made up below it so the row's height doesn't change); a marked word's
          // blue line takes its place (thicker by half a point, taken from below it the same way).
          { borderBottomWidth: 1.5, borderBottomColor: 'transparent' },
          role === 'practice' || role === 'avoid' ? {
            borderStyle: role === 'practice' ? 'solid' : 'dashed',
            borderBottomColor: role === 'practice' ? c.onSpeakerB : c.textTertiary,
          } : null,
          role === 'review' || role === 'unset' ? {
            borderStyle: 'solid', borderBottomWidth: 1, marginBottom: 0.5, borderBottomColor: c.textTertiary,
          } : null,
          showFlag ? { borderStyle: 'solid', borderBottomWidth: 2, marginBottom: -0.5, borderBottomColor: c.countNew } : null,
        ]}
      >
        {word.text}
      </Text>
    </Pressable>
  );
}
