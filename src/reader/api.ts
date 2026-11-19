// Read & Listen's server API (server/reader/src/franki_reader/app.py lists it; routes/ has the code).
// Every call sends the passphrase; the server's own error sentences are passed through, since
// they're written to be shown as they are.
//
// A route that answers with a Pydantic model has its types generated into apiTypes.gen.ts
// (`npm run api:types`), and the types here are aliases of those. The hand-written types below are
// the routes not converted yet: converting one means a response model on the server, rerunning
// that, and an alias here in place of the hand-written type.

import { Refusal } from '../core/failure';
import type { DrillQuestionIn } from '../core/grammarDrills';
import type { LessonWordCandidate } from '../core/lessonWords';
import type { components } from './apiTypes.gen';
import { isSlow } from './playbackRate';

/**
 * Where Read & Listen's server is: beside the Anki sync server, under /reader on the same domain
 * (server/Caddyfile), so the address comes from the sync settings rather than being typed in.
 */
export function readerAddress(syncServer: string): string {
  return syncServer.trim().replace(/\/+$/, '') + '/reader';
}

/** What a text being written is doing, in order (the server's TextStage). */
export type TextStage = 'writing' | 'translating' | 'recording';
type Schemas = components['schemas'];

// 'writing': a text is being written now. 'failed': the last write failed and the server is
// waiting before it tries that topic again by itself.
export type TopicState = Schemas['TopicOut']['state'];

export type Topic = Schemas['TopicOut'];

// `helper` and `phrase` are there when a word of its line goes with the form (a preposition, an auxiliary):
// "в" and "in hoods".
export type WordForm = { id: string; name: string; helper?: string; phrase?: string };

/** What the server suggests for a verb's aspect pair (server/reader aspect.py). `aspect_source` is always "ai": nothing checks it. */
export type AspectPair = {
  aspect: 'perfective' | 'imperfective' | null;
  partner: string | null;
  partner_meaning: string | null;
  aspect_source: 'ai' | null;
};

/** One kanji of a word (KANJIDIC2, server/reader/src/franki_reader/kanji.py): kun readings are written with a dot before the okurigana (さむ.い). */
export type WordKanji = { char: string; meanings: string[]; on: string[]; kun: string[]; strokes: number };

/**
 * A character of a series as X-Ray shows them, as far as the episode being read (server/reader/src/franki_reader/xray.py):
 * a few facts from the episodes up to it and nothing later. `here` is whether they turn up in the open text.
 */
export type StoryCharacter = { name: string; description: string; first_episode: number; here?: boolean };

export type Word = {
  text: string;
  status: 'known' | 'partial' | 'unknown' | 'name' | null; // 'name': a name the model marked; null for spaces and punctuation
  gloss: string | null;
  // A compound known from deck words it splits into (เข้าใจ, from เข้า and ใจ) with no gloss of its
  // own: its parts' meanings ("to enter + heart"), which are not its meaning. Absent from a server older than it.
  parts?: string | null;
  lemma?: string | null; // the dictionary form, when it differs from the word (every language but Thai)
  translit?: string | null; // the pronunciation, when there is one (Thai's in Latin letters, Japanese's in kana)
  // The word's IPA, when there is some, and where it's from: Wiktionary's entry for the word as written, or
  // written by AI where Wiktionary has none. Absent from a server older than it, and null for a word with none.
  ipa?: string | null;
  ipa_source?: 'wiktionary' | 'rules' | 'ai' | null; // 'rules': Japanese, written from the kana reading by rule
  // How formal the word is where it's used: the deck note's own Register, else the one Claude gave it in its
  // text. '' for a word with none (and for a name); absent from a server older than it.
  register?: Register | '';
  // The series character a name word is (StoryCharacter.name), so a tap can show their card. Absent from a server older than X-Ray, and from any word that isn't a character's name.
  character?: string;
  stretch: boolean;
  deck: boolean; // a deck word, as against one known for being common (every language but Thai)
  wanikani?: boolean; // known for being learned in WaniKani (Japanese; absent from a server older than it)
  kanji?: WordKanji[] | null; // each kanji in a Japanese word, once, with its meanings and readings; null for a word with none, absent from a server older than it
  rank?: number | null; // its place among the language's 10,000 most common words (1 is the most common); null past the list's end; absent from a server older than it
  grammar: string | null; // the grammar point this word uses, if the text marks it (TextGrammar)
  // The grammatical form this word has in its line ("instrumental case"), when it's an inflected form and
  // the server could tell: the chip on its popup, which opens that form's FormPrimer. Absent from a server
  // older than it, and null for a word with no form to note. With a helper the popup says where the
  // meaning comes from ("в + prepositional: in hoods").
  form?: WordForm | null;
  // Set on the few known words of a text the reader hides behind a fill-in slot to type the form of (reader/formQuiz.ts;
  // server/reader/.../form_quiz.py picks them). Absent on every other word and from a server older than it.
  quiz?: boolean;
  // What a contracted word is made of ("σε + το" for στο, Greek, Spanish, French and German). Absent
  // from a server older than it, and null for any other word.
  contraction?: string | null;
  // When it's spoken in its line's audio, [start, end] in milliseconds (reader/spoken.ts). Absent
  // for spaces and punctuation, a line recorded without timings, and a server older than them.
  time?: [number, number];
};

// Practice: used at least twice in each text. Avoid ("Don't know it" on screen): kept out.
// Normal ("Know it" on screen): allowed, and the least seen are worked in. Unset (never marked):
// allowed at most twice in a text, and marked in the reader. Only the server reports unset.
export type GrammarState = 'practice' | 'avoid' | 'normal' | 'unset';
export type GrammarChoice = Exclude<GrammarState, 'unset'>;

// How often a point came up in texts read to the end. Absent from a server older than it.
export type GrammarSeen = { texts: number; uses: number; last: string | null };

// A grammar point's page (docs/grammar.md, step 4): its choice, how often it came up, its language's
// choices (for the related points), and lines using it from texts read, the latest first.
// A grammar drill's questions (docs/grammar.md, step 5): a line read with the point's words to name
// ("which", choices are point ids), or a sentence with a gap for the point ("gap").
export type DrillQuestion = DrillQuestionIn;
// `missing`: points that got no question. `writing`: whether the server writes more (it has Claude).
export type DrillSet = { questions: DrillQuestion[]; missing: string[]; writing: boolean };

