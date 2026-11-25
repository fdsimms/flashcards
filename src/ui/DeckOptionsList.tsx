import React from 'react';
import { ScrollView } from 'react-native';
import type { DeckNode } from '../core/deckTree';
import { Group, Help, Loading, NavRow, Screen, Section } from './kit';
import { space, readable } from './theme';

/**
 * Every deck, in the deck list's order with subdecks under their parents, each opening its Deck
 * options: the way to a deck's settings (Skill cards, cards in progress, fonts) from Settings,
 * besides Options on the deck's own menu.
 */
export function DeckOptionsList({ decks, loaded, onOpen }: {
  decks: readonly DeckNode[];
  /** Whether the decks have been read once: an empty list before then isn't "no decks". */
  loaded: boolean;
  onOpen: (deck: string) => void;
}) {
  return (
    <Screen title="Deck options">
      {!decks.length && !loaded ? <Loading /> : (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
          <Section footer={decks.length ? <Help>Each opens the same options as Options on the deck's own menu.</Help> : undefined}>
            {decks.length ? (
              <Group>
                {decks.map((d, i) => <NavRow key={d.deck} first={i === 0} indent={d.depth} label={d.name} onPress={() => onOpen(d.deck)} />)}
              </Group>
            ) : <Help>No decks yet. Import a deck or sync with Anki, and its options will be here.</Help>}
          </Section>
        </ScrollView>
      )}
    </Screen>
  );
}
