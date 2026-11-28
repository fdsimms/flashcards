import React from 'react';
import { Text, View } from 'react-native';
import type { ContrastRow } from '../core/senseContrast';
import { hasThai, thaiTextStyle, type ThaiTextSize } from '../core/script';
import { CloseButton, TextButton } from './kit';
import { MIN_TAP, hairline, radius, smooth, space, type, useTheme } from './theme';

/** What the box's rows do, from `useSenseContrast`. Without it the pairs are shown as text only (a cram round). */
export interface ContrastActions {
  rows: ContrastRow[];
  onAdd: (row: ContrastRow) => void;
  onRemove: (row: ContrastRow) => void;
  onOpen: (noteId: string) => void;
}

/**
 * "Not this word", under an answer's Sense: the word for each English sense the card's word doesn't
 * cover ("rain shower: aguacero"). A word that isn't a note yet has Add and an x that removes it from
 * the note for good; one waiting in the note queue says Added; one already in the deck is a link to
 * its note, with neither.
 */
export function SenseContrastBox({ pairs, actions, thaiSize }: { pairs: { label: string; value: string }[]; actions?: ContrastActions; thaiSize: ThaiTextSize }) {
  const c = useTheme();
  // The rows the hook worked out, once it has them: until then (and with no hook) the pairs as written.
  const rows: (ContrastRow | { sense: string; word: string; state: 'plain' })[] = actions?.rows.length
    ? actions.rows
    : pairs.map((p) => ({ sense: p.label, word: p.value, state: 'plain' as const }));
  const wordStyle = (word: string) => ({ ...(hasThai(word) ? thaiTextStyle(thaiSize) : { ...type.subhead, lineHeight: 21 }), fontWeight: '600' as const });
  return (
    <View style={{ alignSelf: 'center', maxWidth: '100%', backgroundColor: c.fill, borderRadius: radius.m, ...smooth, borderWidth: hairline, borderColor: c.border, paddingLeft: space.m, paddingRight: space.xs }}>
      {rows.map((row, k) => (
        <View key={`${row.sense}:${row.word}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: MIN_TAP, borderTopWidth: k ? hairline : 0, borderTopColor: c.border }}>
          <Text style={{ ...type.subhead, lineHeight: 21, color: c.textBody, flexShrink: 1, paddingVertical: space.s, paddingRight: row.state === 'new' ? 0 : space.s }}>
            {row.sense}:{' '}
            {row.state === 'inDeck' && actions ? (
              <Text accessibilityRole="link" accessibilityLabel={`${row.word}, in your deck. Open its note`} onPress={() => actions.onOpen(row.noteId)} style={{ ...wordStyle(row.word), color: c.accentInk }}>{row.word}</Text>
            ) : (
              <Text style={{ ...wordStyle(row.word), color: c.text }}>{row.word}</Text>
            )}
          </Text>
          {row.state === 'queued' ? <Text style={{ ...type.subhead, fontWeight: '600', color: c.goodInk, paddingRight: space.s }}>Added</Text> : null}
          {row.state === 'new' && actions ? (
            <>
              <TextButton label="Add" accessibilityLabel={`Add ${row.word} to your deck`} onPress={() => actions.onAdd(row)} style={{ paddingHorizontal: space.s }} />
              <CloseButton label={`Remove ${row.word} from this card`} onPress={() => actions.onRemove(row)} />
            </>
          ) : null}
        </View>
      ))}
    </View>
  );
}
