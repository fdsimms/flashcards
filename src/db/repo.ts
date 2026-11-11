import { studyDayStart } from '../core/day';
import { buildQueue } from '../core/queue';
import type { Card, DeckParams, Note, ReviewLogEntry } from '../core/types';

export interface DeckSummary {
  deck: string;
  due: number;
  fresh: number;
  total: number;
}

export interface Repo {
  /**
   * Writes imported notes and their cards. A card already studied keeps its scheduling and
   * suspension; only a card still New is overwritten. `cards` must hold every card each note
   * generates now: an existing card of one of these notes that isn't in it is retired, and one
   * that is comes back.
   */
  upsertNotesAndCards(notes: Note[], cards: Card[]): Promise<void>;
  listNotes(): Promise<Note[]>;
  getNote(id: string): Promise<Note | undefined>;
  listCards(deck?: string): Promise<Card[]>;
  saveCard(card: Card): Promise<void>;
  addReview(entry: ReviewLogEntry): Promise<void>;
  /** New cards first answered in `deck` during the study day `now` falls in. */
  newIntroducedToday(deck: string, now: Date, dayStartsAtHour: number): Promise<number>;
  /** Replaces the FSRS settings of the decks given; other decks keep theirs. */
  saveDeckParams(params: Map<string, DeckParams>): Promise<void>;
  listDeckParams(): Promise<Map<string, DeckParams>>;
}

/** Simple in-memory repo, used by tests and as a reference implementation. */
export class MemoryRepo implements Repo {
  notes = new Map<string, Note>();
  cards = new Map<string, Card>();
  reviews: ReviewLogEntry[] = [];
  deckParams = new Map<string, DeckParams>();

  async upsertNotesAndCards(notes: Note[], cards: Card[]) {
    for (const n of notes) this.notes.set(n.id, n);
    const incoming = new Set(cards.map((c) => c.id));
    const noteIds = new Set(notes.map((n) => n.id));
    for (const [id, c] of this.cards) {
      if (noteIds.has(c.noteId) && !incoming.has(id)) this.cards.set(id, { ...c, retired: true });
    }
    for (const c of cards) {
      // Same rule as the SQLite repo: re-importing never resets a card already studied here.
      const existing = this.cards.get(c.id);
      if (existing && existing.sched.state !== 0) {
        this.cards.set(c.id, { ...existing, retired: false });
        continue;
      }
      this.cards.set(c.id, { ...c, retired: false });
    }
  }
  async listNotes() { return [...this.notes.values()]; }
  async getNote(id: string) { return this.notes.get(id); }
  async listCards(deck?: string) {
    const all = [...this.cards.values()];
    return deck ? all.filter((c) => this.notes.get(c.noteId)?.deck === deck) : all;
  }
  async saveCard(card: Card) { this.cards.set(card.id, card); }
  async addReview(entry: ReviewLogEntry) { this.reviews.push(entry); }
  async newIntroducedToday(deck: string, now: Date, dayStartsAtHour: number) {
    const start = studyDayStart(now, dayStartsAtHour).getTime();
    const firsts = new Set<string>();
    for (const r of this.reviews) {
      if (new Date(r.reviewedAt).getTime() < start) continue;
      if (r.state === 0 && this.notes.get(this.cards.get(r.cardId)?.noteId ?? '')?.deck === deck) firsts.add(r.cardId);
    }
    return firsts.size;
  }
  async saveDeckParams(params: Map<string, DeckParams>) {
    for (const [deck, p] of params) this.deckParams.set(deck, p);
  }
  async listDeckParams() { return new Map(this.deckParams); }
}

export interface SummaryOptions {
  newPerDay: number;
  dayStartsAtHour: number;
  learnAheadMinutes?: number;
  /** New cards already introduced this study day, by deck. A deck missing from it has had none. */
  introducedByDeck?: Map<string, number>;
  now?: Date;
}

/**
 * Per-deck counts for the deck list, built on `buildQueue` so they match what opening the deck
 * shows: the same due rule and the same new-card budget, after what was introduced today.
 */
export function summarizeDecks(notes: Note[], cards: Card[], opts: SummaryOptions): DeckSummary[] {
  const deckOf = new Map(notes.map((n) => [n.id, n.deck]));
  const byDeck = new Map<string, Card[]>();
  for (const c of cards) {
    if (c.suspended || c.retired) continue;
    const deck = deckOf.get(c.noteId) ?? 'Imported';
    (byDeck.get(deck) ?? byDeck.set(deck, []).get(deck)!).push(c);
  }
  const out: DeckSummary[] = [];
  for (const [deck, deckCards] of byDeck) {
    const q = buildQueue(deckCards, {
      newPerDay: opts.newPerDay,
      newIntroducedToday: opts.introducedByDeck?.get(deck) ?? 0,
      dayStartsAtHour: opts.dayStartsAtHour,
      learnAheadMinutes: opts.learnAheadMinutes,
      now: opts.now,
    });
    out.push({ deck, due: q.due.length, fresh: q.fresh.length, total: deckCards.length });
  }
  return out.sort((a, b) => a.deck.localeCompare(b.deck));
}
