import { useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { studyDayStart } from '../core/day';
import {
  formsOf, formsSettings, formsSuggestion, headword, introductions, NEW_WORD_DAYS,
  type DrillRequest, type FormsSuggestion, type PracticeRecord,
} from '../core/forms';
import { heldCards, lookalikeIndex, lookalikeSettings, seenEvents, soonerOffer, whenSeen, type SeenEvent } from '../core/lookalikes';
import { heldReverseCards } from '../core/reverseHold';
import type { Card, DeckSettings, Note, ReviewLogEntry } from '../core/types';
import type { Repo } from '../db/repo';
import { haptic } from './haptics';
import { Button, Card as Box, Help } from './kit';
import { MIN_TAP, space, type, useTheme } from './theme';

/**
 * Review's forms practice and lookalikes, kept beside Review rather than inside it: practice and
 * the last week's answers (loaded again whenever Review comes back into view, as after a drill),
 * the cards held back because a lookalike was just seen, the offer to show a card sooner, the
 * and the suggestion to practice a word's forms.
 */
export function useReviewForms(repo: Repo, input: {
  cards: Card[] | null;
  notes: Map<string, Note>;
  deckSettings: Map<string, DeckSettings>;
  now: Date;
  dayStartsAtHour: number;
  /**
   * Just after an answer, while Review shows the next card from the queue as it was: the held cards
   * stay as they were, and are worked out again, over every card, once that card is on screen.
   */
  settling: boolean;
}) {
  const { cards, notes, deckSettings, now, dayStartsAtHour: H, settling } = input;
  // The card on screen and whether its answer is shown are set by `showing`, once Review knows them:
  // the held cards decide which card that is, so they can't be inputs here.
  const [shown, setShown] = useState<{ card?: Card; note?: Note; revealed: boolean }>({ revealed: false });
  const [practice, setPractice] = useState<PracticeRecord[]>([]);
  const [recent, setRecent] = useState<ReviewLogEntry[]>([]);
  // Put off with "Later today", and the cards whose "Show sooner" was turned off.
  const [later, setLater] = useState<Set<string>>(new Set());
  const [notSooner, setNotSooner] = useState<Set<string>>(new Set());

  useFocusEffect(useCallback(() => {
    const since = studyDayStart(new Date(), H);
    since.setDate(since.getDate() - NEW_WORD_DAYS);
    Promise.all([repo.listPractice(), repo.listReviews(since)]).then(([p, r]) => { setPractice(p); setRecent(r); });
  }, [repo, H]));

  const deckOf = useMemo(() => new Map([...notes.values()].map((n) => [n.id, n.deck])), [notes]);
  const noteOfCard = useMemo(() => new Map((cards ?? []).map((c) => [c.id, c.noteId])), [cards]);
  const index = useMemo(() => lookalikeIndex([...notes.values()]), [notes]);
  const seen = useMemo(() => seenEvents(recent, noteOfCard, practice), [recent, noteOfCard, practice]);
  const introduced = useMemo(() => introductions(recent, noteOfCard), [recent, noteOfCard]);
  // The deck list holds back the same cards (`loadHeld`), so its counts match what opens here.
  const lastHeld = useRef<Set<string> | undefined>(undefined);
  const held = useMemo(() => {
    if (settling && lastHeld.current) return lastHeld.current;
    // With them, a new reverse card whose word isn't recognized yet (`heldReverseCards`), as `loadHeld` holds it.
    lastHeld.current = cards ? new Set([...heldCards({ cards, deckOf, index, events: seen, settings: deckSettings, now, dayStartsAtHour: H }), ...heldReverseCards(cards, notes.values())]) : undefined;
    return lastHeld.current;
  }, [cards, deckOf, index, seen, deckSettings, now, H, settling]);

  const { card, note, revealed } = shown;
  // The lookalike that may have given this card's answer away, once it's shown (`soonerOffer`).
  const look = note ? lookalikeSettings(note.deck, deckSettings) : undefined;
  const offer = card && revealed && look?.offerSooner
    ? soonerOffer({ card, index, events: seen, now, dayStartsAtHour: H, heldDays: look.keepApart ? look.days : undefined })
    : undefined;
  // The suggestion to practice this word's forms, once its answer is shown.
  const suggestion = useMemo(() => {
    if (!note || !revealed || later.has(note.id) || !formsSettings(note.deck, deckSettings).suggest) return undefined;
    return formsSuggestion({
      note, forms: formsOf(note).forms, history: practice.filter((p) => p.noteId === note.id),
      introducedAt: introduced.get(note.id), now, dayStartsAtHour: H,
    });
  }, [note, revealed, later, deckSettings, practice, introduced, now, H]);
  const soonerOn = !!card && !notSooner.has(card.id);

  return {
    held,
    /** Tells the hook which card is on screen, and whether its answer is shown. */
    showing: useCallback((next: { card?: Card; note?: Note; revealed: boolean }) => {
      setShown((prev) => (prev.card === next.card && prev.note === next.note && prev.revealed === next.revealed ? prev : next));
    }, []),
    offer,
    /** Schedule the answer from when the lookalike was seen, unless that's been turned off for this card. */
    countFrom: offer && soonerOn ? offer.at : undefined,
    soonerOn,
    suggestion,
    /** A seen word for lookalikes: called after each answer is written. */
    answered: (entry: ReviewLogEntry) => setRecent((r) => [...r, entry]),
    /**
     * Whether `entry`, once `answered`, holds `card` back, as `held` will once the queue is rebuilt: as a
     * lookalike of the word just answered (`heldCards` for that one card), or as a reverse card whose
     * forward card the answer put back in progress (`heldReverseCards`, over `cards` as the answer left
     * them, `changed`). So Review can tell whether the queue rebuilt after an answer will have it.
     */
    holdsAfter: (entry: ReviewLogEntry, when: Date, changed: readonly Card[]) => {
      const events = seenEvents([...recent, entry], noteOfCard, practice);
      const now = new Map(changed.map((c) => [c.id, c]));
      const reverse = heldReverseCards((cards ?? []).map((c) => now.get(c.id) ?? c), notes.values());
      return (card: Card) => reverse.has(card.id) || heldCards({ cards: [card], deckOf, index, events, settings: deckSettings, now: when, dayStartsAtHour: H }).size > 0;
    },
    /** An answer taken back: it no longer counts as seeing the word. */
    undone: (cardId: string) => setRecent((r) => {
      const i = r.map((x) => x.cardId).lastIndexOf(cardId);
      return i < 0 ? r : [...r.slice(0, i), ...r.slice(i + 1)];
    }),
    putOff: (noteId: string) => setLater((l) => new Set(l).add(noteId)),
    setSooner: (on: boolean) => {
      if (!card) return;
      setNotSooner((s) => { const out = new Set(s); if (on) out.delete(card.id); else out.add(card.id); return out; });
    },
    /** The drill for one word. */
    drillFor: (noteId: string, deck: string): DrillRequest => ({
      kind: 'words', noteIds: [noteId], perWord: formsSettings(deck, deckSettings).prompts,
    }),
    /**
     * What `AnswerExtras` shows about the offer. `goodIn` is when Good would bring the card back,
     * counted from `from` (the lookalike) or, without it, from the card's last review.
     */
    offerView: (goodIn: (from?: Date) => string) => {
      const word = offer ? notes.get(offer.noteId) : undefined;
      if (!offer || !word) return undefined;
      const soonerGood = goodIn(offer.at), plainGood = goodIn(undefined);
      // "8d, not 8d" offers nothing: leave it out when the interval wouldn't change.
      if (soonerGood === plainGood) return undefined;
      return { how: offer.how, word: headword(word), when: whenSeen(offer.at, now, H), on: soonerOn, soonerGood, plainGood };
    },
  };
}

/**
 * Under a card's answer: the offer to show it again sooner when a lookalike may have given it
 * away, and the suggestion to practice its word's forms.
 */
export function AnswerExtras(props: {
  word: string;
  offer?: { how: SeenEvent['how']; word: string; when: string; on: boolean; soonerGood: string; plainGood: string };
  onSooner: (on: boolean) => void;
  suggestion?: FormsSuggestion;
  onPractice: () => void;
  onLater: () => void;
}) {
  const c = useTheme();
  const { offer, suggestion } = props;
  if (!offer && !suggestion) return null;
  return (
    <View style={{ gap: space.m }}>
      {offer ? (
        <Box>
          <View style={{ gap: space.xs }}>
            <Text style={{ ...type.headline, color: c.text }}>
              {offer.how === 'practice' ? `You practiced ${offer.word}'s forms ${offer.when}` : `You saw ${offer.word} ${offer.when}`}
            </Text>
            <Help>{`It looks a lot like ${props.word}, which may have given the answer away.`}</Help>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...type.body, color: c.text }}>Show this card again sooner</Text>
              <Text style={{ ...type.footnote, color: c.textSecondary }}>{`Good brings it back in ${offer.soonerGood}, not ${offer.plainGood}`}</Text>
            </View>
            <Switch value={offer.on} onValueChange={(on) => { haptic.select(); props.onSooner(on); }} trackColor={{ true: c.accent, false: c.border }} ios_backgroundColor={c.border} accessibilityLabel="Show this card again sooner" />
          </View>
        </Box>
      ) : null}
      {suggestion ? (
        <Box>
          <View style={{ gap: space.xs }}>
            <Text style={{ ...type.headline, color: c.text }}>{suggestion.title}</Text>
            <Help>{suggestion.detail}</Help>
          </View>
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Button label="Practice (1 min)" style={{ flex: 1, minHeight: MIN_TAP }} onPress={props.onPractice} />
            <Button label="Later today" variant="secondary" style={{ flex: 1, minHeight: MIN_TAP }} onPress={props.onLater} />
          </View>
        </Box>
      ) : null}
    </View>
  );
}
