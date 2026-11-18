import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { Word } from '../../reader/api';
import { inDeck, meaningOf } from '../../reader/languages';
import { haptic } from '../haptics';
import { Icon, Tappable } from '../kit';
import { hairline, lift, radius, smooth, space, type, useTheme } from '../theme';
import { RegisterChip } from './ReaderNatural';

/**
 * The small notes the gloss popover keeps out of its text: a tooltip that opens on a tap (where a
 * word's IPA is from), and the meaning's line, which carries the word's register and an icon for
 * a word that's in the deck.
 */

const TIP_MS = 3500;

/** A tooltip's open state: it opens on a tap, closes on the next, and after a few seconds. */
export function useTip() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setOpen(false), TIP_MS);
    return () => clearTimeout(t);
  }, [open]);
  return { open, toggle: () => { haptic.tap(); setOpen((o) => !o); } };
}

/**
 * A tooltip's bubble, drawn over its parent (which has to be a box the bubble can hang off, with
 * nothing clipped) so nothing in the popover moves. `x` is where the thing it explains starts in
 * the parent. Above by default, below when there's no room above.
 */
export function TipBubble({ text, x, below, warn = false }: { text: string; x: number; below: boolean; warn?: boolean }) {
  const c = useTheme();
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute', left: Math.max(0, x - space.s), right: 0, alignItems: 'flex-start', zIndex: 2,
        ...(below ? { top: '100%', marginTop: space.xs } : { bottom: '100%', marginBottom: space.xs }),
      }}
    >
      <View style={{ backgroundColor: c.raised, borderColor: c.raisedEdge, borderWidth: hairline, borderRadius: radius.s, paddingHorizontal: space.m, paddingVertical: space.s, ...smooth, ...lift(c, 'high') }}>
        <Text style={{ ...type.footnote, color: warn ? c.warningInk : c.text }}>{text}</Text>
      </View>
    </View>
  );
}

/** A stack of cards with a check on it: the word's note is in the deck. SF Symbols has no such symbol, so it's two. */
function DeckMark({ onPress }: { onPress: () => void }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="In your deck"
      accessibilityHint="Shows what this icon means"
      style={{ width: 24, height: 22, justifyContent: 'center' }}
    >
      <Icon name="rectangle.stack" size={19} color={c.goodInk} weight="medium" />
      <View style={{ position: 'absolute', right: 0, bottom: 0, backgroundColor: c.surface, borderRadius: radius.pill }}>
        <Icon name="checkmark.circle.fill" size={11} color={c.goodInk} weight="bold" />
      </View>
    </Tappable>
  );
}

/**
 * The popover's meaning with the word's register beside it and, for a word in the deck, the deck
 * icon. The chip and icon wrap under a long meaning together. `meaning` replaces the gloss's text
 * (the quiz choices on a word that was held back).
 */
export function ReadGlossLine({ word, below, meaning }: { word: Word; below: boolean; meaning?: React.ReactNode }) {
  const c = useTheme();
  const tip = useTip();
  const [markX, setMarkX] = useState(0);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.s, rowGap: space.xs }}>
      {meaning ?? <Text style={{ ...type.body, color: c.text, flexShrink: 1 }}>{meaningOf(word)}</Text>}
      <RegisterChip register={word.register} inline />
      {inDeck(word) ? (
        <View onLayout={(e) => setMarkX(e.nativeEvent.layout.x)}>
          <DeckMark onPress={tip.toggle} />
        </View>
      ) : null}
      {tip.open ? <TipBubble text="In your deck" x={markX} below={below} /> : null}
    </View>
  );
}
