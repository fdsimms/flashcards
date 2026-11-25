import React, { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { setNewCardOrder } from '../anki/deckOrderService';
import { failureText } from '../core/failure';
import { NEW_CARD_ORDERS, newCardOrderNote, newCardOrderOf, type NewCardOrder } from '../core/newCardOrder';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { Group, Help, CheckRow, Section } from './kit';

/**
 * Deck options for where new cards go among reviews. It is the Anki preset's "New/review order",
 * written into the Anki collection (`setNewCardOrder`) so every device follows after sync, which
 * is why it also says how many other decks use the same preset. Nothing is shown for a deck with
 * no preset (a filtered deck).
 */
export function DeckNewCardOrder({ repo, deck }: { repo: Repo & AnkiLink; deck: string }) {
  const [order, setOrder] = useState<NewCardOrder>();
  const busy = useRef(false);
  const current = useRef(deck);
  current.current = deck;

  const load = async () => {
    const found = newCardOrderOf(deck, await repo.listDeckParams());
    // The screen can be left or reopened on another deck while the read is out.
    if (current.current === deck) setOrder(found);
  };
  useEffect(() => { setOrder(undefined); load().catch(() => setOrder(undefined)); }, [repo, deck]);

  const choose = async (mix: number) => {
    if (!order || order.mix === mix || busy.current) return;
    busy.current = true;
    try {
      await setNewCardOrder(repo, deck, mix);
      await load();
    } catch (e) {
      Alert.alert("Couldn't change the new card order", failureText(e, { next: 'Try again.' }));
    } finally {
      busy.current = false;
    }
  };

  if (!order) return null;
  return (
    <Section title="New cards" footer={<Help>{newCardOrderNote(order.sharedWith.length)}</Help>}>
      <Group accessibilityRole="radiogroup">
        {NEW_CARD_ORDERS.map((o, i) => (
          <CheckRow key={o.mix} first={i === 0} label={o.label} hint={o.hint} selected={order.mix === o.mix} onPress={() => choose(o.mix)} />
        ))}
      </Group>
    </Section>
  );
}
