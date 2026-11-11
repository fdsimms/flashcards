export type CardKind = 'forward' | 'reverse' | 'audio';

export interface Note {
  id: string;
  deck: string;
  model: string;
  fields: Record<string, string>;
  tags: string[];
}

/** Serializable FSRS state (dates as ISO strings so it round-trips through SQLite/JSON). */
export interface SchedState {
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  /** 0 New, 1 Learning, 2 Review, 3 Relearning (ts-fsrs State enum) */
  state: number;
  lastReview: string | null;
}

export interface Card {
  id: string;
  noteId: string;
  kind: CardKind;
  suspended: boolean;
  /**
   * The note no longer generates this kind (GenerateReverse / GenerateAudioCard turned off and
   * re-imported). Kept apart from `suspended`, which comes from Anki, so a re-import that doesn't
   * carry suspension (TSV) can't undo one, and a kind turned back on brings its history back.
   */
  retired: boolean;
  sched: SchedState;
}

/** A deck's FSRS settings, from its Anki preset. */
export interface DeckParams {
  /** FSRS weights. Empty means the preset was never optimized: use the defaults. */
  weights: number[];
  desiredRetention: number;
  /** Days. */
  maxInterval: number;
}

export interface ReviewLogEntry {
  cardId: string;
  /** 1 Again, 2 Hard, 3 Good, 4 Easy */
  rating: 1 | 2 | 3 | 4;
  reviewedAt: string;
  state: number;
  due: string;
  stability: number;
  difficulty: number;
}

export interface RenderedSide {
  /** Labeled blocks shown in order. */
  blocks: { label?: string; text: string; emphasis?: boolean }[];
  /** Text to speak aloud for this side, if any. */
  speak?: string;
}

export interface RenderedCard {
  front: RenderedSide;
  back: RenderedSide;
  /** BCP-47 tag for TTS, when the language is known. */
  speechLang?: string;
}