export type GrammarExample = { text_id: number; title: string; line: string; english: string; words: string[] };
export type GrammarPointPage = {
  id: string;
  state: GrammarState;
  seen: GrammarSeen;
  choices: Record<string, GrammarState>;
  /** How many points may be practiced at once. Absent from a server older than it. */
  max_practice?: number;
  examples: GrammarExample[];
};

// Your topics (server/reader topics.py): a grammar page Claude writes for a topic the catalog doesn't have.
// `status`: writing while the server works on it (poll for it), ready, or failed for a page never written.
// `note` is a plain message when the last try failed (a failed rewrite keeps the old page, still ready).
// `explanation` is the catalog's format (paragraphs split by a blank line, `**words in the language**`); each
// example's `words` are the parts of its line that show the structure.
export type TopicStatus = 'writing' | 'ready' | 'failed';
export type TopicExample = { line: string; english: string; words: string[] };
export type GrammarTopic = {
  id: number;
  language: Language;
  title: string;
  status: TopicStatus;
  note: string | null;
  lead: string;
  explanation: string;
  examples: TopicExample[];
  created_at: string;
};
export type GrammarTopicRow = { id: number; title: string; status: TopicStatus; created_at: string };

// `jlpt`: the JLPT level a Japanese point is taught at, 5 for N5 (the easiest) up to 1 for N1; other languages have none.
export type GrammarPoint = { id: string; name: string; note: string; example: string; state: GrammarState; seen?: GrammarSeen; jlpt?: number };

// `least`: the known points the next texts are asked to work in, least seen first.
// `stretch`: how many times a text may use grammar not set (1 to 4), and the easiest point not yet
// practiced or known, to suggest when that goes up; missing from a server older than the Grammar dial.
export type GrammarStretch = { uses: number; next: { id: string; name: string } | null };
export type GrammarList = { max_practice: number; points: GrammarPoint[]; least?: string[]; stretch?: GrammarStretch };

// A grammar point a text marks: written to practice or avoid, a known one worked in for review,
// or one never marked that turned up.
export type TextGrammarRole = 'practice' | 'avoid' | 'review' | 'unset';
export type TextGrammar = { id: string; name: string; note: string; example: string; role: TextGrammarRole };

// What a form chip's sheet shows (server/reader/.../data/forms/<language>.json): what the form means, a
// table of endings or patterns (`rows` have a cell for each of `head`), and examples. `*asterisks*`
// mark the part to highlight, an ending (reader/formPrimer.ts splits them).
export type FormPrimer = {
  id: string;
  name: string;
  summary: string;
  table: { head: string[]; rows: string[][] } | null;
  examples: { text: string; english: string }[];
};

// The languages texts are written in. Topics are shared; the rest is per language.
export type Language = 'th' | 'es' | 'de' | 'fr' | 'ru' | 'el' | 'pl' | 'nb' | 'ja' | 'en';

// Every language but Thai counts this many of its most common words as known, as well as its deck.
/** How a language is handled by the daily reading tasks: a task every day, taking turns with the others, or none. */
export type DailyTaskMode = 'daily' | 'rotate' | 'off';

export type CommonCount = 0 | 250 | 500 | 1000 | 2000 | 3000 | 5000 | 10000;

// A and B are a dialogue's two speakers; N is a story's narrator. `paragraph`: this line opens a
// paragraph of a story (missing from a server older than paragraphs).
// `register`: how the text was written to be said (casual, formal...); '' for a text written before the
// server was asked, and missing from a server older than that.
export type TextLine = { speaker: 'A' | 'B' | 'N'; english: string; words: Word[]; audio: boolean; paragraph?: boolean; register?: Register | '' };

// How a line is said by a native speaker in its situation.
export type Register = 'casual' | 'neutral' | 'formal' | 'slang';

// Claude's check of the owner's own writing (server/reader production.py): a sentence with a word, their
// way of saying a Sentences prompt, or a retelling of a text. `corrected` is theirs with only the mistakes
// fixed, and theirs as written when it's right. Never kept, never graded.
export type WritingVerdict = 'right' | 'almost' | 'wrong';
export type WritingCheck = { verdict: WritingVerdict; corrected: string; english: string; notes: string[]; used_word?: boolean };
// A retelling's check adds words from the text it could have used (each with the line it's in) and what it left out.
export type RetellCheck = WritingCheck & { words: { word: string; english: string; line: number }[]; left_out: string };
export type WritingRequest =
  | { kind: 'sentence'; language: Language; attempt: string; word: string; meaning: string }
  | { kind: 'translate'; language: Language; attempt: string; english: string; reference: string };
// A sentence to say (server/reader sentences.py), built around a word reviewed today or still young.
export type SentencePrompt = { id: number; word: string; meaning: string; sentence: string; english: string; reviewed_today: boolean };

// Situations (server/reader situations.py): a scene talked through with Claude. The app holds the conversation
// and sends it with each turn; the server keeps nothing. `roles` come with the first turn and go back with every
// one after it.
export type SituationRoles = { you: string; them: string; name: string; gender: 'male' | 'female' };
export type SituationLine = { speaker: 'them' | 'you'; text: string };
// `focus`: a grammar topic the scene practices (Your topics), so the other person uses it and the feedback comments on it.
export type SituationFocus = { title: string; lead: string };
export type SituationConversation = { language: Language; scene: string; roles: SituationRoles | null; lines: SituationLine[]; focus?: SituationFocus; /* words from a cram being rehearsed, each "word (meaning)", for the other person to work in */ words?: string[] };
// One of their lines: its words split and glossed as a text's are, the words that count as unknown, whether it
// ends the scene, and its recording's key (null without one).
export type SituationTurn = { line: string; english: string; words: Word[]; unknown: string[]; done: boolean; audio: string | null; /* null when not recorded: Azure's voices are off, or it failed */ roles?: SituationRoles };
export type SituationFeedback = {
  lines: { index: number; verdict: WritingVerdict; corrected: string; note: string }[];
  words: { word: string; english: string; why: 'asked' | 'heard' }[];
};

