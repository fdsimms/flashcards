// Read & Listen's server API (server/reader/src/franki_reader/app.py). Every call sends the
// passphrase; the server's own error sentences are passed through, since they're written to be
// shown as they are.

import { Refusal } from '../core/failure';
import type { DrillQuestionIn } from '../core/grammarDrills';

/**
 * Where Read & Listen's server is: beside the Anki sync server, under /reader on the same domain
 * (server/Caddyfile), so the address comes from the sync settings rather than being typed in.
 */
export function readerAddress(syncServer: string): string {
  return syncServer.trim().replace(/\/+$/, '') + '/reader';
}

// 'writing': a text is being written now. 'failed': the last write failed and the server is
// waiting before it tries that topic again by itself.
export type TopicState = 'ready' | 'writing' | 'failed' | 'idle';

export type Topic = { id: number; name: string; ready: number; state: TopicState };

export type Word = {
  text: string;
  status: 'known' | 'partial' | 'unknown' | 'name' | null; // 'name': a name the model marked; null for spaces and punctuation
  gloss: string | null;
  // A compound known from deck words it splits into (เข้าใจ, from เข้า and ใจ) with no gloss of its
  // own: its parts' meanings ("to enter + heart"), which are not its meaning. Absent from a server older than it.
  parts?: string | null;
  lemma?: string | null; // the dictionary form, when it differs from the word (every language but Thai)
  translit?: string | null; // the pronunciation, when there is one (Thai's in Latin letters, Japanese's in kana)
  stretch: boolean;
  deck: boolean; // a deck word, as against one known for being common (every language but Thai)
  wanikani?: boolean; // known for being learned in WaniKani (Japanese; absent from a server older than it)
  rank?: number | null; // its place among the language's 10,000 most common words (1 is the most common); null past the list's end; absent from a server older than it
  grammar: string | null; // the grammar point this word uses, if the text marks it (TextGrammar)
  // The grammatical form this word has in its line ("instrumental case"), when it's an inflected form and
  // the server could tell: the chip on its popup, which opens that form's FormPrimer. Absent from a server
  // older than it, and null for a word with no form to note.
  form?: { id: string; name: string } | null;
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

// `jlpt`: the JLPT level a Japanese point is taught at, 5 for N5 (the easiest) up to 1 for N1; other languages have none.
export type GrammarPoint = { id: string; name: string; note: string; state: GrammarState; seen?: GrammarSeen; jlpt?: number };

// `least`: the known points the next texts are asked to work in, least seen first.
// `stretch`: how many times a text may use grammar not set (1 to 4), and the easiest point not yet
// practiced or known, to suggest when that goes up; missing from a server older than the Grammar dial.
export type GrammarStretch = { uses: number; next: { id: string; name: string } | null };
export type GrammarList = { max_practice: number; points: GrammarPoint[]; least?: string[]; stretch?: GrammarStretch };

// A grammar point a text marks: written to practice or avoid, a known one worked in for review,
// or one never marked that turned up.
export type TextGrammarRole = 'practice' | 'avoid' | 'review' | 'unset';
export type TextGrammar = { id: string; name: string; note: string; role: TextGrammarRole };

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
export type SituationConversation = { language: Language; scene: string; roles: SituationRoles | null; lines: SituationLine[] };
// One of their lines: its words split and glossed as a text's are, the words that count as unknown, whether it
// ends the scene, and its recording's key (null without one).
export type SituationTurn = { line: string; english: string; words: Word[]; unknown: string[]; done: boolean; audio: string | null; roles?: SituationRoles };
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

// One thing worth knowing about a line: the part of it, and what to know.
export type ExplainPoint = { phrase: string; note: string };
/** A phrase selected in a line, explained: what it means there, and what to know about its parts. */
export type PhraseExplanation = { meaning: string; points: ExplainPoint[] };

// A grammar point found in an explained line, with the owner's choice as it stands (docs/grammar.md, step 3).
export type LineGrammar = { id: string; name: string; note: string; state: GrammarState };

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
  // A story episode's options for what happens next, and the index of the one picked (null until
  // one is). Missing from a server older than story choices, and empty for any other text.
  choices?: TextChoice[];
  chosen?: number | null;
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
  last_recap: string;
  // The same in the story's language, as words to tap, with that line's English. Null for an
  // episode written before it was asked for, and missing from a server older than it.
  last_recap_line?: RecapLine | null;
  next: ShelfText | null;
  writing: boolean;
  failed: string | null;
};

export type Shelf = {
  language: Language;
  languages: { code: Language; name: string; ready: number }[];
  texts: ShelfText[];
  // Shelf texts being written now (a typed topic shows here until it's ready).
  writing: { topic: string; reason: ShelfReason; form: Form }[];
  story: ShelfStory | null;
};

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
  items: { word: string; rank: number; meaning: string; wrong: string[] }[];
};

export type Settings = {
  stretch_words: StretchWords; lines: Length; form: Form; language: Language;
  decks: Record<Language, string>; voices: Record<Language, Speakers>;
  common?: Partial<Record<Language, CommonCount>>;
};

// A change to the settings. A deck or voice named '' goes back to the default.
export type SettingsChange = Partial<Omit<Settings, 'decks' | 'voices' | 'common'>> & {
  decks?: Partial<Record<Language, string>>;
  voices?: Partial<Record<Language, Partial<Speakers>>>;
  common?: Partial<Record<Language, CommonCount>>;
};

