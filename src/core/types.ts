/**
 * forward / reverse / audio are Omnilanguage's cards (native renderer). `t<ord>` is a card of any
 * other note type, rendered from its Anki template with that ordinal (cloze number - 1 for cloze).
 */
export type CardKind = 'forward' | 'reverse' | 'audio' | `t${number}`;

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
  /**
   * The Anki card this is (Anki's card id), when it came from an Anki collection. Answers are
   * written back to that card in the kept collection (src/anki/writeback.ts).
   */
  ankiId?: string;
  /**
   * When Anki buried the card (its `mod` time, ISO), if it's buried: held back until the next
   * study day, as Anki does with a card's siblings once one is answered. `isBuried` (queue.ts)
   * decides; a card buried on an earlier day is studied as usual.
   */
  buriedAt?: string;
  /**
   * The card's own deck, when it isn't its note's (`Note.deck`): Anki keeps a deck per card, and a
   * note's cards can sit in different decks. `cardHomeDeck` (deckTree.ts) reads it.
   */
  deck?: string;
  /** The Anki filtered deck the card is in, if any: it's studied there, not in its own deck (`cardDeck`). */
  filteredDeck?: string;
  /** A new card's position in Anki's new-card order (the card's `due` while it's new): lowest first. */
  position?: number;
  /** When Anki last changed the card (its `mod`, unix seconds): part of the seed for Anki's review order. */
  ankiMod?: number;
  /** The card's `due` in its filtered deck: its place in the deck's order. */
  filteredDue?: number;
  /** In a preview filtered deck (Anki's queue 4): when it's shown again, ISO. */
  previewDue?: string;
  /** Anki's flag: 1 red, 2 orange, 3 green, 4 blue, 5 pink, 6 turquoise, 7 purple; none when missing or 0. */
  flag?: number;
  sched: SchedState;
}

/**
 * Which of a card's siblings (the other cards of its note) are held back until the next study day
 * once it's answered: the Anki preset's Burying options.
 */
export interface BurySettings {
  new: boolean;
  reviews: boolean;
  interdayLearning: boolean;
}

/**
 * The order a deck's cards come up in, from its Anki preset (DeckConfig.Config fields 30 to 34),
 * as Anki's enum values: `newMix` and `interdayLearningMix` 0 mix with reviews, 1 after reviews,
 * 2 before reviews; `newSortOrder`, `reviewOrder` and `newGatherPriority` as in
 * proto/anki/deck_config.proto. `src/core/order.ts` applies them.
 */
export interface StudyOrder {
  newMix: number;
  interdayLearningMix: number;
  newSortOrder: number;
  reviewOrder: number;
  newGatherPriority: number;
}

/** A limit set for one day only (Anki's Custom Study "increase today's limit"): `day` is the study day's key (`dayKeyOf`). */
export interface DayLimit {
  limit: number;
  day: string;
}

/** A deck's study settings, from its Anki preset: FSRS parameters and daily limits. */
export interface DeckParams {
  /** FSRS weights. Empty means the preset was never optimized: use the defaults. */
  weights: number[];
  desiredRetention: number;
  /** Days. */
  maxInterval: number;
  /** Daily limits from the Anki preset. Missing means the app's defaults (`src/core/config.ts`). */
  newPerDay?: number;
  reviewsPerDay?: number;
  /** Missing (a deck with no Anki preset) buries nothing. */
  bury?: BurySettings;
  /** The preset's learning and relearning steps, in minutes. Missing means ts-fsrs's (1m 10m, and 10m). */
  learnSteps?: number[];
  relearnSteps?: number[];
  /** A card lapsing `threshold` times becomes a leech: tagged, and suspended too when `suspend`. */
  leech?: { threshold: number; suspend: boolean };
  order?: StudyOrder;
  /** The Anki preset it uses (its config id): the load balancer counts cards by preset. */
  presetId?: number;
  /** The preset's easy days, Monday to Sunday (1 normal, 0 minimum, anything else reduced). */
  easyDays?: number[];
  /** Today-only limits that replace `newPerDay` / `reviewsPerDay` on their day. */
  newLimitToday?: DayLimit;
  reviewLimitToday?: DayLimit;
  /**
   * Set for an Anki filtered deck: it has no limits, and studies with each card's own deck's
   * settings. Without rescheduling it only previews, showing a card again after Again, Hard or
   * Good by `previewSecs` (0 finishes it).
   */
  filtered?: { reschedule: boolean; previewSecs?: { again: number; hard: number; good: number } };
}