// Claude's answer to "Does this sound natural?" on a line: `alternative` is what a native speaker would
// more likely say, and empty when the line is natural.
export type NaturalVerdict = 'natural' | 'stiff' | 'unusual';
export type NaturalCheck = { verdict: NaturalVerdict; reason: string; alternative: string };

// A dialogue between two speakers, or a short story told by a narrator.
export type Form = 'dialogue' | 'story';

// Which model writes a text: Sonnet is the default, Haiku costs about a twentieth as much.
export type TextModel = 'claude-sonnet-5-5' | 'claude-haiku-5-5';

// One thing worth knowing about a line: the part of it, and what to know.
export type ExplainPoint = { phrase: string; note: string };
/** Why a word has the form it has in its line (the form quiz's Explain): a few short parts the sheet draws, not paragraphs. */
export type FormExplanation = {
  /** The word of the line that decides the form, as written there, or '' when no single word does. */
  deciding: string;
  /** One sentence on what that word does to the hidden one. */
  rule: string;
  /** The change as before and after (the first is the dictionary form and the form in the line), at most two. */
  changes: { before: string; after: string }[];
  /** One sentence on telling this form from the one it's confused with, or ''. */
  tip: string;
};
/** A phrase selected in a line, explained: what it means there, and what to know about its parts. */
export type PhraseExplanation = {
  meaning: string;
  /** A word-for-word rendering, only when it differs from `meaning`. Absent from an answer kept before it existed. */
  literal?: string;
  /** How formal the phrase is, and one sentence on where it fits. '' when the model wasn't sure; absent from an answer kept before it existed. */
  register?: Register | '';
  register_note?: string;
  points: ExplainPoint[];
};

// A grammar point found in an explained line, with the owner's choice as it stands (docs/grammar.md, step 3).
export type LineGrammar = { id: string; name: string; note: string; example: string; state: GrammarState };

// One thing the reader can pick to happen in a story's next episode: written like a line (its
// words come segmented), with its English beside it.
export type TextChoice = { english: string; words: Word[] };

// A question about what happens in a text, for the check after reading (reader/check.ts), written by
// Claude with the text: in the text's language with its English, the line that answers it (from 0),
// and the index of the right choice.
export type TextQuestion = {
  line: number;
  question: string;
  english: string;
  choices: { text: string; english: string }[];
  answer: number;
};

export type ReaderText = {
  id: number;
  topicId: number;
  title: string;
  coverage: number;
  stretch: string[];
  roles: Partial<Record<'A' | 'B', string>>; // who each speaker is; empty for older texts and stories
  // Each speaker's drawn character and gender (reader/characters.ts); missing from a server older
  // than characters, and empty for older texts and stories, which show the A and B badges.
  characters?: Partial<Record<'A' | 'B', string>>;
  genders?: Partial<Record<'A' | 'B', string>>;
  form: Form;
  language: Language;
  grammar: TextGrammar[];
  lines: TextLine[];
  // Missing from a server older than the shelf: the topic (a story's name for an episode), whether
  // why it's on the shelf, and a story episode's number (0 otherwise).
  topic?: string;
  reason?: ShelfReason;
  episode?: number;
  // Which story an episode is from; null for any other text, and missing from a server older than
  // several stories running at once.
  story_id?: number | null;
  // A story episode's options for what happens next, and the index of the one picked (null until
  // one is). Missing from a server older than story choices, and empty for any other text.
  choices?: TextChoice[];
  chosen?: number | null;
  // A story episode's "Last time": what happened in the episode before it, shown above the text.
  // Missing for a first episode, any other text, and a server older than this.
  last_time?: { recap: string; line: RecapLine | null };
  // X-Ray: the series' characters as of this episode. Missing for a text that isn't an episode and from a server older than X-Ray.
  xray?: StoryCharacter[];
  // Questions about what happens, for the check after reading. Missing from a server older than
  // them, and empty for a text written before them or whose questions couldn't be written.
  questions?: TextQuestion[];
};

// Why a text is on the shelf: a topic typed in or a surprise ('asked'), or the ongoing story. 'due',
// 'liked' and 'new' are from when the shelf wrote ahead on its own, and are no longer written.
// '' for texts from before the shelf.
export type ShelfReason = 'due' | 'liked' | 'new' | 'asked' | 'story' | '';

// A text waiting on the shelf, as its card shows it; its words come with api.text(id).
export type ShelfText = {
  id: number;
  title: string;
  /** The title in English; missing from a server older than it and for a text written before it. */
  title_english?: string;
  topic: string;
  topic_id: number;
  form: Form;
  lines: number;
  stretch: string[];
  // The practice words as the reader draws them, to open their popovers, in the order of `stretch`.
  // Only on a story's next episode, and missing from a server older than it.
  practice?: Word[];
  reason: ShelfReason;
  coverage: number;
  episode: number;
  /** The model that wrote it; missing from a server older than the choice. */
  model?: string;
  /** When it was written, with its UTC offset; missing from a server older than the story card's date. */
  created_at?: string | null;
};

// A story episode's recap in its own language: words like a line's, and the line's English.
export type RecapLine = { english: string; words: Word[] };

// The current language's ongoing story: how many episodes are read, what happened last time,
// and the next episode once it's written. `failed` says why the last episode couldn't be written.
export type ShelfStory = {
  id: number;
  title: string;
  about: string;
  read: number;
  // Where the episode the card shows falls in its season, and how long a season is. Missing from
  // a server older than seasons.
  season?: number;
  season_episode?: number;
  season_length?: number;
  last_recap: string;
  // The same in the story's language, as words to tap, with that line's English. Null for an
  // episode written before it was asked for, and missing from a server older than it.
  last_recap_line?: RecapLine | null;
  // X-Ray: the characters as of the last episode read. Missing from a server older than X-Ray.
  xray?: StoryCharacter[];
  next: ShelfText | null;
  writing: boolean;
  /** Where the episode being written has got to. Missing from a server older than stages. */
  stage?: TextStage | null;
  failed: string | null;
};

export type Shelf = {
  language: Language;
  languages: { code: Language; name: string; ready: number }[];
  texts: ShelfText[];
  // Shelf texts being written now (a typed topic shows here until it's ready).
  writing: { topic: string; reason: ShelfReason; form: Form; stage?: TextStage | null }[];
  story: ShelfStory | null;
};

