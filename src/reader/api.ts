// Read & Listen's server API (server/reader/src/franki_reader/app.py). Every call sends the
// passphrase; the server's own error sentences are passed through, since they're written to be
// shown as they are.

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

export type Topic = { id: number; name: string; favorite: boolean; ready: number; state: TopicState };

export type Word = {
  text: string;
  status: 'known' | 'partial' | 'unknown' | null; // null for spaces and punctuation
  gloss: string | null;
  translit?: string | null; // the pronunciation in Latin letters, when there is one (Thai)
  stretch: boolean;
  deck: boolean; // a deck word, as against one known for being common (every language but Thai)
  grammar: string | null; // the grammar point this word uses, if the text practices or avoids it
};

// Practice: used at least twice in each text. Avoid: kept out. Normal: neither.
export type GrammarState = 'practice' | 'avoid' | 'normal';

export type GrammarPoint = { id: string; name: string; note: string; state: GrammarState };

// A grammar point a text was written to practice or avoid.
export type TextGrammar = { id: string; name: string; note: string; role: 'practice' | 'avoid' };

// The languages texts are written in. Topics are shared; the rest is per language.
export type Language = 'th' | 'es' | 'de' | 'fr' | 'ru' | 'el' | 'pl' | 'nb';

// Every language but Thai counts this many of its most common words as known, as well as its deck.
export type CommonCount = 0 | 1000 | 2000 | 3000 | 5000 | 10000;

// A and B are a dialogue's two speakers; N is a story's narrator. `paragraph`: this line opens a
// paragraph of a story (missing from a server older than paragraphs).
export type TextLine = { speaker: 'A' | 'B' | 'N'; english: string; words: Word[]; audio: boolean; paragraph?: boolean };

// A dialogue between two speakers, or a short story told by a narrator.
export type Form = 'dialogue' | 'story';

// One thing worth knowing about a line: the part of it, and what to know.
export type ExplainPoint = { phrase: string; note: string };

export type ReaderText = {
  id: number;
  topicId: number;
  title: string;
  coverage: number;
  stretch: string[];
  roles: Partial<Record<'A' | 'B', string>>; // who each speaker is; empty for older texts and stories
  form: Form;
  language: Language;
  grammar: TextGrammar[];
  lines: TextLine[];
  // Missing from a server older than the shelf: the topic (a story's name for an episode), whether
  // it's a liked theme, why it's on the shelf, and a story episode's number (0 otherwise).
  topic?: string;
  liked?: boolean;
  reason?: ShelfReason;
  episode?: number;
};

// Why a text is on the shelf: written around words due today, on a liked theme, an idea not
// tried before, a topic typed in, or the ongoing story. '' for texts from before the shelf.
export type ShelfReason = 'due' | 'liked' | 'new' | 'asked' | 'story' | '';

// A text waiting on the shelf, as its card shows it; its words come with api.text(id).
export type ShelfText = {
  id: number;
  title: string;
  topic: string;
  topic_id: number;
  liked: boolean;
  form: Form;
  lines: number;
  stretch: string[];
  reason: ShelfReason;
  coverage: number;
  episode: number;
};

// The current language's ongoing story: how many episodes are read, what happened last time,
// and the next episode once it's written. `failed` says why the last episode couldn't be written.
export type ShelfStory = {
  id: number;
  title: string;
  about: string;
  read: number;
  last_recap: string;
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
  // The liked themes the shelf writes from (shared by every language).
  themes: { id: number; name: string }[];
};

// 'topic': the model picks stretch words that suit the topic from a list of due and newer words.
// 'any': it's given words from that list at random and has to fit them in.
export type StretchWords = 'topic' | 'any';

// How many lines a dialogue has: short, medium or long.
export type Length = 6 | 8 | 12;

// The Azure voice each speaker is read in: A, and B (A also reads a story's narrator).
export type Speakers = { A: string; B: string };

// `decks`: the deck each language's words come from (the default when none was chosen).
// `voices`: each language's speakers' Azure voices (the defaults when none were chosen).
// `common`: how many of each language's most common words count as known (not Thai: deck only);
// missing from a server older than the setting.
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
  status: 'known' | 'partial' | 'unknown';
  deck: boolean;
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
};

export class ApiError extends Error {
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
    addTopic: (name: string, favorite = true) => call<Topic>('POST', '/api/topics', { name, favorite }),
    suggestions: () => call<Suggestion[]>('GET', '/api/suggestions'),
    setFavorite: (id: number, favorite: boolean) =>
      call<Topic>('PATCH', `/api/topics/${id}`, { favorite }),
    progress: () => call<Progress>('GET', '/api/progress'),
    markedWords: () => call<MarkedWord[]>('GET', '/api/words'),
    grammar: () => call<{ max_practice: number; points: GrammarPoint[] }>('GET', '/api/grammar'),
    setGrammar: (id: string, state: GrammarState) =>
      call<{ max_practice: number; points: GrammarPoint[] }>('PUT', `/api/grammar/${id}`, { state }),
    clearWord: (word: string) => call<void>('POST', '/api/words/clear', { word }),
    settings: () => call<Settings>('GET', '/api/settings'),
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
    // Azure's voices in a language (any code: th, pl, es-MX), every region included.
    azureVoices: async (language: string) =>
      (await call<{ voices: AzureVoice[] }>('GET', `/api/voices?language=${encodeURIComponent(language)}`)).voices,
    // `text` spoken by an Azure voice, as MP3 bytes: a card's recording, or a voice's sample.
    speech: async (text: string, voice: string, rate = 1) =>
      new Uint8Array(await (await send('POST', '/api/speech', { text, voice, rate })).arrayBuffer()),
    // Memory hints for a word (a leech), written by Claude on the server: asked only when the owner taps for them.
    mnemonics: async (question: { language: Language; entry: string; meaning: string; transliteration?: string; context?: string }) =>
      (await call<{ hints: string[] }>('POST', '/api/mnemonics', question)).hints,
    // A line's grammar and vocabulary explained by Claude on the server: asked on the owner's tap, kept per
    // line there. `simple` is a second, plainer version.
    explainLine: async (textId: number, line: number, simple: boolean) =>
      (await call<{ points: ExplainPoint[] }>('POST', `/api/texts/${textId}/lines/${line}/explain`, { simple })).points,
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
