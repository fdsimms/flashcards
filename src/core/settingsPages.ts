/**
 * What Settings contains, as data: the pages (one per tab, each reached from Settings or from the
 * gear in that tab's header) and one entry per setting, so a search can find a setting without
 * knowing which page it's on.
 *
 * This is a search index, not a description of the UI: the rows stay written out in
 * `src/ui/SettingsPage.tsx` and `src/ui/Settings.tsx`, which is where a control's own state and
 * save-failure alert live. Its one obligation is to stay in step with them, so a row added there
 * gets an entry here (`tests/core/settingsPages.test.ts` holds the ids and pages to a list).
 */

export type SettingsPageId = 'today' | 'decks' | 'read' | 'lessons' | 'practice';

export interface SettingsPageInfo {
  id: SettingsPageId;
  /** The page's title, and the name of the tab or screen it belongs to. */
  title: string;
  /** What's on it, one line, under its row in Settings. */
  summary: string;
}

/** In the order Settings lists them: the tab bar's. */
export const SETTINGS_PAGES: readonly SettingsPageInfo[] = [
  { id: 'today', title: 'Today', summary: 'Study reminder, vacation mode' },
  { id: 'decks', title: 'Decks and cards', summary: 'Answer buttons, swiping, Thai text size, furigana, deck options' },
  { id: 'read', title: 'Read & Listen', summary: 'Turn it on or off, language' },
  { id: 'lessons', title: 'Lessons', summary: 'Narrator, waiting for and hearing your answers, Thai polite ending' },
  { id: 'practice', title: 'Practice', summary: 'Daily extras' },
];

export function settingsPage(id: string | undefined): SettingsPageInfo | undefined {
  return SETTINGS_PAGES.find((p) => p.id === id);
}

export interface SettingsEntry {
  id: string;
  /**
   * The page it's on, `settings` for a row on Settings itself (Font, Voices, Anki...), or `deck`
   * for one of a deck's options, which opens the list of decks to pick which.
   */
  page: SettingsPageId | 'settings' | 'deck';
  label: string;
  /** Words that should find it that its label doesn't have. */
  keywords?: readonly string[];
  /** The screen the row opens, when it opens one of its own (a switch has none: its page is the destination). */
  route?: string;
}

/** The list of decks, each opening its Deck options (src/ui/DeckOptionsList.tsx). */
export const DECK_OPTIONS_LIST = '/deck-options-list';

