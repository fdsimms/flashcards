import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { GrammarExample } from '../reader/api';
import { markedParts } from '../reader/grammar';
import { haptic } from './haptics';
import { Button, Card, Icon, Tappable } from './kit';
import { hairline, space, type, useTheme } from './theme';

/**
 * A grammar point's example lines (docs/grammar.md, step 4): each its own tile with the line (the
 * point's words underlined), its translation behind a tap, and the text it came from as a link. Shuffle
 * sits under the tiles and swaps them all; a translation opened stays closed on the new lines, since a
 * new `generation` gives every tile a new key.
 */
export function GrammarExamples({ examples, generation, canShuffle, shuffling, onShuffle, onOpenText }: {
  examples: GrammarExample[];
  /** Changes whenever the examples are swapped for others. */
  generation: number;
  canShuffle: boolean;
  shuffling: boolean;
  onShuffle: () => void;
  onOpenText: (example: GrammarExample) => void;
}) {
  return (
    <View style={{ gap: space.m }}>
      {examples.map((e, i) => (
        <ExampleTile key={`${generation}:${i}`} example={e} onOpenText={onOpenText} />
      ))}
      {canShuffle ? <Button label="Shuffle" variant="secondary" onPress={onShuffle} busy={shuffling} /> : null}
    </View>
  );
}

function ExampleTile({ example: e, onOpenText }: { example: GrammarExample; onOpenText: (example: GrammarExample) => void }) {
  const c = useTheme();
  const [shown, setShown] = useState(false);
  return (
    <Card style={{ gap: space.m }}>
      <Text style={{ ...type.callout, color: c.text, lineHeight: 26 }}>
        {markedParts(e.line, e.words).map((part, j) => (part.marked
          ? <Text key={j} style={{ textDecorationLine: 'underline', textDecorationColor: c.accent }}>{part.text}</Text>
          : part.text))}
      </Text>
      {shown ? (
        <Text style={{ ...type.subhead, color: c.textSecondary }}>{e.english}</Text>
      ) : (
        <Tappable
          onPress={() => { haptic.tap(); setShown(true); }}
          accessibilityRole="button"
          accessibilityLabel="Show translation"
          hitSlop={{ top: space.s, bottom: space.s }}
          style={{ alignSelf: 'flex-start' }}
        >
          <Text style={{ ...type.subhead, color: c.accent }}>Show translation</Text>
        </Tappable>
      )}
      <Tappable
        onPress={() => { haptic.tap(); onOpenText(e); }}
        accessibilityRole="link"
        accessibilityLabel={`From ${e.title}. Open the text`}
        hitSlop={{ top: space.s, bottom: space.s }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingTop: space.s, borderTopWidth: hairline, borderTopColor: c.border, alignSelf: 'stretch' }}
      >
        <Text style={{ ...type.footnote, color: c.textSecondary }}>From</Text>
        <Text style={{ ...type.footnote, fontWeight: '600', color: c.accent, flexShrink: 1 }}>{e.title}</Text>
        <Icon name="chevron.right" size={11} color={c.accent} weight="semibold" />
      </Tappable>
    </Card>
  );
}
