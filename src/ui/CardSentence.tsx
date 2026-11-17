import React, { useState } from 'react';
import { PixelRatio, Pressable, Text, View, type TextStyle } from 'react-native';
import { furiganaRuns, hasRuby, shownRuns, type FuriganaSetting } from '../core/furigana';
import type { Segment } from '../core/highlight';
import { dotOffsets, sentencePieces, wordBreaks } from '../reader/cardGlosses';
import { LANGUAGES } from '../reader/languages';
import { GlossPopover, type Tapped } from './reader/Reader';
import { Ruby } from './Ruby';
import { radius, useTheme, smooth } from './theme';
import type { SentenceGloss } from './useCardGlosses';

const DOT = 2;
const TICK_HEIGHT = 7;
// Room under the glyphs for the dots, so they sit clear of Thai's below-the-line vowels.
const UNDERLINE_SPACE = 5;
// How far a word's dots stop short of a tick, so a dot never runs into it.
const TICK_GAP = 4;

type Box = { y: number; width: number };
type Laid = { y?: number; width?: number };

/**
 * A card's example sentence as words to tap, each opening the reader's popover (GlossPopover) with
 * its meaning, a play button, its pronunciation and Add to deck for a word not in the deck. Every
 * word is underlined with dots, and where two words touch (Thai, Japanese) a short tick rises from
 * the line between them, so the sentence shows where it splits. The card's own word keeps its
 * highlight. Tapping a word only shows it: nothing is graded or written (reader/cardGlosses.ts).
 */
export function CardSentence({ gloss, segments, style, furigana }: {
  gloss: SentenceGloss; segments?: Segment[]; style: TextStyle;
  /** The furigana setting, once the answer shows: each word's reading (its gloss's `translit`) over its kanji. */
  furigana?: FuriganaSetting;
}) {
  const c = useTheme();
  const pieces = sentencePieces(gloss.words, segments);
  const breaks = wordBreaks(pieces);
  // Each word's place once laid out: a tick is left out at the end of a line, and the dots need its width.
  // The y is the word's unit (it plus its trailing punctuation) and the width is the word's own.
  const [laid, setLaid] = useState<Laid[]>([]);
  const [tapped, setTapped] = useState<(Tapped & { index: number }) | null>(null);
  const fontSize = style.fontSize ?? 17;
  const lay = (i: number, patch: Laid) => setLaid((prev) => {
    const old = prev[i] ?? {};
    if (old.y === (patch.y ?? old.y) && old.width === (patch.width ?? old.width)) return prev;
    const next = [...prev];
    next[i] = { ...old, ...patch };
    return next;
  });
  const boxes: (Box | undefined)[] = pieces.map((_, i) => {
    const l = laid[i];
    return l && l.y !== undefined && l.width !== undefined ? { y: l.y, width: l.width } : undefined;
  });

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      {pieces.flatMap((piece, i) => {
        if (!piece.tappable) {
          // A space becomes a gap; punctuation after a word is drawn with it, below.
          if (piece.word.text.trim()) {
            let j = i;
            while (j > 0 && !pieces[j - 1].tappable && pieces[j - 1].word.text.trim()) j--;
            if (j > 0 && pieces[j - 1].tappable) return [];
            return [<Text key={i} style={[style, { paddingBottom: UNDERLINE_SPACE }]}>{piece.word.text}</Text>];
          }
          return [<View key={i} style={{ width: fontSize * 0.3 }} />];
        }
        // Punctuation right after the word stays on its line: it wraps with the word, never alone.
        const trailing: { index: number; text: string }[] = [];
        for (let j = i + 1; j < pieces.length && !pieces[j].tappable && pieces[j].word.text.trim(); j++) {
          trailing.push({ index: j, text: pieces[j].word.text });
        }
        const box = boxes[i];
        const next = boxes[i + 1];
        const tick = breaks[i] && !!box && !!next && Math.abs(next.y - box.y) < 1;
        const startsLine = i === 0 || !breaks[i - 1] || !box || !boxes[i - 1] || Math.abs((boxes[i - 1] as Box).y - box.y) >= 1;
        const left = startsLine ? 0 : TICK_GAP;
        const right = tick ? TICK_GAP : 0;
        const dotColor = piece.marked ? c.accent : c.textTertiary;
        const ringed = tapped?.index === i;
        return [(
          <View key={i} onLayout={(e) => lay(i, { y: e.nativeEvent.layout.y })} style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <Pressable
              onLayout={(e) => lay(i, { width: e.nativeEvent.layout.width })}
              onPress={(e) => setTapped({ word: piece.word, x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, index: i })}
              accessibilityRole="button"
              accessibilityLabel={piece.word.text}
              accessibilityHint="Shows what this word means"
              style={{ paddingBottom: UNDERLINE_SPACE, borderRadius: radius.s - 2, ...smooth, backgroundColor: ringed ? c.accentFill : undefined }}
            >
              {ringed ? (
                <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius.s - 2, ...smooth, borderWidth: 1.5, borderColor: c.accent }} />
              ) : null}
              {(() => {
                // With furigana, a word with a reading over it is drawn as runs; the card's own word keeps its highlight.
                const runs = furigana && gloss.language === 'ja' && piece.word.translit
                  ? shownRuns(furiganaRuns(piece.word.text, piece.word.translit, furigana.readings), furigana.mode, furigana.learned, piece.word.text, piece.word.lemma ?? undefined)
                  : null;
                if (runs && hasRuby(runs)) {
                  const marked = piece.parts.some((p) => p.marked);
                  return <Ruby runs={runs} style={{ ...style, ...(marked ? { color: c.accentInk, backgroundColor: c.accentFill, fontWeight: '600' } : {}) }} rubyColor={c.textSecondary} />;
                }
                return (
                  <Text style={style}>
                    {piece.parts.map((p, k) => (p.marked
                      ? <Text key={k} style={{ color: c.accentInk, backgroundColor: c.accentFill, fontWeight: '600' }}>{p.text}</Text>
                      : p.text))}
                  </Text>
                );
              })()}
              {box ? dotOffsets(box.width - left - right, DOT).map((x, k) => (
                <View key={k} pointerEvents="none" style={{ position: 'absolute', bottom: 0, left: left + x, width: DOT, height: DOT, backgroundColor: dotColor }} />
              )) : null}
              {tick && box ? (
                // On a whole pixel: a line between two is drawn across both and looks wider than the rest.
                <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, left: PixelRatio.roundToNearestPixel(box.width - DOT / 2), width: DOT, height: TICK_HEIGHT, borderRadius: 1, backgroundColor: c.textTertiary }} />
              ) : null}
            </Pressable>
            {trailing.map((t) => (
              <Text key={t.index} style={[style, { paddingBottom: UNDERLINE_SPACE }]}>{t.text}</Text>
            ))}
          </View>
        )];
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
          const pronunciation = { ipa: tapped.word.ipa, ipa_source: tapped.word.ipa_source, translit: tapped.word.translit };
          setTapped(null);
          void gloss.onAddWord(text, meaning ?? '', gloss.language, pronunciation);
        } : null}
        onClose={() => setTapped(null)}
      />
    </View>
  );
}