export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  { id: 'anki', page: 'settings', label: 'Anki', keywords: ['sync', 'import', 'export', 'apkg', 'server'], route: '/anki' },
  { id: 'backup', page: 'settings', label: 'Backup', keywords: ['restore', 'save', 'export', 'automatic'], route: '/backup' },
  { id: 'wanikani', page: 'settings', label: 'WaniKani', keywords: ['token', 'japanese', 'kanji', 'type', 'typing', 'answer', 'meaning', 'reading'], route: '/wanikani-settings' },
  { id: 'font', page: 'settings', label: 'Font', keywords: ['typeface', 'text', 'language', 'text size'], route: '/app-font' },
  { id: 'voices', page: 'settings', label: 'Voices', keywords: ['text to speech', 'tts', 'azure', 'read aloud'], route: '/voices' },
  { id: 'speaking', page: 'settings', label: 'Speaking', keywords: ['answer by speaking', 'microphone', 'dictation', 'recognizer'], route: '/speaking' },
  { id: 'pitchLine', page: 'settings', label: 'Pitch line in every language', keywords: ['record yourself', 'tone', 'intonation', 'pitch accent', 'pronunciation'], route: '/speaking' },
  { id: 'deckOptions', page: 'settings', label: 'Deck options', keywords: ['per deck', 'each deck', 'subdeck'], route: DECK_OPTIONS_LIST },

  // A deck's own options (src/ui/DeckOptions.tsx and the parts beside it), found by name.
  { id: 'deckDailyGoal', page: 'deck', label: 'Keep to a daily goal', keywords: ['cards a day', 'workload', 'study load', 'new cards', 'optimize', 'tune'], route: DECK_OPTIONS_LIST },
  { id: 'deckGate', page: 'deck', label: 'Limit cards in progress', keywords: ['progress gate', 'cap', 'maximum', 'new cards'], route: DECK_OPTIONS_LIST },
  { id: 'deckNewOrder', page: 'deck', label: 'New cards', keywords: ['order', 'frequency', 'sort'], route: DECK_OPTIONS_LIST },
  { id: 'deckCustomStudy', page: 'deck', label: 'Custom study', keywords: ['study more', 'extra', 'limit'], route: DECK_OPTIONS_LIST },
  { id: 'deckSkills', page: 'deck', label: 'Skill cards', keywords: ['drills', 'times', 'numbers', 'dates', 'prices', 'money', 'letters', 'consonants', 'vowels', 'classifiers', 'cases'], route: DECK_OPTIONS_LIST },
  { id: 'deckPriority', page: 'deck', label: 'Tagged cards first', keywords: ['priority', 'tags'], route: DECK_OPTIONS_LIST },
  { id: 'deckFonts', page: 'deck', label: 'Card fonts', keywords: ['font', 'typeface', 'script'], route: DECK_OPTIONS_LIST },
  { id: 'deckDailyLimits', page: 'deck', label: 'New cards a day', keywords: ['most reviews a day', 'daily limits', 'maximum'], route: DECK_OPTIONS_LIST },
  { id: 'deckForms', page: 'deck', label: 'Forms practice', keywords: ['conjugation', 'declension', 'grammar'], route: DECK_OPTIONS_LIST },
  { id: 'deckAspect', page: 'deck', label: 'Ask imperfective or perfective', keywords: ['verb aspect', 'russian', 'polish'], route: DECK_OPTIONS_LIST },
  { id: 'deckLookalikes', page: 'deck', label: 'Lookalike words', keywords: ['confused', 'similar', 'apart', 'sooner'], route: DECK_OPTIONS_LIST },
  { id: 'deckRecordings', page: 'deck', label: 'Record audio', keywords: ['recordings', 'azure', 'voice'], route: DECK_OPTIONS_LIST },

  { id: 'reminder', page: 'today', label: 'Study reminder', keywords: ['notification', 'daily'], route: '/reminder' },
  { id: 'vacation', page: 'today', label: 'Vacation mode', keywords: ['pause', 'break', 'away'], route: '/vacation' },

  { id: 'answerButtons', page: 'decks', label: 'Answer buttons', keywords: ['again', 'hard', 'good', 'easy', 'rating'], route: '/answer-buttons' },
  { id: 'swipe', page: 'decks', label: 'Swipe to answer', keywords: ['gesture', 'drag', 'good', 'again'] },
  { id: 'hints', page: 'decks', label: 'Show romanization and translation', keywords: ['romaji', 'hint', 'answer'] },
  { id: 'hook', page: 'decks', label: 'Ask for your own mnemonic', keywords: ['hook', 'memory hint'] },
  { id: 'thaiSize', page: 'decks', label: 'Thai text size', keywords: ['script', 'larger', 'bigger'], route: '/thai-text-size' },
  { id: 'furigana', page: 'decks', label: 'Furigana', keywords: ['kanji', 'reading', 'japanese', 'ruby'], route: '/furigana' },
  { id: 'noteTypes', page: 'decks', label: 'Note types', keywords: ['card types', 'templates', 'styling', 'css', 'front', 'back', 'models', 'layout'], route: '/note-types' },

  { id: 'readerOn', page: 'read', label: 'Server', keywords: ['read & listen', 'passphrase', 'sign in', 'turn on', 'turn off', 'texts', 'stories', 'server', 'share counts', 'crams', 'dundundun'], route: '/read-settings' },
  { id: 'readListening', page: 'read', label: 'Reading and listening', keywords: ['read & listen', 'voices', 'highlight', 'slow', 'meanings', 'word forms', 'explain', 'lock screen', 'dynamic island', 'offline', 'download'], route: '/read-listening' },
  { id: 'keepPlaying', page: 'read', label: 'Keep playing the shelf', keywords: ['up next', 'queue', 'autoplay', 'continuous', 'listening'], route: '/read-listening' },
  { id: 'readDaily', page: 'read', label: 'Daily reading tasks', keywords: ['dundundun', 'rotate', 'every day', 'tasks', 'languages', 'today'], route: '/read-daily-tasks' },
  { id: 'register', page: 'read', label: 'Register', keywords: ['formal', 'casual', 'everyday', 'polite', 'informal', 'how people talk', 'style', 'tone'], route: '/read-language' },
  { id: 'readLanguage', page: 'read', label: 'Language settings', keywords: ['grammar', 'vocabulary', 'level', 'voices'], route: '/read-language' },

  { id: 'narrator', page: 'lessons', label: 'Narrator', keywords: ['voice', 'audio lessons'], route: '/read-narrator' },
  { id: 'lessonWait', page: 'lessons', label: 'Wait for my answer', keywords: ['pause', 'continue', 'stop', 'respond', 'audio lessons'] },
  { id: 'lessonListen', page: 'lessons', label: 'Carry on when I stop talking', keywords: ['microphone', 'hands-free', 'listen', 'audio lessons'] },
  { id: 'lessonPlayBack', page: 'lessons', label: 'Play my answer back', keywords: ['microphone', 'record', 'hear yourself', 'take', 'audio lessons'] },
  { id: 'particle', page: 'lessons', label: 'Thai polite ending', keywords: ['khrap', 'kha', 'krap', 'ครับ', 'ค่ะ', 'man', 'woman', 'politeness'] },

  { id: 'extras', page: 'practice', label: 'Daily extras', keywords: ['drills', 'text', 'today'], route: '/extras' },
];

/** The entries whose label or keywords have every word of `query` in them (a prefix of a word counts), in list order. A blank query finds nothing. */
export function searchSettings(query: string, entries: readonly SettingsEntry[] = SETTINGS_ENTRIES): SettingsEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return entries.filter((e) => {
    const have = [e.label, ...(e.keywords ?? [])].join(' ').toLowerCase().split(/[\s,]+/);
    return words.every((w) => have.some((h) => h.startsWith(w)));
  });
}