// A story in the Stories list: as the banner has it, without the recap and practice words (which
// one story's own page has), and whether it's running (else ended) and the one pinned to the top.
export type StoryListItem = ShelfStory & { running: boolean; pinned: boolean };

// 'topic': the model picks stretch words that suit the topic from a list of newer words and words
// reviewed today (never one due today and not reviewed yet).
// 'any': it's given words from that list at random and has to fit them in.
export type StretchWords = 'topic' | 'any';

// How many lines a dialogue has: short, medium or long.
export type Length = 6 | 8 | 12;

// A speaker is a man or a woman, as each text says, and is read in a voice of that gender
// (voiceSlots.ts). A dialogue between two men (or two women) uses the second voice of that gender
// for its second speaker; a story's narrator is read in the man's voice.
export type VoiceSlot = 'male' | 'male2' | 'female' | 'female2';

// The Azure voice for each slot.
export type Speakers = Record<VoiceSlot, string>;

// `decks`: the deck each language's words come from (the default when none was chosen).
// `voices`: each language's Azure voices by gender (the defaults when none were chosen). A server
// older than voices by gender sends {A, B} instead, which hasVoiceSlots tells apart.
// `common`: how many of each language's most common words count as known (not Thai: deck only);
// missing from a server older than the setting.
// The vocabulary check's questions for a language (reader/vocabCheck.ts). "preparing": the server is
// writing them, ask again in a few seconds.
export type VocabBank = {
  state: 'ready' | 'preparing' | 'failed' | 'unavailable';
  items: { word: string; rank: number; meaning: string; wrong: string[]; /** Japanese: the kana to say in place of the kanji. */ reading?: string }[];
};

// A kind of story character, and the voice and pitch (a percent change) a story gives the first
// one of that kind (reader/storyCast.ts).
export type CastKind = 'man' | 'woman' | 'boy' | 'girl' | 'elder_man' | 'elder_woman';
export type CastVoice = { voice: string; pitch: number };

export type Settings = {
  stretch_words: StretchWords; lines: Length; form: Form; language: Language;
  decks: Record<Language, string>; voices: Record<Language, Speakers>;
  common?: Partial<Record<Language, CommonCount>>;
  /** How each language is handled by the daily reading tasks other apps show (dailyTasks.ts); missing from a server older than the setting. */
  daily_tasks?: Partial<Record<Language, DailyTaskMode>>;
  /** How many rotating languages get a task a day (1 to 10). */
  daily_rotate_count?: number;
  /** Each language's story characters' voices (the defaults where none were chosen); missing from a server older than story voices. */
  cast?: Partial<Record<Language, Record<CastKind, CastVoice>>>;
};

// A change to the settings. A deck or voice named '' goes back to the default, and so does a
// story character's voice set to null.
export type SettingsChange = Partial<Omit<Settings, 'decks' | 'voices' | 'common' | 'cast'>> & {
  decks?: Partial<Record<Language, string>>;
  voices?: Partial<Record<Language, Partial<Speakers>>>;
  common?: Partial<Record<Language, CommonCount>>;
  cast?: Partial<Record<Language, Partial<Record<CastKind, CastVoice | null>>>>;
};

// One of Azure's voices, as the server lists them.
export type AzureVoice = { voice: string; locale: string; name: string; gender?: string; language?: string };

export type Rating = 'too_easy' | 'about_right' | 'too_hard';

// How many words outside the deck new texts have: 93%, 95% or 97% known words.
export type DifficultyLevel = 'harder' | 'standard' | 'easier';

// Finished texts over the last `days` days (what the Milestone 1 exit check reads), and the
// difficulty new texts are written at.
export type Progress = {
  days: number;
  finished: number;
  median_coverage: number | null;
  // The check after reading, over the finished texts it was taken with. Missing from a server older than it.
  check?: { texts: number; right: number; asked: number };
  next: { floor: number; stretch: number };
};

// A topic idea not yet added. `fit` is the share of its key words the deck knows.
export type Suggestion = Schemas['SuggestionOut'];

// Words to add to a language's deck when its new cards run low (server/reader's word_suggestions.py):
// from texts read, and the common words the deck lacks, each best first. Nothing here adds a note.
export type WordSuggestion = Schemas['WordSuggestionOut'];
export type WordSuggestions = Schemas['WordSuggestionsOut'];
/** A cram's themes (server cram_themes.py), what's asked for them and one of them. */
export type CramThemes = Schemas['ThemesOut'];
export type CramThemesRequest = Schemas['ThemesIn'];
export type CramTheme = Schemas['ThemeOut'];

// An audio lesson (server lesson.py): asked for by a scene, then written and spoken in the background.
export type LessonState = 'making' | 'ready' | 'failed';
/** What a lesson being made is doing, in order (the server's LessonStage). */
export type LessonStage = 'writing' | 'recording' | 'joining';
export type AudioLesson = {
  id: number;
  language: Language;
  scene: string;
  title: string;
  state: LessonState;
  /** Where a lesson being made has got to. A server from before stages doesn't send it: that reads as the first. */
  stage?: LessonStage;
  /** Why a failed lesson failed, written for a person. */
  error: string;
  duration_ms: number;
  created_at: string;
  phrases: { text: string; english: string }[];
  dialogue: { speaker: 'A' | 'B'; text: string; english: string }[];
  /** Where the learner speaks, [start, end] in milliseconds (lessonWaits.ts). Null while the server is still finding them in a lesson made before they were kept; a server from before sends none. */
  pauses?: [number, number][] | null;
  /** What's said and the learner's turns, with their times (lessonScript.ts); null for a lesson made before transcripts were kept. */
  script?: unknown[] | null;
};

/** A review on offer (server lesson.build_review): phrases noted in earlier lessons, and which lessons they're from. */
export type LessonReview = { phrases: number; lessons: { title: string; count: number }[] };

// A text read to the end, to read or listen to again.
export type PastText = {
  id: number;
  topic: string;
  title: string;
  rating: Rating | null;
  read_at: string;
  coverage: number;
  form: Form;
  episode?: number; // a story episode's number; 0 or missing otherwise
};