/**
 * Collection-wide scheduling settings from the Anki collection's config: when the study day
 * starts (Anki's "Next day starts at"), the learn-ahead limit, and two options of Anki's v3
 * scheduler. Defaults are Anki's.
 */
export interface CollectionSettings {
  dayStartsAtHour: number;
  learnAheadMinutes: number;
  newCardsIgnoreReviewLimit: boolean;
  applyAllParentLimits: boolean;
  /** When the collection was created (`col.crt`, unix seconds, at a day's start): Anki numbers days from it. */
  collectionCreated?: number;
  /** The time zone it was created in (`creationOffset`, minutes west of UTC), which Anki dates the creation by. */
  creationOffset?: number;
  /** Anki's load balancer (`loadBalancerEnabled`), on unless turned off. */
  loadBalancer?: boolean;
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
  blocks: {
    label?: string;
    text: string;
    emphasis?: boolean;
    /** Anki's `{{hint:Field}}`: the text stays hidden behind a tap-to-show link with this label. */
    tapLabel?: string;
    /**
     * What the block is, for layout: `chips` are small tags (`chips` holds them), the `example*`
     * blocks are one example sentence's lines (set tight together), and a `note` is set off in a
     * callout. A block with no role is plain labeled text.
     */
    role?: 'chips' | 'example' | 'exampleRomanized' | 'exampleTranslation' | 'note';
    chips?: string[];
    /** A word to highlight inside the text: the card's word, in its example sentence. */
    mark?: string;
  }[];
  /** Text to speak aloud for this side, if any. */
  speak?: string;
}

export interface RenderedCard {
  front: RenderedSide;
  back: RenderedSide;
  /** BCP-47 tag for TTS, when the language is known. */
  speechLang?: string;
  /**
   * The note's recorded audio (the media file named in its Audio field), played in place of TTS
   * wherever a side would speak, as Anki plays it. TTS is the fallback when there's none.
   * It plays only on `audioSide`: the Omnilanguage templates put {{Audio}} on the back of the
   * Front and Reverse cards and on the front of the Audio card. On a drill note it's the
   * recording of the answer, so playing it on the front would give the answer away.
   */
  audioFile?: string;
  audioSide?: 'front' | 'back';
}

/** A note type's Anki templates and styling, for rendering cards the way Anki does. */
export interface NoteType {
  name: string;
  kind: 'normal' | 'cloze';
  /** Field names in Anki's order, for mapping a TSV export by position. */
  fields: string[];
  css: string;
  /** In Anki's order; `ord` is the position. A cloze note type has one. */
  templates: { ord: number; name: string; front: string; back: string }[];
}

/**
 * A deck's settings made in this app, kept apart from `DeckParams` (which an Anki import replaces),
 * so a re-import never undoes them.
 */
export interface DeckSettings {
  /** Progress gate: new cards only while fewer than this many cards here are below Guru. */
  gateCap?: number;
  /**
   * Subdecks hidden on the deck list, for a deck Anki doesn't have. A deck in the kept collection
   * keeps this in Anki's own `study_collapsed` instead (src/anki/deckWrites.ts).
   */
  collapsed?: boolean;
  /**
   * A deck made on the deck list without an Anki collection: listed even while it holds no cards
   * (`listedDecks`). A deck made with one is Anki's, and listed from it.
   */
  created?: boolean;
  /**
   * Where the deck was dragged to among its siblings on the deck list (0 first; `compareDecks`).
   * Franki's own: Anki lists decks by name and keeps no other order. Unset, a deck comes after
   * those that have one, by name.
   */
  position?: number;
  /*
   * The settings below apply to the deck and its subdecks, unless a subdeck sets its own
   * (`inheritedSetting`). Undefined means the default.
   */
  /** Suggest forms practice on the answer side (default on). */
  suggestForms?: boolean;
  /** Prompts in one practice of a word's forms (default `DEFAULT_FORM_PROMPTS`). */
  formPrompts?: number;
  /** Hold back lookalikes of a word just seen (default on). */
  keepLookalikesApart?: boolean;
  /** Study days a lookalike is held back: 1 is until tomorrow (default 1). */
  lookalikeDays?: number;
  /** Offer to show a card sooner when a lookalike may have given it away (default on). */
  offerSooner?: boolean;
}
