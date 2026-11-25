import { htmlToText } from './html';
import { hasAspectLanguage } from './aspectCheck';
import type { Card, Note } from './types';
import { isNoForm } from './wordGrammar';

/**
 * A Russian or Polish aspect pair is two notes, one per verb, each holding the other in AspectPartner.
 * Nothing in the scheduler links them, so they would start on different days. The queue uses this to
 * introduce a pair together (`groupPartners`, `treeQueue`). It only changes which new cards are offered
 * and in what order, never a schedule: each card is still rated by the learner's own tap.
 */

/** A field's text as the learner reads it: no markup, one space between words, NFC. */
export function fieldText(value: string | undefined): string {
  return htmlToText(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Whether two verbs are the same word (case aside). */
export const sameVerb = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/**
 * Each pair note's partner, by note id, both ways: a note whose AspectPartner names the Entry of another
 * Russian or Polish note of its model. A partner that isn't in the collection, "-" (no partner), and a
 * verb that names itself pair with nothing. When two notes share an Entry, the first one found is the partner.
 */
export function aspectPartners(notes: Iterable<Note>): Map<string, string> {
  const all = [...notes].filter(hasAspectLanguage);
  // A pair is two verbs of one language: the key holds the model and the language with the verb.
  const keyOf = (n: Note, verb: string) => `${n.model}\u0000${fieldText(n.fields.Language).toLocaleLowerCase()}\u0000${verb.toLocaleLowerCase()}`;
  const byEntry = new Map<string, Note>();
  for (const n of all) {
    const key = keyOf(n, fieldText(n.fields.Entry));
    if (!byEntry.has(key)) byEntry.set(key, n);
  }
  const pairs = new Map<string, string>();
  for (const n of all) {
    const partner = fieldText(n.fields.AspectPartner);
    const word = fieldText(n.fields.Entry);
    if (!partner || isNoForm(partner) || !word || sameVerb(partner, word)) continue;
    const found = byEntry.get(keyOf(n, partner));
    if (!found || found.id === n.id) continue;
    if (!pairs.has(n.id)) pairs.set(n.id, found.id);
    if (!pairs.has(found.id)) pairs.set(found.id, n.id);
  }
  return pairs;
}

/** The card of `partnerNote` that pairs with `card`: the same kind. */
export function partnerCard(card: Card, partnerNote: string, cards: Iterable<Card>): Card | undefined {
  for (const c of cards) if (c.noteId === partnerNote && c.kind === card.kind) return c;
  return undefined;
}

/**
 * `cards` with each card's partner (same kind, also in the list) moved to follow it directly, the
 * partner taking the place of whichever of the two came first. Every other card keeps its order.
 * With `only`, just those cards are paired (the new cards, in a list that mixes in reviews).
 */
export function groupPartners(cards: Card[], partnerOf: Map<string, string>, only?: Set<string>): Card[] {
  if (!partnerOf.size) return cards;
  const byKey = new Map(cards.map((c) => [`${c.noteId}\u0000${c.kind}`, c]));
  const out: Card[] = [];
  const placed = new Set<string>();
  for (const c of cards) {
    if (placed.has(c.id)) continue;
    out.push(c);
    placed.add(c.id);
    const partner = partnerOf.get(c.noteId);
    const other = partner && (!only || only.has(c.id)) ? byKey.get(`${partner}\u0000${c.kind}`) : undefined;
    if (other && !placed.has(other.id) && (!only || only.has(other.id))) {
      out.push(other);
      placed.add(other.id);
    }
  }
  return out;
}