// A word marked unknown in a reading and not cleared since.
export type MarkedWord = {
  word: string;
  gloss: string | null;
  parts?: string | null; // as Word's
  lemma?: string | null; // the dictionary form, when it differs from the word (absent from a server older than it)
  status: 'known' | 'partial' | 'unknown';
  deck: boolean;
  wanikani?: boolean; // as Word's
  kanji?: Word['kanji']; // as Word's
  ipa?: string | null; // as Word's
  ipa_source?: Word['ipa_source']; // as Word's
  times: number;
  last_marked: string;
};

export type ReadingLog = {
  finished: boolean;
  words_glossed: string[];
  words_flagged: string[];
  audio_speed: number | null;
  listen_only: boolean;
  seconds: number;
  // The check after reading, when it was taken: answers right, of those asked.
  check_right?: number;
  check_asked?: number;
  // The meaning quiz on a tapped word: the words answered right and wrong (a record only).
  quiz_right?: string[];
  quiz_wrong?: string[];
};

// A word queued for Claude to fill in (src/reader/noteQueue.ts). `fields` is what it wrote, by Anki field
// name, once the word is `ready`; `error` says why a `failed` one failed.
export type QueuedNote = {
  id: number;
  language: Language;
  deck: string;
  entry: string;
  meaning: string;
  state: 'waiting' | 'ready' | 'failed';
  fields: Record<string, string>;
  error: string;
};

// `available` is false when the server has no Claude key, so nothing can be queued.
export type NoteQueue = { available: boolean; items: QueuedNote[] };