// One of Azure's voices, as the server lists them.
export type AzureVoice = { voice: string; locale: string; name: string; gender?: string; language?: string };

export type Rating = 'too_easy' | 'about_right' | 'too_hard';

// Finished texts over the last `days` days (what the Milestone 1 exit check reads), and the
// difficulty new texts are written at.
export type Progress = {
  days: number;
  finished: number;
  median_coverage: number | null;
  ratings: Record<Rating | 'none', number>;
  // The check after reading, over the finished texts it was taken with. Missing from a server older than it.
  check?: { texts: number; right: number; asked: number };
  next: { floor: number; stretch: number };
};

// A topic idea not yet added. `fit` is the share of its key words the deck knows.
export type Suggestion = { name: string; fit: number };

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
  times: number;
  last_marked: string;
};

export type ReadingLog = {
  rating: Rating | null;
  finished: boolean;
  words_glossed: string[];
  words_flagged: string[];
  audio_speed: number | null;
  listen_only: boolean;
  seconds: number;
  // The check after reading, when it was taken: answers right, of those asked.
  check_right?: number;
  check_asked?: number;
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

// `onUnauthorized` runs when the server rejects the passphrase (it was changed on the server), so
// the app can forget it and ask again instead of failing every call.
export function createApi(
  baseUrl: string,
  passphrase: string,
  fetchImpl: Fetch = fetch,
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
    } catch {
      throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
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
    grammarPoint: (id: string) => call<GrammarPointPage>('GET', `/api/grammar/${encodeURIComponent(id)}`),
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
    // null while the server is still writing the text (202): ask again in a few seconds. With
    // `words` (the cards just studied), a text written to practice them.
    nextText: async (topicId: number, words?: string[]) =>
      (await call<ReaderText | undefined>('POST', `/api/topics/${topicId}/next`, words?.length ? { words } : undefined)) ?? null,
    // With `story`, that story's episodes, first to last.
    pastTexts: (story?: number) => call<PastText[]>('GET', story === undefined ? '/api/texts' : `/api/texts?story=${story}`),
    // The current language's shelf; asking also tops it up in the background.
    shelf: () => call<Shelf>('GET', '/api/shelf'),
    // Writes a text on a typed topic in the background; it joins the shelf when it's ready.
    writeAbout: (name: string, form: Form) => call<void>('POST', '/api/shelf/write', { name, form }),
    // Starts a new story in the current language ('' lets the server choose what it's about).
    startStory: (about: string) => call<void>('POST', '/api/story', { about }),
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
    speech: async (text: string, voice: string, rate = 1, language?: string) =>
      new Uint8Array(await (await send('POST', '/api/speech', { text, voice, rate, language })).arrayBuffer()),
    // Memory hints for a word (a leech), written by Claude on the server: asked only when the owner taps for them.
    mnemonics: async (question: { language: Language; entry: string; meaning: string; transliteration?: string; context?: string }) =>
      (await call<{ hints: string[] }>('POST', '/api/mnemonics', question)).hints,
    // Cards' example sentences split and glossed as a text's lines are, for the word popovers on a card
    // (reader/cardGlosses.ts): asked once for a whole study session. `ready` is false until the
    // language's deck has been read on the server.
    glosses: (language: Language, sentences: { text: string; english: string }[]) =>
      call<{ ready: boolean; sentences: Word[][] }>('POST', '/api/glosses', { language, sentences }),
    // A line's grammar and vocabulary explained by Claude on the server: asked on the owner's tap, kept per
    // line there. `simple` is a second, plainer version.
    explainLine: async (textId: number, line: number, simple: boolean) => {
      const answer = await call<{ points: ExplainPoint[]; grammar?: LineGrammar[] }>('POST', `/api/texts/${textId}/lines/${line}/explain`, { simple });
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
    situationScenes: (language: Language) => call<string[]>('GET', `/api/situations/scenes?language=${language}`),
    situationTurn: (conversation: SituationConversation) => call<SituationTurn>('POST', '/api/situations/turn', conversation),
    situationFeedback: (conversation: SituationConversation) => call<SituationFeedback>('POST', '/api/situations/feedback', conversation),
    situationAudio: (key: string) => ({
      uri: `${root}/api/situations/audio/${encodeURIComponent(key)}`,
      headers: { Authorization: `Bearer ${passphrase}` },
    }),
    // A phrase selected in a line (as it appears there), explained the same way and kept per phrase.
    explainPhrase: (textId: number, line: number, phrase: string, simple: boolean) =>
      call<PhraseExplanation>('POST', `/api/texts/${textId}/lines/${line}/phrase`, { phrase, simple }),
    // For the audio player, which fetches the file itself and so needs the passphrase too.
    audioSource: (textId: number, line: number) => ({
      uri: `${root}/api/texts/${textId}/lines/${line}/audio`,
      headers: { Authorization: `Bearer ${passphrase}` },
    }),
  };
}

export type Api = ReturnType<typeof createApi>;

export async function errorMessage(response: Response): Promise<string> {
  if (response.status === 401) return "That passphrase isn't right.";
  // Caddy answers 502 when the reader service isn't running beside the sync server.
  if (response.status === 502) {
    return "Read & Listen isn't running on your sync server. Turn it on there (server/README.md, Read & Listen), then try again.";
  }
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
  } catch {
    // Not JSON; fall through to the generic message.
  }
  return `Something went wrong on the server (${response.status}). Try again.`;
}
