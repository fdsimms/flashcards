import { isInDeck } from '../core/deckTree';
import { parseAnswerButtons, type AnswerButtons } from '../core/answerButtons';
import type { Card, DeckParams, DeckSettings, Note, NoteType, ReviewLogEntry } from '../core/types';

export interface Repo {
  /**
   * Writes imported notes and their cards. A card already studied keeps its scheduling and
   * suspension; only a card still New is overwritten. `cards` must hold every card each note
   * generates now: an existing card of one of these notes that isn't in it is retired, and one
   * that is comes back.
   */
  upsertNotesAndCards(notes: Note[], cards: Card[]): Promise<void>;
  /**
   * Takes in a whole Anki collection, which is the record: every card in it gets Anki's
   * scheduling and suspension, studied here or not, and a card that came from Anki (has an
   * `ankiId`) but isn't in it any more is retired. Cards that didn't come from Anki are left alone.
   */
  applyAnkiCollection(notes: Note[], cards: Card[]): Promise<void>;
  listNotes(): Promise<Note[]>;
  /** Removes a note with its cards and their logged answers. */
  deleteNote(id: string): Promise<void>;
  getNote(id: string): Promise<Note | undefined>;
  /** Every card, or the cards of `deck` and all its subdecks. */
  listCards(deck?: string): Promise<Card[]>;
  saveCard(card: Card): Promise<void>;
  /** Logs an answer and returns its id, which `deleteReview` takes to undo it. */
  addReview(entry: ReviewLogEntry): Promise<number>;
  deleteReview(id: number): Promise<void>;
  /** Answers logged here at or after `since`, oldest first (for stats). */
  listReviews(since: Date): Promise<ReviewLogEntry[]>;
  /** Replaces the FSRS settings of the decks given; other decks keep theirs. */
  saveDeckParams(params: Map<string, DeckParams>): Promise<void>;
  listDeckParams(): Promise<Map<string, DeckParams>>;
  /** Replaces the note types given, by name; others are kept. */
  saveNoteTypes(types: NoteType[]): Promise<void>;
  listNoteTypes(): Promise<Map<string, NoteType>>;
  /** Settings made in the app, by deck. An import never touches these. */
  listDeckSettings(): Promise<Map<string, DeckSettings>>;
  saveDeckSettings(deck: string, settings: DeckSettings): Promise<void>;
  /** Which answer buttons Review shows, for every deck. This phone's own: a backup doesn't carry it. */
  answerButtons(): Promise<AnswerButtons>;
  saveAnswerButtons(choice: AnswerButtons): Promise<void>;
  /** Whether a revealed card can be swiped to answer it (right Good, left Again). Off by default; this phone's own. */
  swipeToRate(): Promise<boolean>;
  saveSwipeToRate(on: boolean): Promise<void>;
}

/** Simple in-memory repo, used by tests and as a reference implementation. */
export class MemoryRepo implements Repo {
  notes = new Map<string, Note>();
  cards = new Map<string, Card>();
  reviews = new Map<number, ReviewLogEntry>();
  private nextReviewId = 1;
  deckParams = new Map<string, DeckParams>();
  noteTypes = new Map<string, NoteType>();
  deckSettings = new Map<string, DeckSettings>();
  answerButtonsSetting: string | null = null;
  swipeToRateSetting = false;

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
        this.cards.set(c.id, { ...existing, retired: false, buriedAt: c.buriedAt });
        continue;
      }
      this.cards.set(c.id, { ...c, retired: false });
    }
  }
  async applyAnkiCollection(notes: Note[], cards: Card[]) {
    for (const n of notes) this.notes.set(n.id, n);
    const incoming = new Set(cards.map((c) => c.id));
    for (const [id, c] of this.cards) {
      if (c.ankiId && !incoming.has(id)) this.cards.set(id, { ...c, retired: true });
    }
    for (const c of cards) this.cards.set(c.id, { ...c, retired: false });
  }
  async listNotes() { return [...this.notes.values()]; }
  async deleteNote(id: string) {
    this.notes.delete(id);
    const cardIds = new Set([...this.cards.values()].filter((c) => c.noteId === id).map((c) => c.id));
    for (const cid of cardIds) this.cards.delete(cid);
    for (const [rid, r] of this.reviews) if (cardIds.has(r.cardId)) this.reviews.delete(rid);
  }
  async getNote(id: string) { return this.notes.get(id); }
  async listCards(deck?: string) {
    const all = [...this.cards.values()];
    return deck ? all.filter((c) => isInDeck(this.notes.get(c.noteId)?.deck ?? '', deck)) : all;
  }
  async saveCard(card: Card) { this.cards.set(card.id, card); }
  async addReview(entry: ReviewLogEntry) {
    const id = this.nextReviewId++;
    this.reviews.set(id, entry);
    return id;
  }
  async deleteReview(id: number) { this.reviews.delete(id); }
  async answerButtons() { return parseAnswerButtons(this.answerButtonsSetting); }
  async saveAnswerButtons(choice: AnswerButtons) { this.answerButtonsSetting = choice; }
  async swipeToRate() { return this.swipeToRateSetting; }
  async saveSwipeToRate(on: boolean) { this.swipeToRateSetting = on; }
  async listReviews(since: Date) {
    return [...this.reviews.values()]
      .filter((r) => new Date(r.reviewedAt) >= since)
      .sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt));
  }
  async saveDeckParams(params: Map<string, DeckParams>) {
    for (const [deck, p] of params) this.deckParams.set(deck, p);
  }
  async listDeckParams() { return new Map(this.deckParams); }
  async saveNoteTypes(types: NoteType[]) {
    for (const t of types) this.noteTypes.set(t.name, t);
  }
  async listNoteTypes() { return new Map(this.noteTypes); }
  async listDeckSettings() { return new Map(this.deckSettings); }
  async saveDeckSettings(deck: string, settings: DeckSettings) { this.deckSettings.set(deck, settings); }
}
