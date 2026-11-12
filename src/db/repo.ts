import { isInDeck } from '../core/deckTree';
import { renamedDeck } from '../core/deckNames';
import { parseAnswerButtons, type AnswerButtons } from '../core/answerButtons';
import { DEFAULT_COLLECTION_SETTINGS } from '../core/config';
import type { PracticeRecord } from '../core/forms';
import { DEFAULT_THAI_TEXT_SIZE, type ThaiTextSize } from '../core/script';
import { parseVoiceSettings, type VoiceSettings } from '../core/voices';
import type { Card, DeckParams, DeckSettings, Note, NoteType, ReviewLogEntry, CollectionSettings } from '../core/types';

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
  /** Removes a note with its cards, their logged answers and its forms practice. */
  deleteNote(id: string): Promise<void>;
  getNote(id: string): Promise<Note | undefined>;
  /** Removes notes with their cards, and cards of other notes, with their logged answers (a deleted deck's, `deckDeletion`). */
  deleteNotesAndCards(noteIds: string[], cardIds: string[]): Promise<void>;
  /**
   * Renames a deck and every deck under it ("A" to "C" makes "A::B" "C::B"): in notes, in cards
   * (their own deck and filtered deck), and the deck settings and Anki settings kept by name.
   */
  renameDeck(from: string, to: string): Promise<void>;
  /** Drops the settings and Anki settings kept for a deck and every deck under it, once it's deleted. */
  forgetDeck(deck: string): Promise<void>;
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
  /** The Anki collection's scheduling settings, as last imported or synced; Anki's defaults before that. */
  collectionSettings(): Promise<CollectionSettings>;
  saveCollectionSettings(settings: CollectionSettings): Promise<void>;
  /** Whether a revealed card can be swiped to answer it (right Good, left Again). Off by default; this phone's own. */
  swipeToRate(): Promise<boolean>;
  saveSwipeToRate(on: boolean): Promise<void>;
  /** Whether a card's romanization and translation show without a tap. Off by default; this phone's own. */
  showCardHints(): Promise<boolean>;
  saveShowCardHints(on: boolean): Promise<void>;
  /** How large Thai text is drawn on a card. Large by default; this phone's own. */
  thaiTextSize(): Promise<ThaiTextSize>;
  saveThaiTextSize(size: ThaiTextSize): Promise<void>;
  /** Logs one answered forms practice prompt. Franki's own: never written to Anki. */
  addPractice(record: PracticeRecord): Promise<void>;
  /** Forms practice logged at or after `since` (all of it without), oldest first. */
  listPractice(since?: Date): Promise<PracticeRecord[]>;
  /** Whether forms practice is answered by picking or typing: the last choice made. This phone's own. */
  formsAnswerMode(): Promise<'pick' | 'type'>;
  saveFormsAnswerMode(mode: 'pick' | 'type'): Promise<void>;
  /** The text-to-speech voice and speed chosen for each language. This phone's own: a backup doesn't carry it. */
  voiceSettings(): Promise<VoiceSettings>;
  saveVoiceSettings(settings: VoiceSettings): Promise<void>;
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
  showCardHintsSetting = false;
  thaiTextSizeSetting: ThaiTextSize = DEFAULT_THAI_TEXT_SIZE;
  practice: PracticeRecord[] = [];
  formsAnswerModeSetting: 'pick' | 'type' = 'pick';
  voiceSettingsValue = '{}';

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
        this.cards.set(c.id, {
          ...existing, retired: false, buriedAt: c.buriedAt, deck: c.deck, filteredDeck: c.filteredDeck, position: c.position,
          ankiMod: c.ankiMod, filteredDue: c.filteredDue, previewDue: c.previewDue, flag: c.flag,
        });
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
    this.practice = this.practice.filter((p) => p.noteId !== id);
  }
  async getNote(id: string) { return this.notes.get(id); }
  async deleteNotesAndCards(noteIds: string[], cardIds: string[]) {
    for (const id of noteIds) await this.deleteNote(id);
    const gone = new Set(cardIds);
    for (const id of gone) this.cards.delete(id);
    for (const [rid, r] of this.reviews) if (gone.has(r.cardId)) this.reviews.delete(rid);
  }
  async renameDeck(from: string, to: string) {
    const rename = (d: string) => renamedDeck(d, from, to) ?? d;
    for (const [id, n] of this.notes) this.notes.set(id, { ...n, deck: rename(n.deck) });
    for (const [id, c] of this.cards) {
      this.cards.set(id, { ...c, deck: c.deck === undefined ? undefined : rename(c.deck), filteredDeck: c.filteredDeck === undefined ? undefined : rename(c.filteredDeck) });
    }
    for (const map of [this.deckParams, this.deckSettings] as Map<string, unknown>[]) {
      for (const [d, v] of [...map].filter(([d]) => isInDeck(d, from))) { map.delete(d); map.set(rename(d), v); }
    }
  }
  async forgetDeck(deck: string) {
    for (const map of [this.deckParams, this.deckSettings] as Map<string, unknown>[]) {
      for (const d of [...map.keys()]) if (isInDeck(d, deck)) map.delete(d);
    }
  }
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
  collectionSettingsValue: CollectionSettings = DEFAULT_COLLECTION_SETTINGS;
  async collectionSettings() { return this.collectionSettingsValue; }
  async saveCollectionSettings(settings: CollectionSettings) { this.collectionSettingsValue = settings; }
  async swipeToRate() { return this.swipeToRateSetting; }
  async saveSwipeToRate(on: boolean) { this.swipeToRateSetting = on; }
  async showCardHints() { return this.showCardHintsSetting; }
  async saveShowCardHints(on: boolean) { this.showCardHintsSetting = on; }
  async thaiTextSize() { return this.thaiTextSizeSetting; }
  async saveThaiTextSize(size: ThaiTextSize) { this.thaiTextSizeSetting = size; }
  async addPractice(record: PracticeRecord) { this.practice.push({ ...record }); }
  async listPractice(since?: Date) {
    return this.practice
      .filter((p) => !since || new Date(p.practicedAt) >= since)
      .sort((a, b) => a.practicedAt.localeCompare(b.practicedAt));
  }
  async formsAnswerMode() { return this.formsAnswerModeSetting; }
  async saveFormsAnswerMode(mode: 'pick' | 'type') { this.formsAnswerModeSetting = mode; }
  // Kept as JSON text, as the SQLite repo keeps it, so a read never hands back the saved object itself.
  async voiceSettings() { return parseVoiceSettings(this.voiceSettingsValue); }
  async saveVoiceSettings(settings: VoiceSettings) { this.voiceSettingsValue = JSON.stringify(settings); }
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