export class ApiError extends Refusal {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Where a recording plays from: the server, with the passphrase, or a file kept on the phone (offlineApi.ts). */
export type AudioSource = { uri: string; headers?: Record<string, string> };

// `onUnauthorized` runs when the server rejects the passphrase (it was changed on the server), so
// the app can forget it and ask again instead of failing every call. `fetchImpl` has no default:
// the app's goes through the connection guard (`guardedFetch`, src/ui/connection.ts).
export function createApi(
  baseUrl: string,
  passphrase: string,
  fetchImpl: Fetch,
  onUnauthorized?: () => void,
) {
  const root = baseUrl.replace(/\/+$/, '');

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await send(method, path, body);
    return response.status === 204 || response.status === 202
      ? (undefined as T)
      : ((await response.json()) as T);
  }

  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(root + path, {
        method,
        headers: {
          Authorization: `Bearer ${passphrase}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      // The guard's own reason (offline, or a server too slow) says more than a bare failure.
      throw new ApiError(e instanceof Refusal ? e.message : "Couldn't reach the server. Check your connection and try again.", 0);
    }
    if (response.status === 401) onUnauthorized?.();
    if (!response.ok) throw new ApiError(await errorMessage(response), response.status);
    return response;
  }

  return {
    check: () => call<void>('GET', '/api/check'),
    addTopic: (name: string) => call<Topic>('POST', '/api/topics', { name }),
    suggestions: () => call<Suggestion[]>('GET', '/api/suggestions'),
    progress: () => call<Progress>('GET', '/api/progress'),
    markedWords: () => call<MarkedWord[]>('GET', '/api/words'),
    grammar: () => call<GrammarList>('GET', '/api/grammar'),
    drills: (points: string[], count: number) => call<DrillSet>('POST', '/api/drills', { points, count }),
    // The queued words. Asking also starts filling in any that are due, so ask again while some are waiting.
    noteQueue: () => call<NoteQueue>('GET', '/api/note-queue'),
    // These answer 202 with the queue, which `call` would drop.
    queueNotes: async (language: Language, deck: string, entries: { entry: string; meaning: string }[]) =>
      (await send('POST', '/api/note-queue', { language, deck, entries })).json() as Promise<NoteQueue>,
    retryQueuedNote: async (id: number) => (await send('POST', `/api/note-queue/${id}/retry`)).json() as Promise<NoteQueue>,
    // After the note is saved in the editor, or when the owner removes the word.
    removeQueuedNote: (id: number) => call<void>('DELETE', `/api/note-queue/${id}`),
    vocabCheck: (language: Language) => call<VocabBank>('GET', `/api/vocab-check?language=${language}`),
    wordSuggestions: (language: Language) => call<WordSuggestions>('GET', `/api/word-suggestions?language=${language}`),
    // Not interested: the word isn't suggested for the language again.
    dismissWord: (language: Language, word: string) => call<void>('POST', '/api/word-suggestions/dismiss', { language, word }),
    // `examples`: how many lines to send (the server's default is 3). `shuffle`: a number that picks a random
    // sample from every text read instead of the latest ones; a server older than either ignores it.
    grammarPoint: (id: string, options: { examples?: number; shuffle?: number } = {}) => {
      const query = Object.entries(options).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join('&');
      return call<GrammarPointPage>('GET', `/api/grammar/${encodeURIComponent(id)}${query ? `?${query}` : ''}`);
    },
    // Your topics (under /api/grammar-topics: /api/topics is Read & Listen's reading topics). The writing calls answer 202 with the topic (status writing); `call` drops a 202's body.
    topics: (language: Language) => call<{ topics: GrammarTopicRow[] }>('GET', `/api/grammar-topics?language=${language}`),
    topic: (id: number) => call<GrammarTopic>('GET', `/api/grammar-topics/${id}`),
    createTopic: async (language: Language, title: string): Promise<GrammarTopic> => (await send('POST', '/api/grammar-topics', { language, title })).json(),
    // The grammar point an image (base64, its media type) is about, as a title for New topic. Nothing is kept: the topic is made by createTopic once the title has been looked at.
    readTopicImage: (language: Language, image: string, mediaType: 'image/jpeg' | 'image/png') => call<{ title: string }>('POST', '/api/grammar-topics/read-image', { language, image, media_type: mediaType }),
    moreTopicExamples: async (id: number): Promise<GrammarTopic> => (await send('POST', `/api/grammar-topics/${id}/examples`)).json(),
    rewriteTopic: async (id: number): Promise<GrammarTopic> => (await send('POST', `/api/grammar-topics/${id}/rewrite`)).json(),
    deleteTopic: (id: number) => call<void>('DELETE', `/api/grammar-topics/${id}`),
    // Every language's choices by point id (a point not set isn't listed), for Forms practice.
    grammarChoices: () => call<{ choices: Record<string, GrammarChoice> }>('GET', '/api/grammar/choices'),
    setGrammar: (id: string, state: GrammarChoice) =>
      call<GrammarList>('PUT', `/api/grammar/${id}`, { state }),
    // "I know through N_" (Japanese): points at that JLPT level or easier become Know it unless practiced, harder ones Don't know it.
    setGrammarLevel: (through: number) => call<GrammarList>('PUT', '/api/grammar/level', { through }),
    // How many times the next texts may use grammar not set (the Grammar dial on the wrap-up screen).
    setGrammarStretch: (uses: number) => call<GrammarList>('PUT', '/api/grammar/stretch', { uses }),
    // A language's word forms with a primer each, for the chip on a word's popup. Static on the server: no Claude call.
    forms: async (language: Language) =>
      (await call<{ forms: FormPrimer[] }>('GET', `/api/forms?language=${language}`)).forms,
    clearWord: (word: string) => call<void>('POST', '/api/words/clear', { word }),
    settings: () => call<Settings>('GET', '/api/settings'),
    // The deck list's totals, for dundundun's Franki task to read from /api/status (countsReport.ts).
    reportCounts: (counts: { due: number; new: number }) => call<void>('PUT', '/api/franki-counts', counts),
    updateSettings: (settings: SettingsChange) => call<Settings>('PATCH', '/api/settings', settings),
    // null while the server is still writing the text (202): ask again in a few seconds, and
    // `onStage` is told where the write has got to (undefined from a server older than stages).
    // With `words` (the cards just studied), a text written to practice them.
    nextText: async (topicId: number, words?: string[], onStage?: (stage: TextStage | undefined) => void) => {
      const response = await send('POST', `/api/topics/${topicId}/next`, words?.length ? { words } : undefined);
      if (response.status !== 202) return (await response.json()) as ReaderText;
      let stage: TextStage | undefined;
      try {
        stage = ((await response.json()) as { stage?: TextStage | null }).stage ?? undefined;
      } catch {
        // A 202 with no body, from a server older than stages.
      }
      onStage?.(stage);
      return null;
    },
    // With `story`, that story's episodes, first to last.
    // Audio lessons, newest first, and the languages the server can make them in. One is asked for by a scene and
    // made in the background (poll `lessons` until it's ready or failed).
    lessons: (language?: Language) =>
      call<{ languages: Language[]; lessons: AudioLesson[]; review?: LessonReview | null }>('GET', language === undefined ? '/api/lessons' : `/api/lessons?language=${language}`),
    // `narrator`: an English voice for this lesson's narration; left out, the server's own.
    // `particle`: a Thai lesson's polite ending, khrap or kha; the server ignores it in other languages.
    // `phrases`: the learner's own words and phrases to teach (a cram's), up to 15, instead of ones
    // Claude picks; `scene` is then the situation they're for. Returns the new lesson's id.
    makeLesson: async (language: Language, scene: string, narrator?: string, particle?: 'khrap' | 'kha', phrases?: { text: string; english: string }[]) => {
      const response = await send('POST', '/api/lessons', {
        language, scene, ...(narrator ? { narrator } : {}), ...(particle ? { particle } : {}), ...(phrases ? { phrases } : {}),
      });
      return ((await response.json()) as { id: number }).id;
    },
    // Scene ideas for a lesson, written by Claude (server lesson_topics.py): fits the learner's own
    // `phrases` when they chose some, and never repeats a lesson already made or an idea in `shown`.
    lessonTopics: async (language: Language, phrases?: { text: string; english: string }[], shown?: string[]) =>
      (await call<{ topics: string[] }>('POST', '/api/lessons/topics', {
        language, ...(phrases ? { phrases } : {}), ...(shown?.length ? { shown } : {}),
      })).topics,
    // Themes to talk about at a lesson, written by Claude from the learner's words (server cram_themes.py). Adds no note and grades nothing.
    cramThemes: (request: CramThemesRequest) => call<CramThemes>('POST', '/api/cram/themes', request),
    deleteLesson: (id: number) => call<void>('DELETE', `/api/lessons/${id}`),
    // A phrase of a lesson noted for a review: Again was tapped at its turn, or it was answered slowly. Never a rating.
    markLessonPhrase: (id: number, mark: { text: string; english: string; reason: 'again' | 'slow' }) =>
      call<void>('POST', `/api/lessons/${id}/marks`, mark),
    // Makes the review on offer from the phrases noted (no Claude call); returns its id, made in the background like a lesson.
    makeReview: async (language: Language, narrator?: string, particle?: 'khrap' | 'kha') => {
      const response = await send('POST', '/api/lessons/review', { language, ...(narrator ? { narrator } : {}), ...(particle ? { particle } : {}) });
      return ((await response.json()) as { id: number }).id;
    },
    // A phrase of the lesson as said at normal speed, cut out for a card's Audio field.
    lessonPhraseAudio: async (id: number, index: number): Promise<Uint8Array> => {
      const response = await send('GET', `/api/lessons/${id}/phrases/${index}/audio`);
      return new Uint8Array(await response.arrayBuffer());
    },
    // For the audio player, which fetches the file itself and so needs the passphrase too.
    lessonAudio: (id: number): AudioSource => ({
      uri: `${root}/api/lessons/${id}/audio`,
      headers: { Authorization: `Bearer ${passphrase}` },
    }),
    pastTexts: (story?: number) => call<PastText[]>('GET', story === undefined ? '/api/texts' : `/api/texts?story=${story}`),
    // Finished texts due to be heard again with their words hidden (server relisten.py), as pastTexts lists them.
    // `listens`: how many times each text is wanted again, 3 (1, 4 and 10 days), 1 (3 days) or 0.
    relisten: (listens: 0 | 1 | 3 = 3) => call<PastText[]>('GET', `/api/relisten?listens=${listens}`),
    // A finished text was heard again, through to its last line. Only counted: no reading, no difficulty change.
    logListen: (textId: number) => call<void>('POST', `/api/texts/${textId}/listen`),
    // The text difficulty for the current language, from the next text written (reader/difficulty.ts); answers with `next` as progress does.
    setDifficulty: (level: DifficultyLevel) => call<Progress['next']>('PUT', '/api/difficulty', { level }),
    // The current language's shelf; asking also tops it up in the background.
    // With a language, that language's shelf only read (keeping it for offline): the reader's own language stays, and nothing is written for it.
    shelf: (language?: Language) => call<Shelf>('GET', language ? `/api/shelf?language=${language}` : '/api/shelf'),
    // Writes a text on a typed topic in the background; it joins the shelf when it's ready.
    writeAbout: (name: string, form: Form, model?: TextModel) => call<void>('POST', '/api/shelf/write', { name, form, ...(model ? { model } : {}) }),
    // Starts a new story in the current language ('' lets the server choose what it's about).
    startStory: (about: string) => call<void>('POST', '/api/story', { about }),
    // The reader's language's stories, running first, then ended.
    stories: () => call<{ language: Language; stories: StoryListItem[] }>('GET', '/api/stories'),
    // One story for its own page: as the card has it (Last time, the next episode's practice words).
    story: (id: number) => call<StoryListItem>('GET', `/api/stories/${id}`),
    // Shows a running story on the shelf's card, in place of the one there.
    pinStory: (id: number) => call<void>('POST', `/api/stories/${id}/pin`),
    // No more episodes are written; the ones written stay in Past texts.
    endStory: (id: number) => call<void>('POST', `/api/stories/${id}/end`),
    // Runs an ended story again.
    continueStory: (id: number) => call<void>('POST', `/api/stories/${id}/continue`),
    // Takes a text off the shelf unread (Not this).
    skip: (textId: number) => call<void>('POST', `/api/texts/${textId}/skip`),
    // A past text, to read again. Reading it again isn't logged.
    text: (textId: number) => call<ReaderText>('GET', `/api/texts/${textId}`),
    logReading: (textId: number, log: ReadingLog) =>
      call<void>('POST', `/api/texts/${textId}/reading`, log),
    // The option picked at the end of a story episode (an index into its choices). The server
    // writes the next episode from it once this one is logged as read, so it's sent when tapped.
    chooseNext: (textId: number, choice: number) =>
      call<void>('POST', `/api/texts/${textId}/choice`, { choice }),
    // Azure's voices in a language (any code: th, pl, es-MX), every region included.
    azureVoices: async (language: string) =>
      (await call<{ voices: AzureVoice[] }>('GET', `/api/voices?language=${encodeURIComponent(language)}`)).voices,
    // `text` spoken by an Azure voice, as MP3 bytes: a card's recording, or a voice's sample. `language` is
    // the text's (th-TH, or a code: th), which a Multilingual voice would otherwise guess from the text.
    // `reading` is a Japanese word's KanaReading, said in its place where the server reads the kanji otherwise.
    speech: async (text: string, voice: string, rate = 1, language?: string, reading?: string) =>
      new Uint8Array(await (await send('POST', '/api/speech', { text, voice, rate, language, reading })).arrayBuffer()),
    // One line a story character might say, spoken in `voice` at `pitch` (a percent change), as MP3
    // bytes: the Story characters screen's way to hear a choice. Thai's line has a man's ending or a woman's.
    castSample: async (language: Language, voice: string, pitch: number, gender: 'male' | 'female') =>
      new Uint8Array(await (await send('POST', '/api/cast/sample', { language, voice, pitch, gender })).arrayBuffer()),
    // A short scene read by the narrator, a girl and a woman in the voices a story would give them now, as MP3 bytes.
    castScene: async (language: Language) =>
      new Uint8Array(await (await send('POST', '/api/cast/scene', { language })).arrayBuffer()),
    // Memory hints for a word (a leech), written by Claude on the server: asked only when the owner taps for them.
    mnemonics: async (question: { language: Language; entry: string; meaning: string; transliteration?: string; context?: string }) =>
      (await call<{ hints: string[] }>('POST', '/api/mnemonics', question)).hints,
    // Claude's answer to a question typed about the card on screen, from the conversation so far (the last turn is the
    // new question): asked only when the owner sends one (core/askCard.ts).
    askCard: async (card: { language?: Language; front: string; back: string; details?: string }, turns: { role: 'user' | 'assistant'; content: string }[]) =>
      (await call<{ answer: string }>('POST', '/api/ask-card', { ...card, turns })).answer,
    // A fix for a flagged card, suggested by Claude on the server: only the fields that change, each as its whole new HTML,
    // and why. Asked only on Fix with Claude now; the server writes nothing, the app applies it on Apply (core/fixCard.ts).
    fixCard: (body: { language?: Language; fields: Record<string, string>; reason: string; note?: string }) =>
      call<{ changes: Record<string, string>; explanation: string }>('POST', '/api/fix-card', body),
    // The Thai words a phrase typed for an audio lesson (romanization, Thai or English) could mean, for the learner to pick
    // from: asked only on Find Thai in Add a word; the server writes nothing (core/lessonWords.ts).
    lessonWords: async (language: Language, text: string) =>
      (await call<{ candidates: LessonWordCandidate[] }>('POST', '/api/lessons/words', { language, text })).candidates,
    // A Russian or Polish verb's aspect and its aspect partner, written by Claude on the server: asked only on Add to deck,
    // for the note editor to show and check (reader/mining.ts). Every field is null when there's nothing to suggest.
    aspectPair: (language: Language, word: string, line?: string) =>
      call<AspectPair>('POST', '/api/aspect-pair', { language, word, ...(line ? { line } : {}) }),
    // Cards' example sentences split and glossed as a text's lines are, for the word popovers on a card
    // (reader/cardGlosses.ts): asked once for a whole study session. `ready` is false until the
    // language's deck has been read on the server. A card's headword is asked with `parts`, and comes back split into the words it is made of.
    glosses: (language: Language, sentences: { text: string; english: string; parts?: true }[]) =>
      call<{ ready: boolean; sentences: Word[][] }>('POST', '/api/glosses', { language, sentences }),
    // A line's grammar and vocabulary explained by Claude on the server: asked on the owner's tap, kept per
    // line there. `simple` is a second, plainer version.
    explainLine: async (textId: number, line: number, simple: boolean, inLanguage = false) => {
      const answer = await call<{ points: ExplainPoint[]; grammar?: LineGrammar[] }>('POST', `/api/texts/${textId}/lines/${line}/explain`, { simple, in_language: inLanguage });
      // A server older than step 3 sends no grammar.
      return { points: answer.points, grammar: answer.grammar ?? [] };
    },
    // Whether a native speaker would say a line, judged by Claude on the server: asked on the owner's tap and
    // kept per line there.
    checkNatural: (textId: number, line: number) =>
      call<NaturalCheck>('POST', `/api/texts/${textId}/lines/${line}/natural`),
    // The owner's own writing, checked by Claude on their tap (production.py). Never kept, never graded.
    checkWriting: (request: WritingRequest) => call<WritingCheck>('POST', '/api/production/check', request),
    retell: (textId: number, attempt: string) => call<RetellCheck>('POST', `/api/texts/${textId}/retell`, { attempt }),
    // Sentences to say, one a word; more are written in the background. `writing` is false when the server can't write any.
    sentences: (language: Language, count: number) =>
      call<{ sentences: SentencePrompt[]; writing: boolean }>('POST', '/api/sentences', { language, count }),
    // A take of the owner's (base64 WAV) scored against the text it should say. The take isn't kept.
    situationScenes: (language: Language) => call<string[]>('GET', `/api/situations/scenes?language=${language}`),
    // `speak` false asks for no recording: the app reads the line with the phone's voice (the Azure voices setting is off).
    situationTurn: (conversation: SituationConversation, speak = true) => call<SituationTurn>('POST', '/api/situations/turn', { ...conversation, speak }),
    // One of their lines spoken slowly, recorded the first time: the clip's key for `situationAudio`, null if it couldn't be.
    situationSlow: (language: Language, gender: 'male' | 'female', line: string) => call<{ audio: string | null }>('POST', '/api/situations/slow', { language, gender, line }),
    situationFeedback: (conversation: SituationConversation) => call<SituationFeedback>('POST', '/api/situations/feedback', conversation),
    situationAudio: (key: string) => ({
      uri: `${root}/api/situations/audio/${encodeURIComponent(key)}`,
      headers: { Authorization: `Bearer ${passphrase}` },
    }),
    // A phrase selected in the text (as it appears there), explained the same way and kept per phrase. `line` is its
    // first line and `toLine` its last: a phrase can run on into the next lines (reader/phrase.ts, MAX_PHRASE_LINES).
    explainPhrase: (textId: number, line: number, toLine: number, phrase: string, simple: boolean, inLanguage = false) =>
      call<PhraseExplanation>('POST', `/api/texts/${textId}/lines/${line}/phrase`, { phrase, simple, in_language: inLanguage, to_line: toLine }),
    // Claude's answer to a question typed about a selected phrase, from the conversation so far (the last turn is the
    // new question): asked only when the owner sends one. The server keeps the conversation for a couple of hours
    // (`phraseChat`), so it comes back when the popup is reopened (ui/reader/usePhraseQuestions.ts). `line` and
    // `toLine` are the phrase's first and last lines, as for explainPhrase.
    askPhrase: async (textId: number, line: number, toLine: number, phrase: string, turns: { role: 'user' | 'assistant'; content: string }[], inLanguage = false) =>
      (await call<{ answer: string }>('POST', `/api/texts/${textId}/lines/${line}/ask`, { phrase, turns, in_language: inLanguage, to_line: toLine })).answer,
    // The conversation kept about a phrase since its last answer; none once it has expired.
    phraseChat: async (textId: number, line: number, phrase: string) =>
      (await call<{ turns: { role: 'user' | 'assistant'; content: string }[] }>('GET', `/api/texts/${textId}/lines/${line}/ask?phrase=${encodeURIComponent(phrase)}`)).turns,
    // Why a word has the form it has in its line (the form quiz's Explain), kept per word.
    explainForm: async (textId: number, line: number, word: Word) =>
      (await call<{ explanation: FormExplanation }>('POST', `/api/texts/${textId}/lines/${line}/form`, {
        word: word.text, lemma: word.lemma, form: word.form?.name, helper: word.form?.helper ?? '',
      })).explanation,
    // Records a line's slow version if it isn't yet, and says when each of the line's words is spoken in it
    // (one entry per word, null for none): the normal recording's times don't fit.
    slowTimes: (textId: number, line: number) => call<{ times: (Word['time'] | null)[] }>('GET', `/api/texts/${textId}/lines/${line}/slow`),
    // For the audio player, which fetches the file itself and so needs the passphrase too.
    // `rate` below normal asks for the slow recording, which the server makes the first time (`slowTimes` does too).
    audioSource: (textId: number, line: number, rate = 1): AudioSource => ({
      uri: `${root}/api/texts/${textId}/lines/${line}/audio${isSlow(rate) ? '?speed=slow' : ''}`,
      headers: { Authorization: `Bearer ${passphrase}` },
    }),
  };
}

export type Api = ReturnType<typeof createApi>;

// The longest a typed topic and a story's subject may be (WriteIn and StoryIn in server/reader routes/topics.py).
// The server refuses longer with a 422 whose detail is a list, so the fields stop at these instead.
export const MAX_TOPIC_CHARS = 150;
export const MAX_STORY_ABOUT_CHARS = 200;

export async function errorMessage(response: Response): Promise<string> {
  if (response.status === 401) return "That passphrase isn't right.";
  // Caddy answers 502 when the reader service isn't running beside the sync server.
  if (response.status === 502) {
    return "Read & Listen isn't running on your sync server. Turn it on there (server/README.md, Read & Listen), then try again.";
  }
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
    // FastAPI's validation refusal (422): a list of { loc, msg }, the first one named.
    if (Array.isArray(body.detail)) {
      const first = body.detail[0] as { loc?: unknown; msg?: unknown } | undefined;
      if (first && typeof first.msg === 'string') {
        const field = Array.isArray(first.loc) ? first.loc.filter((p) => typeof p === 'string' && p !== 'body').pop() : undefined;
        return `The server couldn't accept that (${field ? `${field}: ` : ''}${first.msg}). Change it and try again.`;
      }
    }
  } catch {
    // Not JSON; fall through to the generic message.
  }
  return `Something went wrong on the server (${response.status}). Try again.`;
}
