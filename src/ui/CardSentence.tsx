import React, { useState } from 'react';
import { PixelRatio, Pressable, Text, View, type TextStyle } from 'react-native';
import type { Segment } from '../core/highlight';
import { dotOffsets, sentencePieces, wordBreaks } from '../reader/cardGlosses';
import { LANGUAGES } from '../reader/languages';
import { GlossPopover, type Tapped } from './Reader';
import { radius, useTheme } from './theme';
import type { SentenceGloss } from './useCardGlosses';

const DOT = 2;
const TICK_HEIGHT = 7;
// Room under the glyphs for the dots, so they sit clear of Thai's below-the-line vowels.
const UNDERLINE_SPACE = 5;
// How far a word's dots stop short of a tick, so a dot never runs into it.
const TICK_GAP = 4;

type Box = { y: number; width: number };

/**
 * A card's example sentence as words to tap, each opening the reader's popover (GlossPopover) with
 * its meaning, a play button, its pronunciation and Add to deck for a word not in the deck. Every
 * word is underlined with dots, and where two words touch (Thai, Japanese) a short tick rises from
 * the line between them, so the sentence shows where it splits. The card's own word keeps its
 * highlight. Tapping a word only shows it: nothing is graded or written (reader/cardGlosses.ts).
 */
export function CardSentence({ gloss, segments, style }: { gloss: SentenceGloss; segments?: Segment[]; style: TextStyle }) {
  const c = useTheme();
  const pieces = sentencePieces(gloss.words, segments);
  const breaks = wordBreaks(pieces);
  // Each word's place once laid out: a tick is left out at the end of a line, and the dots need its width.
  const [boxes, setBoxes] = useState<(Box | undefined)[]>([]);
  const [tapped, setTapped] = useState<(Tapped & { index: number }) | null>(null);
  const fontSize = style.fontSize ?? 17;
  const setBox = (i: number, box: Box) => setBoxes((prev) => {
    const old = prev[i];
    if (old && old.y === box.y && old.width === box.width) return prev;
    const next = [...prev];
    next[i] = box;
    return next;
  });

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      {pieces.map((piece, i) => {
        if (!piece.tappable) {
          // A space becomes a gap; punctuation is shown but can't be tapped.
          return piece.word.text.trim()
            ? <Text key={i} style={[style, { paddingBottom: UNDERLINE_SPACE }]}>{piece.word.text}</Text>
            : <View key={i} style={{ width: fontSize * 0.3 }} />;
        }
        const box = boxes[i];
        const next = boxes[i + 1];
        const tick = breaks[i] && !!box && !!next && Math.abs(next.y - box.y) < 1;
        const startsLine = i === 0 || !breaks[i - 1] || !box || !boxes[i - 1] || Math.abs((boxes[i - 1] as Box).y - box.y) >= 1;
        const left = startsLine ? 0 : TICK_GAP;
        const right = tick ? TICK_GAP : 0;
        const dotColor = piece.marked ? c.accent : c.textTertiary;
        const ringed = tapped?.index === i;
        return (
          <Pressable
            key={i}
            onLayout={(e) => setBox(i, { y: e.nativeEvent.layout.y, width: e.nativeEvent.layout.width })}
            onPress={(e) => setTapped({ word: piece.word, x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, index: i })}
            accessibilityRole="button"
            accessibilityLabel={piece.word.text}
            accessibilityHint="Shows what this word means"
            style={{ paddingBottom: UNDERLINE_SPACE, borderRadius: radius.s - 2, backgroundColor: ringed ? c.accentFill : undefined }}
          >
            {ringed ? (
              <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius.s - 2, borderWidth: 1.5, borderColor: c.accent }} />
            ) : null}
            <Text style={style}>
              {piece.parts.map((p, k) => (p.marked
                ? <Text key={k} style={{ color: c.accent, backgroundColor: c.accentFill, fontWeight: '600' }}>{p.text}</Text>
                : p.text))}
            </Text>
            {box ? dotOffsets(box.width - left - right, DOT).map((x, k) => (
              <View key={k} pointerEvents="none" style={{ position: 'absolute', bottom: 0, left: left + x, width: DOT, height: DOT, backgroundColor: dotColor }} />
            )) : null}
            {tick && box ? (
              // On a whole pixel: a line between two is drawn across both and looks wider than the rest.
              <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, left: PixelRatio.roundToNearestPixel(box.width - DOT / 2), width: DOT, height: TICK_HEIGHT, borderRadius: 1, backgroundColor: c.textTertiary }} />
            ) : null}
          </Pressable>
        );
      })}
      <GlossPopover
        tapped={tapped}
        translitLabel={LANGUAGES[gloss.language].translitLabel}
        grammar={null}
        api={gloss.api}
        grammarChosen={{}}
        onGrammarChosen={() => undefined}
        flagged={false}
        onToggleFlag={null}
        onPlay={() => { if (tapped) gloss.onPlayWord(tapped.word.text, gloss.language); }}
        onSelectPhrase={null}
        onAddToDeck={tapped && !tapped.word.deck && tapped.word.status !== 'name' ? () => {
          // The popover is a modal, so it closes before the note editor opens over the card.
          const { text, gloss: meaning } = tapped.word;
          setTapped(null);
          void gloss.onAddWord(text, meaning ?? '', gloss.language);
        } : null}
        onClose={() => setTapped(null)}
      />
    </View>
  );
}
