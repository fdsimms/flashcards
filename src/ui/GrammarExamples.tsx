import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { markedParts } from '../reader/grammar';
import { haptic } from './haptics';
import { Button, Card, Icon, Tappable } from './kit';
import { hairline, space, type, useTheme } from './theme';
import { PlayPill } from './PlayButton';
import { TranslationRow } from './TranslationRow';

/** One example as a tile shows it: the line, its translation, and where it's from. */
export interface ExampleTile {
  line: string;
  english: string;
  /** The parts of the line to underline. */
  words: string[];
  /** A text it came from, opened by a tap; or a plain label for a sentence that came from no text; or nothing to say. */
  source?: { title: string; onOpen: () => void } | { label: string };
  /** Plays the line aloud, shown as a play button beside it (a grammar lesson's examples). */
  onPlay?: () => void;
}

/**
 * A grammar page's example lines (docs/grammar.md, step 4): each its own tile with the line (the
 * point's words underlined), its translation behind a tap, and its source as a link (or a plain label).
 * The action (Shuffle, or More examples) sits under the tiles. A translation opened stays closed on new
 * lines, since a new `generation` gives every tile a new key.
 */
export function GrammarExamples({ examples, generation, action }: {
  examples: ExampleTile[];
  /** Changes whenever the examples are swapped for others. */
  generation: number;
  action?: { label: string; onPress: () => void; busy: boolean };
}) {
  return (
    <View style={{ gap: space.m }}>
      {examples.map((e, i) => (
        <Tile key={`${generation}:${i}`} example={e} />
      ))}
      {action ? <Button label={action.label} variant="secondary" onPress={action.onPress} busy={action.busy} /> : null}
    </View>
  );
}

function Tile({ example: e }: { example: ExampleTile }) {
  const c = useTheme();
  const [shown, setShown] = useState(false);
  const source = e.source;
  return (
    <Card style={{ gap: space.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        {e.onPlay ? <PlayPill label="Play this line" onPlay={e.onPlay} /> : null}
        <Text style={{ ...type.callout, color: c.text, lineHeight: 26, flex: 1 }}>
          {markedParts(e.line, e.words).map((part, j) => (part.marked
            ? <Text key={j} style={{ textDecorationLine: 'underline', textDecorationColor: c.accent }}>{part.text}</Text>
            : part.text))}
        </Text>
      </View>
      {shown ? (
        <TranslationRow>
          <Text style={{ ...type.subhead, color: c.textSecondary }}>{e.english}</Text>
        </TranslationRow>
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
      {!source ? null : 'title' in source ? (
        <Tappable
          onPress={() => { haptic.tap(); source.onOpen(); }}
          accessibilityRole="link"
          accessibilityLabel={`From ${source.title}. Open the text`}
          hitSlop={{ top: space.s, bottom: space.s }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingTop: space.s, borderTopWidth: hairline, borderTopColor: c.border, alignSelf: 'stretch' }}
        >
          <Text style={{ ...type.footnote, color: c.textSecondary }}>From</Text>
          <Text style={{ ...type.footnote, fontWeight: '600', color: c.accent, flexShrink: 1 }}>{source.title}</Text>
          <Icon name="chevron.right" size={11} color={c.accent} weight="semibold" />
        </Tappable>
      ) : (
        <View style={{ paddingTop: space.s, borderTopWidth: hairline, borderTopColor: c.border, alignSelf: 'stretch' }}>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>{source.label}</Text>
        </View>
      )}
    </Card>
  );
}
