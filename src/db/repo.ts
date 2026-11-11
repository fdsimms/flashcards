import type { Card, Note, ReviewLogEntry } from '../core/types';

export interface DeckSummary {
  deck: string;
  due: number;
  fresh: number;
  total: number;
}

export interface Repo {
  upsertNotesAndCards(notes: Note[], cards: Card[]): Promise<void>;
  listNotes(): Promise<Note[]>;
  getNote(id: string): Promise<Note | undefined>;
  listCards(deck?: string): Promise<Card[]>;
  saveCard(card: Card): Promise<void>;
  addReview(entry: ReviewLogEntry): Promise<void>;
  newIntroducedToday(deck: string, now: Date): Promise<number>;
}

/** Simple in-memory repo, used by tests and as a reference implementation. */
export class MemoryRepo implements Repo {
  notes = new Map<string, Note>();
  cards = new Map<string, Card>();
  reviews: ReviewLogEntry[] = [];

  async upsertNotesAndCards(notes: Note[], cards: Card[]) {
    for (const n of notes) this.notes.set(n.id, n);
    for (const c of cards) this.cards.set(c.id, c);
  }
  async listNotes() { return [...this.notes.values()]; }
  async getNote(id: string) { return this.notes.get(id); }
  async listCards(deck?: string) {
    const all = [...this.cards.values()];
    return deck ? all.filter((c) => this.notes.get(c.noteId)?.deck === deck) : all;
  }
  async saveCard(card: Card) { this.cards.set(card.id, card); }
  async addReview(entry: ReviewLogEntry) { this.reviews.push(entry); }
  async newIntroducedToday(deck: string, now: Date) {
    const day = now.toDateString();
    const firsts = new Set<string>();
    for (const r of this.reviews) {
      if (new Date(r.reviewedAt).toDateString() !== day) continue;
      if (r.state === 0 && this.notes.get(this.cards.get(r.cardId)?.noteId ?? '')?.deck === deck) firsts.add(r.cardId);
    }
    return firsts.size;
  }
}

export function summarizeDecks(notes: Note[], cards: Card[], newPerDay: number, now = new Date()): DeckSummary[] {
  const deckOf = new Map(notes.map((n) => [n.id, n.deck]));
  const map = new Map<string, DeckSummary>();
  for (const c of cards) {
    if (c.suspended) continue;
    const deck = deckOf.get(c.noteId) ?? 'Imported';
    const s = map.get(deck) ?? { deck, due: 0, fresh: 0, total: 0 };
    s.total++;
    if (c.sched.state === 0) s.fresh++;
    else if (new Date(c.sched.due) <= now) s.due++;
    map.set(deck, s);
  }
  for (const s of map.values()) s.fresh = Math.min(s.fresh, newPerDay);
  return [...map.values()].sort((a, b) => a.deck.localeCompare(b.deck));
}
