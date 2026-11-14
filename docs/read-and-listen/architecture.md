# Architecture decisions

Decisions made after `brief.md` was written, with the reason for each. Where this file and the
brief disagree, this file is newer.

Read & Listen was its own app (fdsimms/ailing) until 11 November 2026, when the owner decided to
bring it into Franki and retire that app: its server is `server/reader/`, and its screens are
Franki's (Client, below).

## Kept from the brief

- **Python server.** Milestone 3's Spanish needs lemma matching, and the good tools for that are
  Python. PyThaiNLP alone would not justify it.
- **SQLite.** One user, light writes, one machine.
- **One gateway to Anki, with a 45-second timeout on every read** (`gateway.py`). The brief's
  reason was a tunnel that hung; a sync server that stops answering would hang the same way.

## Anki access

- **A sync client of Franki's own Anki sync server** (11 November 2026, replacing AnkiMCP). The
  reader keeps its own copy of the collection (`READER_ANKI_DIR`) and syncs it through Anki's own
  engine, the `anki` package, before each snapshot, like the MCP (server/mcp). It never changes the
  collection, so when the server asks for a full sync it always takes the server's copy, and a read
  leaves nothing to send (`tests/test_collection.py` checks). No media is synced.
- The snapshot is read straight from that copy (`collection.py`): the notes the language's query
  finds, Entry and Meaning from each Omnilanguage note (other note types are skipped), and each
  card's type, interval and whether it's due (`is:due`).
- **Why it changed.** The owner's devices moved from AnkiWeb to Franki's sync server, so the
  desktop Anki on the droplet that AnkiMCP read was no longer the record. Reading the sync server
  also drops the Caddy bearer-token proxy on the droplet, the AnkiMCP tunnel and the
  `docs/anki-spike.md` shapes (that doc and the proxy stay in the ailing repo).
- It signs in with the sync server's own user (`ANKI_USER`, `ANKI_PASSWORD`), over the compose
  network (`http://anki:8080/`), so nothing about Anki is exposed that wasn't already.

## Client

- **Part of Franki** (11 November 2026, by the owner's decision; before that its own Expo app,
  chosen on 19 October 2026 over the brief's home-screen web app). The logic is in `src/reader/`
  (tested with vitest, like the rest of Franki), the screens are `src/ui/Read*.tsx` and
  `src/ui/Reader.tsx`, built from Franki's kit and theme.
- **Off until it's turned on** in Settings, Read & Listen, with the passphrase: Franki's rule for
  anything that uses the network besides sync. The server's address isn't asked for: it's the sync
  server's plus `/reader` (`readerAddress`), so Read & Listen needs sync set up first. Once on, the
  deck list shows a Read & Listen row.
- **Background audio** (`UIBackgroundModes: audio`, from `expo-audio`'s plugin), so listening keeps
  going with the screen locked or in another app. The reader turns it on while it's open and off on
  the way out, so card audio in Review is unchanged. Turning it on needed a new build of the app.
- Screens (topics, reader, past texts, marked words, grammar, settings) are routes in `src/app/`
  (Expo Router), like the rest of Franki, and their sign-in state is `useReader`
  (`src/ui/useReader.ts`), which `src/ui/AppContext.tsx` calls in one line. The reader shows the
  server's word split as tappable words: a tap shows the gloss, and marking a word unknown is a
  second tap inside the gloss, so looking up a half-known word doesn't also flag it.
- Each line has an EN button that shows that line's English alone, so checking one line doesn't
  give away the rest. "Show English" still shows them all.
- **Explain** (12 November 2026, by the owner's decision). Each line has a third round button that
  opens Claude's note on that line's grammar and vocabulary under it: a few points, each a phrase
  from the line and what to know about it, in plain English. "Explain more simply" asks for a plainer
  version. Asked only on the tap (`POST /api/texts/{id}/lines/{n}/explain`, `explain.py`), with the
  line and the lines around it, and kept per line and per version in `explanations`, so opening a
  line again or rereading a past text costs nothing. It only shows text: nothing is graded or added
  to the deck. Each call's cost is kept with it and reported under `explanations` in `/api/costs`,
  apart from the texts' figures. A free-form "Ask a question" and a per-word explanation were left out for now.
  Under the explanation, the grammar points the finders find in the line show as chips that can be
  set to Practice, Know it or Don't know it there (docs/grammar.md, step 3).
- **Explain a phrase** (12 November 2026, by the owner's decision, for idioms and set phrases like
  "ya lo sé"). Hold a word and drag to the phrase's last word (13 November 2026, by the owner's
  request; `usePhraseDrag.ts`): the hold starts it, so a quick swipe still scrolls, and the text's
  scrolling is off until the finger lifts; held and let go on the same word, it's a tap. Or a
  word's gloss has "Select a phrase": the word becomes the phrase's first, the other lines dim, and
  tapping another word in the same line ends it (either way round; Cancel in the bar above the
  player, which also mentions the hold). The phrase is drawn as one band and Claude's note on it opens under the line:
  what it means there, then a few points on its parts (a set expression, how the words combine,
  tone), with "Explain more simply". A phrase stays within one line, so it has the line's context
  and the server can check it's there: the app sends it as it appears (the pieces joined, spaces
  and punctuation included, `src/reader/phrase.ts`), and the server refuses one that isn't in the
  line. Asked only on the tap (`POST /api/texts/{id}/lines/{n}/phrase`, `explain.py`) and kept per
  phrase and version in `phrase_explanations`; its cost counts under `explanations` in
  `/api/costs`. **Add to deck** on the note opens the note editor with the phrase and its meaning
  in the language's deck, the same approval step and daily limit as a marked word (`mining.ts`),
  and only for a text in the language being read.
- **Register and naturalness** (13 November 2026, by the owner's decision). Texts are written by a
  model, and a line that is grammatical but stiff passes every check in code, so two things show how
  a line is said, and neither grades or adds anything. (1) Each line carries a **register** chip
  (casual, neutral, formal or slang) at the end of its buttons. The generator asks for it with the
  line (`Line.register`, `REGISTERS`, `generator.py`), so it costs no extra call and is kept in the
  text's `lines`; a text written before it, or an answer outside the list, shows no chip. (2) The
  explanation has **Does this sound natural?**, asked only on the tap
  (`POST /api/texts/{id}/lines/{n}/natural`, `explain.py`) and kept per line in `naturalness`, so
  asking again costs nothing; its cost counts under `explanations` in `/api/costs`. It is a second,
  separate call that judges the line as a native speaker with who says it and the lines around it
  (a model grading its own draft in the same call mostly approves it), and answers natural, stiff or
  unusual with a reason and, unless natural, what a native speaker would more likely say. That is
  text only: the line's recorded audio is unchanged. Tried and left out for now: running the review
  on every line when a text is written (a cost on every text for lines never questioned), to be
  reconsidered if the taps show lines are often off, and coloring the chip when it disagrees with the
  situation.
- **Check what you understood** (13 November 2026, the owner chose from a mock). After Done, the end
  view offers a few multiple-choice questions above the rating, one at a time, each marked at once
  with the line that answers it (its words, English and audio). Three kinds, built when Done is
  tapped (`src/reader/check.ts`, pure and tested; `src/ui/ReaderCheck.tsx`): up to two about what
  happens, then one line to recognize by ear (two when there are none about what happens), then up to
  two words (marked unknown first, then looked up, then the practice words). A line heard is offered
  with the same speaker's other lines as the wrong choices, and the other speaker's only when there
  aren't enough (13 November 2026), so in a dialogue the voice alone doesn't rule choices out. The questions about
  what happens are Claude's, in the text's language with an English toggle (kept in the reader's
  prefs), written once the text passes its checks in one call (`comprehension.py`) and kept on the
  text (`texts.questions`); the code keeps a question only if its line exists, its four choices
  differ in both languages, and it uses at most one word that is neither known nor in the text, and a
  failed call leaves the text without them. Their cost is `questions` in `/api/costs`. The listening
  and word questions are built from the text's own lines, audio and glosses, so they cost nothing.
  The score (right of those answered, "I don't know" counting as wrong) is logged with the reading
  (`check_right`, `check_asked`) and shown in Progress. **Only the questions about what happens and
  by ear are logged** (13 November 2026, `loggedScore`): the word questions ask about words marked
  unknown or looked up, which were off the list, so missing them is expected and two misses in a
  small check made texts easier. They are still asked and marked, and the end view's "right on this
  text" counts them; the app leaves them out of what it sends, so the server and its API are
  unchanged (readings before this counted them). Since the server needs three answers, a text with
  fewer than three questions that count (no questions about what happens, or one) can't move
  difficulty, and the check's offer then doesn't say a low score makes the next text easier. **A poor score makes the next text easier**
  (the owner's choice): under 60% right of at least three raises the coverage target a step from
  the text's own level (`adapt_to_check`, through `after_reading`, as for a rating under Logging),
  unless the text was rated Too hard, which already did; a good score changes
  nothing, as the rating is what makes texts harder. Nothing is graded or added to the deck. Not done:
  the check on a past text read again (its reading isn't logged), and questions for texts written
  before it.
- **Use the lines yourself** (14 November 2026, the owner chose from a mock). Under the check, the
  end view offers two ways to make the text's lines again, each in place of the end view until it's
  done or stopped (`src/reader/lineDrill.ts`, pure and tested; `src/ui/ReadLineDrill.tsx`): **Say it
  back** shows a line's English (and who says it), to say aloud or type in the language, and **Write
  what you hear** plays a line (at 0.7x to start, 1x a tap away) to type. Check shows the line with
  what was typed against it, letter by letter (`src/core/typedCompare.ts`, shared with Review's Type
  it), plays it, and offers Record yourself and the line's Explain; the reader then marks it Missed
  it or Got it, and a missed line comes back at the end of the round, at most twice. Lines with
  fewer than two words or no English are left out, and Write what you hear needs the line's
  recording. Built from the text's own lines, English and audio, so it costs nothing (Explain asks
  only when tapped, as in the reader), and nothing is logged, sent or graded: the score at the end
  ("right the first time") is shown and forgotten.
- **Listen only** (brief, design principle 6). Once a text is rated "About right", the end view
  offers to play it again with the Thai hidden; the lines show who's speaking instead, and "Show the
  text" brings the words back. The reading is then logged with `listen_only` true. The brief's
  "unlocks for a text" is read as "for the text just rated", since a text is never served twice.
- While audio plays, the text scrolls to keep the line being spoken in view.
- **Repeat line** in the player plays the current line again, for shadowing. One chip steps through
  Off, 2×, 3×, 5× and ∞ (a count is the line's total plays; ∞ goes until turned off). The count isn't
  kept: it starts at Off each time a text opens, and a line started fresh (Play, a skip, a line's own
  replay button) begins its count again.
- **Record yourself** in the player, beside Repeat line, records the line playing or last played
  ("Record line 2"), pausing playback; Stop (or 30 seconds) ends the take and plays it back. Yours
  replays it, and the line's own buttons replay the native line. One take at a time, for that line
  only: moving to another line or closing the text deletes it, and it's never sent to the server.
- **Past texts**: texts read to the end, newest first (the last 50), opened in the same reader to
  read or listen to again. Reading one again isn't logged: the log is one row per text, and a reread
  shouldn't count toward the exit check or move difficulty. So there's no Done or rating, and words
  can be looked up but not marked unknown. One rated "About right" can be played listen-only straight
  away, since that's when the brief unlocks it.
- The reader's playback speed and the highlight switch are kept between launches, in the Keychain
  next to the passphrase (`src/reader/storage.ts`).
- **Progress** on the language's settings page (on the topics screen before the shelf): finished texts over the last 14 days with their median coverage and
  ratings (no goal is set; the Milestone 1 exit check's 10 texts was dropped), and the coverage
  target and practice word count new texts are written at, so the effect of a rating is visible.
  Only finished readings count.
- **Marked words**: every word marked unknown in a reading, newest first, with its gloss and whether
  it's in the deck. "Clear" hides a word until it's marked again (`cleared_words` table).
- **Mining** (12 November 2026, by the owner's decision, ahead of the Milestone 1 exit check where
  the brief put it in Milestone 3). A marked word that isn't in the deck has **Add to deck**, which
  opens Franki's note editor on a new Omnilanguage note in the current language's deck, with the
  word and its gloss filled in. **Saving it is the approval** (brief, design principle 13): nothing
  reaches the deck otherwise, and the note goes into the collection as every note added in Franki
  does, reaching Anki at the next sync. There is no daily cap (the owner dropped
  the brief's principle 12 on 13 November 2026: the deck's own new-cards-per-day limit controls how many come up). An added word is cleared from the list. The brief's "given audio" isn't done here: the note
  plays with the phone's voice until audio is recorded for it (the MCP's `add_tts_audio`).
- **Practice words after studying** (12 November 2026, by the owner's decision). When a Review
  session in a Read & Listen language's deck ends, **Read a text with these words** opens the
  shelf with the words just studied (each note's Entry, `src/reader/practice.ts`), which offers a
  text written to practice them, on the best-fitting idea (on a liked theme before 14 November 2026; before the shelf,
  the topic opened next was written for them). The app syncs before opening the shelf, so the answers
  just given are on the sync server. The server reads the deck again first, so a card first learned
  today counts as studied, offers the studied words as the stretch words to choose from (up to the
  usual count), and keeps the text apart from the topic's queue (`texts.focus`): it isn't served
  to a plain request or counted as ready. Words the deck hasn't studied are left out, and if none
  are left the request says so.
- Finishing a text (tapping Done) logs the reading once, rated or not, which takes it off the ready
  queue. A text left before Done (Back, or closing the app) isn't logged, so it's served again next
  time instead of a new one being written. A listen-only pass comes after Done, so leaving it by
  any route still logs the reading as finished.
- When the server rejects the saved passphrase (it was changed), the app forgets it and asks again:
  the next Read & Listen screen opened goes to its settings, which say why. The rejection can come
  from the settings read at launch, so it never takes you out of the deck list or a study session,
  and the deck list keeps its Read & Listen row until the new passphrase is in. Turning Read &
  Listen off in Settings forgets it too.
- **Nothing in the app grades or writes cards.** Its code imports nothing that schedules or writes
  them (`tests/reader/noGrading.test.ts`).
- **Word meanings on a card's example sentence** (13 November 2026, by the owner's decision, from
  a mock with three ways to show the words). On the back of an Omnilanguage card in a language's
  deck, each word of the example sentence (Context) can be tapped for the reader's popover: its
  meaning, play, its pronunciation, and Add to deck for a word not in the deck. Each word has a
  dotted underline, and where two words touch (Thai, Japanese) a short tick rises from the line
  between them, so the sentence shows where it splits; the card's own word keeps its highlight.
  The server splits and glosses the sentences as it does a text's lines (`POST /api/glosses`,
  `reader.render_sentence`), asked once when a study session starts, for every sentence in it,
  one call per language (`src/reader/cardGlosses.ts`, `src/ui/useCardGlosses.ts`), and the phone
  keeps the answers while the app runs. Afterwards, in the background, the server reads that
  language's deck if it's a day old and has Claude gloss the words that had no meaning (as
  `meanings.py` does for texts, with the sentence's ContextTranslation as the line's English), so
  they have one next time. Until then, offline, or with Read & Listen off, the sentence shows as
  before. Tapping a word grades nothing.

## Using the language

Decided 14 November 2026, the owner choosing from a mock (active learning, phase 2). Reading and
listening consolidate words; these make the owner produce them, which retrieval research says
teaches more (brief, Evidence base). **Nothing here grades FSRS or writes a note**, and Claude's
answers aren't kept.

- **One check for the owner's own writing** (`production.py`, `POST /api/production/check`): a
  sentence with a word (`kind: "sentence"`, which also says whether the word was used) or their own
  way of saying a Sentences prompt (`kind: "translate"`, the stored sentence sent as a reference that
  theirs needn't match). Claude gives a verdict (right, almost, wrong), their writing with only the
  mistakes fixed (theirs as written when right), its English and up to three notes. One call per tap,
  `effort: low`; the cost is `production` in `/api/costs`, failed calls included. The app draws the
  correction against what was typed with Review's own comparison (`src/core/typedCompare.ts`).
- **Use today's words** (`src/ui/ReadUseWords.tsx`, the `read-use-words` route): offered at the end
  of a review session of a language's deck while Read & Listen is on, with the notes answered while
  new in it (`wordsToUse`), one at a time, to write a sentence with. Placed after the session rather
  than on the answer side (the owner's choice): it doesn't slow reviewing, and recalling the word a
  few minutes later is the better practice.
- **Retell it** (`POST /api/texts/{id}/retell`, `src/ui/ReadRetell.tsx`): the third row of the end
  view's "Use the lines yourself". The same check, with the text's lines and English sent, plus up to
  four words from the text the retelling could have used (each kept only if it is in the text and not
  already in the retelling, with the line it's in, which a tap shows and plays) and what it left out.
- **Sentences** (`sentences.py`, `POST /api/sentences`, the Practice tab's Sentences tool): an
  English sentence built around a word, to say or type, then compared with the sentence written for
  it; Check mine asks the check above when one's own wording differs. The words are a text's stretch
  words' (`pick_stretch`): reviewed today first, then young, **never one waiting for its review**,
  neither as the word asked nor anywhere in a sentence (checked with the writing lexicon, and with the
  full snapshot for forms of a held word). Written in the background, ten words a call, two
  sentences a word, at most three calls a language a day; generate, then verify (the word used, at
  most one other word outside the known ones), never repaired. The round, with a missed sentence
  coming back at the end, is the line drills' (`src/reader/lineDrill.ts`). Its cost is `sentences`.

## Situations

Decided 14 November 2026, the owner choosing from a mock (active learning, phase 2): the brief's
Situations mode, made live. A scene (one of the topic ideas, `suggestions.py`, best fit first, or one
typed in English) talked through with Claude, who plays the other person from the deck's words; the
Practice tab's Situations tool (`src/ui/tools/SituationsTool.tsx`).

- **Nothing is kept on the server** (`situations.py`). The app holds the conversation
  (`src/reader/situations.ts`) and sends all of it with each turn (`POST /api/situations/turn`); the
  first turn also chooses the two parts, a first name and a gender for the other person, which the app
  sends back from then on. At most 40 lines.
- **One call a turn, only when the owner sends a line.** The word list is the texts' (studied words,
  with meanings), without the texts' writing rules, and is cached with the scene. **Generate, then
  verify:** each of their lines is re-segmented with the writing lexicon, so a word due today and not
  yet reviewed counts as unknown, and sent back once naming its words if it has more than
  `MAX_UNKNOWN` (2) outside the known ones; the second try is kept either way (a conversation can't wait
  for a third), with its unknown words picked out in the app and glossed from Claude's glosses.
- **Their lines are spoken by Azure** (the owner's choice over the phone's voice), in the language's
  voice for their gender, as each arrives, and kept as clips for two days (`ClipCache`,
  `GET /api/situations/audio/{key}`) so a replay costs nothing. A failed recording leaves the line
  without audio. "Heard only" hides their words behind Show the text.
- **The owner's lines** may hold an English word in [brackets] for a word they don't know; Claude
  answers as a helpful native speaker would. No correction during the conversation.
- **Finish** (`POST /api/situations/feedback`): each of the owner's lines with a verdict, the line
  with only its mistakes fixed (brackets put in the language) and a note, and up to six words worth
  adding, each kept only if the deck doesn't know it and, for a word heard, if it was in their lines.
  **Add** puts a word in the note queue (Quick add's), where it's filled in and saved, or not, in
  the note editor: nothing reaches the deck without that.
- **Cost:** `situations` in `/api/costs`, Claude's calls (failed ones included) and Azure's estimate
  for the lines spoken. No daily cap (the owner's choice); the costs page shows it.

## Speaking

Decided 14 November 2026, the owner choosing from a mock (active learning, phase 3), with one setting
for all of it: **Answer by speaking** (Settings, Speaking), off until turned on.

- **Speech to text is the iPhone's** (`expo-speech-recognition`, `src/core/speaking.ts`,
  `src/ui/useSpokenAnswer.ts`), never this server's. It runs with on-device required, which iOS keeps
  on the phone where it can for a language and otherwise sends to Apple; iOS reports on-device support
  only for the phone's own language, so the app says only whether a language can be heard at all.
  Tap to start, stopping by itself on a pause (Review's Type it, Say it back, Sentences); hold to
  talk in Situations. What's heard fills the box and is compared like typing, the recognizer's guess
  closest to the answer taken (`bestHeard`).
- **Score it** (`POST /api/pronunciation`, `pronunciation.py`, `franki_speech.SpeechClient.assess`):
  a Record yourself take, scored against its line or word by Azure's pronunciation assessment on the
  owner's tap. The take is 16 kHz WAV while speaking is on, sent as base64 JSON, and not kept. Each
  word gets a band the app colors (good from 80, close from 60, again below, or left out or added),
  with its weakest syllable. A language Azure won't assess is refused with that said plainly. Its
  cost is Azure's estimate from the seconds sent, `pronunciation` in `/api/costs`. Open risks: the
  request shape, the answer's fields and the price are from memory (Microsoft's pages weren't
  reachable), and which of the app's languages Azure scores is unknown until it's asked; tones aren't
  scored as such.

## Hosting

- **Beside the Anki sync server** (11 November 2026, by the owner's decision, moved from Fly.io),
  as the `reader` service in `server/docker-compose.yml`, turned on by `reader` in
  `COMPOSE_PROFILES`. Caddy serves it under `/reader` (`server/Caddyfile`), so the app's address
  ends in `/reader`. A merge to `main` that touches `server/` deploys it with the rest
  (`server/update.sh`). The owner chose one place for everything over keeping the memory apart:
  the reader peaked near 334 MB with Thai and Spanish, on top of sync and the MCP, so the server may
  need 2 GB; check `docker stats` after the first texts are written. simplemma has run in its
  low-memory form since 12 November 2026 (Languages), which should bring that down; the whole
  process hasn't been measured again.
- **The time zone (`TZ` in `server/.env`) is Anki's.** Anki decides which study day it is from the
  process's zone, so without it the day started at 4 AM UTC. The reader's own clock and every time
  it stores stay naive UTC whatever `TZ` says (`engine.utc_now`), as they were when the container
  ran in UTC, and `instant()` sends them as UTC.
- **Always on**, so background work isn't cut off. A compose healthcheck reads `/health`; one that
  stops answering shows as unhealthy and `server/update.sh`, on its 15-minute timer, restarts it
  (Fly's own check did this before).
- **No cron.** When the app is opened, the server refreshes the lexicon if the snapshot is over 24
  hours old, and tops up the queue of ready texts in the background.
- **Backups.** SQLite on the `reader-data` volume, backed up continuously with Litestream (v0.5.17,
  copied from its official image) to an S3-compatible bucket: the Tigris bucket it used on Fly,
  under the same `ailing` path, so the first start restores the database from it. `start.sh` runs
  the server under `litestream replicate` whenever `BUCKET_NAME` is set (`READER_BUCKET_*` in
  `.env`), restoring the database first if the volume is empty; without it, the server runs alone.
  Only one server may write to the bucket at a time: stop the Fly app before starting this one
  (`server/README.md`, Read & Listen).
- **Login.** The app is public and holds paid API keys. One long passphrase (`READER_PASSPHRASE`),
  entered once in the app and kept in the iOS keychain (`expo-secure-store`), sent with every API
  call and checked on every API route.

## Lexicon

- A note's tier comes from its weakest reviewed card: **mature** if the lowest interval is 21 days or
  more, **young** if reviewed but below that, **unreviewed** if no card has been reviewed
  (`server/reader/src/franki_reader/tiers.py`).
- **A suspended card doesn't count** (13 November 2026, the owner's decision from a review of the
  teaching). The owner's presets suspend leeches, so a suspended card is the word the learner keeps
  failing: a note whose reviewed cards are all suspended is unreviewed, so it isn't known for
  coverage and is never a stretch word, and a note with another unsuspended reviewed card is tiered
  from that one. The cards' `queue` is read with their type and interval (`collection.py`, -1 is
  suspended; `build_entries` leaves those cards out).
- Mature and young both count as known for coverage. The prompt asks the model to favor mature words.
- **Partial:** a word that only appears inside a longer deck entry (รับ inside รับอะไรดี). It counts as
  unknown for coverage, and its gloss can point at the entry it came from.
- **A compound known by splitting is glossed as itself, never as its parts** (13 November 2026). A
  word that splits cleanly into deck entries counts as known (เข้าใจ from เข้า and ใจ, ลูกน้ำ, หน้าที่;
  Japanese compounds Sudachi keeps whole the same way), but the reader used to gloss it part by part
  ("enter + heart"), which misleads for an opaque compound. Such a word now needs a gloss of its own:
  Thai's prompt asks the model to gloss every word it joins from two list words, and any it doesn't
  is asked for with the text's other unglossed words (Generation and coverage, the meanings pass). If
  there's still none, the app shows the parts' meanings labeled as parts ("Parts: to enter + heart",
  `parts` beside `gloss` in the API, `meaningOf` in src/reader/languages.ts), so they aren't read as
  its meaning, aren't put in a new note's Meaning, and aren't a word question's answer.
- **What's due and reviewed** (13 November 2026). Each note keeps, from the snapshot's study day,
  whether a card was due and not yet answered that day (`due`: Anki's `is:due` without `rated:1`),
  whether one was answered that day on any device (`reviewed`, `rated:1`), and how many study days
  after it the soonest card comes due (`due_in`, from the cards' due day or learning step). A
  snapshot can be from an earlier study day than today, so on a later day a word is taken as waiting
  once `due_in` says it has come due, and nothing is known to be reviewed. Stretch words, and the
  words a new text may use, read these (Generation and coverage). Still read only: `test_collection.py` checks a read leaves nothing to send.
- Only the latest snapshot is kept. No history.
- **Transliteration** (Thai): a word's popover hides it behind "Show transliteration". A deck word shows
  its note's `Transliteration` field, kept in the snapshot. A word off the list shows the one the model
  writes beside its gloss, in the style of the deck's (tone marks, syllables joined by hyphens), stored
  with the text (`texts.translits`). It can't be checked in code the way coverage is, so it's the model's
  word for it, and a word it gave none for shows no reveal rather than a guess. Texts written before
  this have none for their off-list words. Only Thai's prompt asks for it.

## Languages

Spanish was added on 26 October 2026, by the owner's decision, ahead of the Milestone 1 exit check
and of Milestone 3 where the brief put it. Mining followed on 12 November 2026 (Client). Thai
works as before.

German, French, Russian, Greek, Polish and Norwegian (Bokmål) followed on 12 November 2026, at the
owner's request for "all my other languages" but English (added later, below). Japanese, held back then, followed on
13 November 2026 (Japanese, below). The Backlog decks (Portuguese, Italian, Esperanto, Chinese) were empty, and Loopless Letters is
Thai letters, so none of them is a language here. Each new language works as Spanish does
(`spaced.py`, below), with its own deck, voices, list of common words and grammar points
(Grammar). A language with no grammar points would say so on the Grammar screen.

- **Each language's deck is a setting** (12 November 2026, by the owner's decision): `decks` in
  `/api/settings`, chosen on the language's settings page from Franki's decks, defaulting to the owner's. A
  language's skipped subdecks (Thai's consonant classes) are skipped under whichever deck is chosen
  (`with_deck`). Changing the deck forgets the old snapshot and reads the new deck at once, so a
  text is never written from the old deck's words; texts already waiting stay as they are. Another
  language still needs its deck, voices and rules for its entries in code (`languages.py`,
  `spaced.py`) and a list of common words (`scripts/build_common.py`).

- **One setting, `language`** (`th`, `es`, `de`, `fr`, `ru`, `el`, `pl`, `nb`, `ja` or `en`), picks the
  language new texts are written and served in. It's the menu in the shelf's header. **Topics are shared**: a topic like "At a
  coffee shop" has texts in each language. The lexicon snapshot, ready texts, difficulty, progress,
  past texts, marked words, practiced stretch words and failures are per language. Only the current
  language is topped up in the background, so a second language doesn't double the spending.
  `server/reader/src/franki_reader/languages.py` holds what differs: the deck, the query, the voices,
  whether words are written with spaces, the default common-words count and what the prompt says
  about the variety (Mexican Spanish, Bokmål).
- **How many common words count as known is a setting for each language but Thai** (12 November
  2026, the owner's decision: they weren't sure of their level in each, and found 10,000 a stretch
  for every language, Spanish included): `common` in `/api/settings`, None, 250, 500, 1,000, 2,000, 3,000,
  5,000 or 10,000, chosen on the language's settings page under the deck. The defaults are first guesses from
  each deck, to be moved by feel: Spanish keeps 10,000, so nothing changed under it; German, French,
  Russian and Greek, whose decks hold advanced words, 3,000; Norwegian, whose deck holds everyday
  words, 1,000; Polish, a beginner's deck, 250 (first tried with none, so only the deck counted; the
  first Polish text came out as strings of unrelated nouns, since 89 words have no connectives, and
  1,000 was too many for someone two or three Duolingo units in, so 250 and 500 were added: the most
  common 250 families are mostly the small words). The count goes in each request, not the cached system prompt, so changing it costs no
  cache. A text already waiting keeps the count it was written with, as with difficulty.
- **The other decks**, checked on 12 November 2026: German (`🥨 Deutsch`, about 270 studied notes),
  French (`🥐 Français`, 280), Russian (`🐻 Русский`, 170) and Greek (`🏝️ Ελληνικά`, 455) are
  mostly advanced words and phrases, like Spanish's; Norwegian (`🐟 Norsk`, 150) is everyday words;
  Polish (`💈 Polski`, 89) is a beginner's (ta kobieta, i, nie, jeść / zjeść). Polish's subdecks
  (Odmiana, Przypadki, Rekcja) are conjugation and case drills ("czekać (to wait) - wy"), not
  words, so they're skipped like Thai's consonant classes.
- **The Spanish deck** is `👅 Languages::🌮 Español`, with the same Omnilanguage note type as Thai,
  so the snapshot reads Entry and Meaning the same way. What it holds, checked against the real deck
  on 26 October 2026: about 790 notes of advanced words and phrases (el blindaje, a quemarropa,
  mantener a raya, cerciorarse), and no everyday words at all (casa, tener, de: none).
- **What counts as known outside Thai** (owner's decision, for Spanish first). Since the Spanish
  deck holds no everyday words, the deck alone can't be the dictionary as it is for Thai: almost no
  text would reach 90%. A word counts as known when its lemma is one of the language's **most
  common word families**, as many as the `common` setting says, or a **reviewed deck entry**. Each
  list (`server/reader/src/franki_reader/data/<code>_common.txt`, 10,000 long, most common first)
  is built by `server/reader/scripts/build_common.py` from wordfreq's 50,000 most common forms,
  each lemmatized with simplemma and its frequency added to its lemma's, so a verb whose use is
  spread over many forms (sentar: sentamos, sentó) still counts. Ranking single forms instead
  missed llover, sentar and disculpar. The script rebuilds Spanish's list exactly as it was made
  by hand. Everyday Spanish dialogues measured 100% at 10,000; a sentence of rare words
  (ornitorrinco, escabulló, estuario) is flagged. wordfreq writes Greek's final sigma as σ, so the
  script puts ς back before lemmatizing. `server/reader/src/franki_reader/spaced.py` is the
  checker, one for every language but Thai (it was `spanish.py`):
  - Lemmas from simplemma (hablé, hablaríamos to hablar), loaded the first time a language is
    used, in simplemma's **low-memory form** (12 November 2026). The default form took 99 MB for
    Spanish and 408 MB for Polish; the low-memory one takes 12 MB and 54 MB, gives the same lemma
    for every listed word and two inflections of each, and is about as fast. Before it, Thai alone
    peaked near 233 MB and Thai with Spanish near 334 MB, measured on Fly's 512 MB machine.
  - Spanish pronouns joined to a verb come off (dámelo to dar), and a reflexive entry matches its
    forms (cerciorarse matches cercioramos and cerciorándonos).
  - An entry's article, infinitive marker or reflexive pronoun is ignored, and counts as known in
    its own right, since it was studied with the entry: el blindaje, der Gipfel, l'amertume,
    en butikk, å vente, sich verlieben, se balader, bać się, å skynde seg, and Polish's
    gender markers (ta kobieta). Alternatives split on "/" are each an entry (jeść / zjeść,
    ποιος/ποια/ποιο, der Verräter / die Verräterin), and a lone article among them isn't
    (der/die Mitwirkende); a note in parentheses is ignored (zweifeln (an)).
  - French elisions are words of their own (l'homme is l' + homme, l' counting as le). simplemma
    takes a French past participle for an adjective (craché) and some present forms for nouns
    (balade), so a French word ending like a regular verb form is also tried as that verb's
    infinitive, against deck entries only, never the common words. Polish forms simplemma gets
    wrong (je for jeść, zjadła) aren't guessed: they come back to the model as unknown words.
  - Russian ё and е are the same letter for matching, since texts, the lists and simplemma each
    write one or the other. A hyphenated word (что-то, peut-être) is known when it's listed or
    every part is.
  - A deck phrase is found by its lemmas and becomes one token, counted once, like a Thai compound:
    mantuvimos a raya is known, as mantener a raya. A rare word only inside a deck phrase
    (quemarropa, from a quemarropa) is partial, as in Thai.
  - Words are written with spaces, so the model puts `|` where a space goes
    (`¿Qué|quieres|*tomar*?`) and the server turns each back into a space. A stretch word can be
    inflected, and counts as the entry it's a form of.
- **The prompt** outside Thai is one template (`_SPACED_INSTRUCTIONS`): the list is the learner's
  flashcard words, and each request says how many common words are allowed besides ("the 3,000
  most common German words in all their forms", or "only the list" when the setting is none). A
  language's variety is named where it matters: Mexican Spanish (ustedes, never vosotros), Bokmål,
  Modern Greek with accents, Russian with ё. Each language has its own cached system prompt.
- **Voices**: a man's voice and a woman's, Azure's standard neural voices for the country,
  checked to exist with the MCP's `list_voices`: Mexican Spanish `es-MX-JorgeNeural` and
  `es-MX-DaliaNeural` (the owner's choice), German `de-DE-ConradNeural` and `de-DE-KatjaNeural`,
  French `fr-FR-HenriNeural` and `fr-FR-DeniseNeural`, Russian `ru-RU-DmitryNeural` and
  `ru-RU-SvetlanaNeural`, Greek `el-GR-NestorasNeural` and `el-GR-AthinaNeural`, Polish
  `pl-PL-MarekNeural` and `pl-PL-ZofiaNeural`, Norwegian `nb-NO-FinnNeural` and
  `nb-NO-PernilleNeural`. Each language also has a second voice of each gender where Azure's
  standard voices have one, for a dialogue between two men or two women (Audio). The speech
  request's language comes from the voice's name.
- **In the app**, a word known for being common rather than from the deck says "A common word" in
  its gloss, and outside Thai the highlight's row in the reader's key is "Might be new to you". Every
  language but Thai is set a little smaller than Thai.
- **How common a word is** (13 November 2026, the owner's idea, to decide what to add to the deck):
  the word popup shows a four-bar meter, a band (very common up to 1,000, common to 3,000, uncommon
  to 10,000, rare beyond) and the word's place, "Uncommon · #6,412", from `rank` on each word of a
  text (`frequency.py`: the place in `data/<code>_common.txt`, by dictionary form, so hablé shows
  hablar's; `null` past the list's end, which the app calls rare). Thai has a list for this too,
  `data/th_common.txt`, built by `build_common.py` from two sources (wordfreq has no Thai): the
  word counts of the Thai National Corpus that PyThaiNLP ships, which is mostly written Thai, and
  every third line of OpenSubtitles' Thai subtitles from OPUS, which are speech (downloaded on the
  first run into the temp folder; about a minute on four cores). A word ranks by the average of its
  frequency in the two, so casual words land where they're said (ครับ from #199 to #49, โอเค from
  absent to #198, ป่ะ from #7,248 to #4,378). The subtitles are cut into words with the corpus's
  words added to PyThaiNLP's dictionary, so a casual word the corpus lists isn't split, and words
  outside that dictionary are dropped (the subtitles leave fragments like ยนะ). Every other
  language's list is wordfreq's blend, which already includes subtitles and social media. It only
  ranks: Thai still counts only its deck as known. The licences of the corpus and of OpenSubtitles
  aren't confirmed. A name shows nothing.
- **Topic ideas** are ranked by fit for Thai only: their words are Thai, so every other language
  keeps the listed order.
- The reading log names each language in English, lowercase (`thai`, `spanish`, `german`, `french`,
  `russian`, `greek`, `polish`, `norwegian`, `japanese`, `english`).

### English

Added on 13 November 2026, at the owner's request: texts written around the rare words in
`👅 Languages::🗽 English` (chiliastic, velleity, kenosis), to read them in use. It works as the other
spaced languages do, with these differences:

- **The deck is the learner's own words, and common words carry the text.** The deck holds rare
  words and no everyday ones, as Spanish's does, so `common` defaults to 5,000 and is changed like
  the others'. Voices are Azure's en-US Guy, Davis, Jenny and Aria; the prompt asks for American English.
- **The learner already reads English**, so the prompt asks for `english` as a plainer paraphrase of
  the line and each gloss as a short definition or synonym, not a translation.
- **Rare words' forms** (velleities, kenoses, apricating) aren't known to simplemma, so `spaced.py`
  also tries a form's ending as its deck entry (`Rules.guesses`), against deck entries only.
- **No Practice tools and no grammar points**: telling the time or money in English is something the
  learner already does (`TOOL_LANGUAGES` leaves it out), and the grammar catalog has none for it.
- **Hidden until the app is rebuilt with it**, as Japanese is: `HIDDEN_LANGUAGES` in
  `languages.py` keeps a language out of the shelf and settings for a build that has no entry for
  it. Empty it once the app is rebuilt.

### Japanese

Added on 13 November 2026, by the owner's decision, with its grammar points, vocabulary check,
Quick add and Practice tools. The deck is `👅 Languages::🍥 日本語` (about 390 notes, 189 studied when added: intermediate
words and phrases like 劇団, 約束を破る, 見せびらかす, 経験する), with the reading in `KanaReading`
rather than `Transliteration` (`Language.translit_field`).

- **Known words come from three places**, the owner's choice: the studied deck notes, the
  vocabulary learned in WaniKani, and Japanese's most common words, up to the `common` setting
  (default 2,000, a first guess, since WaniKani covers much of the everyday vocabulary). Particles,
  auxiliaries and numbers always count as known: they're grammar, not vocabulary.
- **WaniKani** (`wanikani.py`): a vocabulary or kana vocabulary subject counts once it's at Guru
  (SRS stage 5) or above, and Master (7) or above is listed to the model as well known. The server
  reads it with `WANIKANI_TOKEN` in `server/.env`, a read-only token from WaniKani's settings, once
  a day with the Japanese deck, and keeps the last list when WaniKani can't be reached. Without the
  token, Japanese counts its deck and common words only. The words are known but aren't deck words:
  they're listed in the model's word list beside the deck's (negative ids, so they never meet a
  note id), gloss with WaniKani's meaning, and say "Learned in WaniKani" in the app. Nothing is
  ever sent to WaniKani.
- **Splitting a line** (`japanese.py`): Japanese has no spaces, so the server splits each line
  itself with SudachiPy (core dictionary, mode C), never by the model's `|`. A word is what's
  tapped: a verb or adjective with what conjugates it (行きました, 食べさせられた, 待って), a prefix
  with the word after it (お茶), a suffix with the noun before it (学生たち) but not after a name.
  Words match by Sudachi's surface, dictionary and normalized forms, so 行きました is 行く, and
  spelling variants meet (引越し and 引っ越し, できる and 出来る). A deck phrase (約束を破る) is found
  by its morphemes and is one word, conjugated or not; a suru verb's noun and a na-adjective's stem
  count too. A compound Sudachi keeps whole is known when its shortest units are. MeCab with UniDic
  was the other choice; Sudachi was picked for its normalized forms. Its dictionary adds about 70 MB.
- **Readings**: each word's reading is Sudachi's, in hiragana, as the word is written in the text
  (破った is やぶった), except the deck's `KanaReading` for an entry written exactly as on the note.
  A word in kana only, or with digits (Sudachi reads 13日 as イチミッカ), has none. The popover's
  button says "Show reading".
- **Common words**: `data/ja_common.txt`, built by `build_common.py` from wordfreq's Japanese list,
  each form grouped by Sudachi's normalized form and shown as its most frequent dictionary form.
  wordfreq's forms are MeCab's pieces (し, なっ, まし), so a few of the listed words are fragments;
  they still count their family.
- **The vocabulary check** asks only content words in their dictionary form (`japanese.quiz_word`:
  no particles, auxiliaries, names, numbers, lone kana or pieces ending in っ), and Claude gives an
  empty meaning, so the word is dropped, for a piece Sudachi reads as a word (まし, あり). Words
  learned in WaniKani are left out like deck words, and a word written only in katakana is a
  giveaway, as most are English loanwords. The ranks stay the list's, so a score maps to the
  setting as in the other languages.
- **Quick add** (`note_queue.py`) writes a Japanese word's reading into `KanaReading`, in kana,
  and refuses one with kanji or Latin letters; Japanese has no romanized sentence.
- **The prompt** is the template the spaced languages share, with Japanese's own rule for `|`
  (between words, and never a space) and its variety: standard Japanese, kanji where a native
  speaker would use them, never romaji.
- **Voices**: `ja-JP-KeitaNeural` and `ja-JP-DaichiNeural` (men), `ja-JP-NanamiNeural` and
  `ja-JP-AoiNeural` (women). Azure bills a Japanese character as two (`tts.billed_chars`), which
  the cost figures count.
- **Grammar points** (ten: polite ます, past, ている, たい, てください, the volitional,
  conditionals, the causative, てしまう, keigo) are found from Sudachi's morphemes in
  `grammar_japanese.py`: the auxiliary ます, た by its normalized form (読んだ's だ is た), the
  volitional by its conjugation form. The potential and the passive share られる, so neither is a
  point. ます and the past are in almost every Japanese line, so the cap on points not set would
  keep them out of texts: both read as Know it until the owner chooses otherwise (the catalog's
  `known`, the owner's decision). Each point has a JLPT level (`jlpt`: ます, the past, ている, たい and
  てください N5; the volitional, conditionals, the causative and てしまう N4; keigo N3, the
  assistant's placement, the owner's to correct), shown as a badge on the Grammar screen, where "I
  know grammar through N_" sets Know it at that level or easier (Practice kept) and Don't know it
  above it. The owner chose this over a level stored on the server, so a point added later isn't
  affected by it. Levels offered are the ones the language's points have.
- **Practice** (`src/tools/japanese/`): telling the time, dates and money, each answer in kanji
  with its reading in hiragana where the other languages show a romanization. The counters' sound
  changes are worked out in `numbers.ts` (四時 よじ, 六分 ろっぷん, 一日 ついたち, 四円 よえん). A
  date's other forms are the short weekday and the era year (令和, 平成, 昭和, by the day each
  began, first year 元年), and a date typed in kana is accepted as its reading. Prices are whole
  yen.

## Grammar

Added on 26 October 2026 at the owner's request: grammar to practice or avoid, for each language.

- **Points** (listed in `server/reader/src/franki_reader/grammar_points.json`, the catalog the app
  shares, docs/grammar.md; each one's finder in `grammar.py`). Spanish: preterite, imperfect, present perfect,
  pluperfect, future, conditional, progressive, present subjunctive, imperfect subjunctive (the
  present is always allowed). Thai: เคย, กำลัง, จะ, แล้ว, ต้อง, กว่า, ที่สุด, ถ้า, เพราะ, and yes or no
  questions (ไหม, หรือเปล่า). Since 12 November 2026, at the owner's request, the other languages
  have theirs (`grammar_europe.py`): German perfect, simple past, pluperfect, future, subjunctive
  II, passive, modal verbs, and verb-last after weil, dass, obwohl; French passé composé,
  imperfect, future, near future (aller + infinitive), conditional and subjunctive; Russian past,
  future with буду, conditional (бы), imperative, verbal adverbs and comparatives; Greek θα, να,
  past, perfect and pluperfect; Polish past, future with będę, conditional (by), questions with
  czy, and want, must or can + infinitive; Norwegian past, present perfect, past perfect, future
  (skal, kommer til å) and passive. Each was picked to be found from the words alone, without a
  parser, like Spanish's; aspect and case, which need one, aren't points. Each is **practice** (used at least twice in each text), **avoid**
  (left out, for grammar not learned yet), **normal** (known: allowed, and the least seen worked
  in, Exposure below) or **not set** (never marked: allowed at most twice a text). On the Grammar
  screen these read "Practice", "Don't know it" and "Know it", and a point not set has none of
  them selected (12 November 2026, the owner's wording and decision). Not set is stored as no
  choice at all; before that day normal was too, so a point set to Know it then reads as not set
  until it's marked again. At most 2 are practiced at once, so texts
  stay natural; avoiding has no limit. The choices are stored together for every language and
  apply from the next text written (`GET /api/grammar`, `PUT /api/grammar/{id}`). Forms practice in
  the app reads every language's (`GET /api/grammar/choices`; docs/grammar.md, step 2). Each point has a
  page (`GET /api/grammar/{id}`; docs/grammar.md, step 4), opened from its name here. Points set to
  Practice or Know it are drilled from the Practice tab, with questions from texts read and ones
  Claude writes ahead (`POST /api/drills`, `drills.py`; docs/grammar.md, step 5).
- **The Grammar dial** (owner's request, 13 November 2026). The end view's "For the next ones"
  card has a Grammar row beside Length: Simpler, Same or Harder, stepped from where it was when the
  view opened. It sets how many times a text may use points not set (`Difficulty.unset_uses`, per
  language, 1 to 4, 2 by default, `PUT /api/grammar/stretch`), which the generator reads in place of
  `UNSET_USES`; a rating never moves it. Harder also suggests the easiest point (the catalog's
  `level`) that isn't practiced or known, with a Practice it button that sets it to Practice, so
  the owner approves every change and nothing is scheduled or graded. Not a second rating: it sits
  with Length because grammar has no dial a rating could move, and a "too hard" caused by grammar
  still moves only the words. Texts already on the shelf keep the allowance they were written with.
- **Generate, then verify, as for coverage.** The request names the points to practice and avoid,
  and the server finds them in the draft. A practiced point used fewer than twice, or an avoided one
  used at all, sends the draft back with the words named ("Don't use the Preterite; this draft has:
  hablé, dijo"). Among attempts that all miss, the closest kept is the one with the fewest grammar
  misses (uses short of a practiced point, plus uses of an avoided one, plus uses of points not
  set past 2 in all), then the highest coverage; it's served if it's at 90% or more, like any
  closest attempt, so a slip is possible but rare.
- **Not set is capped, not kept out** (owner's decision, 12 November 2026). Defaulting every point
  to "Don't know it" would keep the basics (Thai's จะ and ไหม, every past tense) out of every text
  until each was marked, and the owner didn't want the generator straining to avoid everything; nor
  a lot of unknown grammar slipping in unexplained. So the request lists the points not set as
  grammar the learner may not know, to use at most 2 times in the whole text (`UNSET_USES`,
  `grammar.py`), and a draft over that goes back like any grammar miss.
- **Exposure** (owner's request, 12 November 2026; `exposure.py`). How often each point came up is
  counted with its finder in every text read to the end, written before this or not, and whether
  or not the point was asked for: texts, uses, and when it was last read. Counts are a floor, as
  the finders leave forms out on purpose. The 2 known points longest since they were last read or
  last asked for (`REVIEW_POINTS`; never-met ones first) are named in each request as grammar to
  work in where it fits, with no minimum and no check, and the text records them
  (`texts.grammar`'s `review`). Counting the asking as well as the reading rotates the list when
  the model passes a point over and when the shelf writes several texts ahead. The Grammar screen
  shows each point's counts and the same 2 points ("Seen least of what you know", each with a
  Practice button), from the same `review_points`, so it names what the next texts are asked for.
  Seen is never learned: nothing here schedules or grades a card.
- **Finding points.** Thai points are words, matched on the coverage segmentation; the segmenter
  sometimes joins one onto the next word (กำลังกิน), so a word starting with the point counts, with
  listed look-alikes left out (ต้องการ, "want", isn't ต้อง, "must"). Spanish points are verb forms,
  found from their endings, with simplemma confirming the word is a form of a verb, plus lists of
  irregular forms (the other spaced languages the same way, with auxiliaries and particles matched
  as words). That's close but not perfect, on purpose: a form shared by two tenses counts as
  neither (hablamos is "we speak" and "we spoke"), words that are also nouns are left out (vino is
  "wine", fuera is also "outside"), and a rare irregular form can be missed. A full parser (spaCy)
  would be more exact but adds about 100 MB to a process already near 334 MB.
- **What the other languages' finders can't tell apart**, so they leave it out: French regular
  subjunctives look like the present (qu'il parle), so only irregular ones count (soit, fasse);
  Russian говорите after вы is "you speak", not a command; a Norwegian -et past (snakket) counts
  only straight after a subject, since eplet is a noun with its article; and a lowercased German
  word simplemma knows as a noun (Garten) isn't taken for a past form. German marks the
  participle, not its auxiliary, since it's at the end of the clause, and for the future marks
  werden, as "morgen" also ends like an infinitive. Each finder is checked on present-tense texts
  that must find nothing (`tests/test_grammar_europe.py`), since a false find under "avoid" sends
  a good draft back.
- **In the reader**, a text's practiced points show as chips under its practice words, and their
  words are underlined solid; a word using an avoided point that slipped in is underlined dashed;
  a known point worked in, or a point not set that turned up, gets a thin gray line (the owner
  chose it over a dotted one, which already means a word). Tapping any of them explains the
  grammar, and a point not set offers "I know it" and "I don't know it" to mark it there. Which
  points are not set is read from the choices as they are when the text is opened, so one marked
  since isn't still explained as unmarked.
- Each text records the grammar it was asked for (`texts.grammar`), so the log shows what each
  text practiced.

## Generation and coverage

- **The server re-segments every line.** The model's `|` breaks are not trusted for coverage: the
  server removes them, splits the line again with the lexicon-first segmenter, and computes coverage
  from that. The model's breaks are only a cross-check, and the asterisks still mark stretch words.
  The reader's tap targets come from the server's split.
- **A Thai space is a clause break** (12 November 2026). Written Thai has no commas or periods; a
  space ends a clause or sentence. The model puts a space instead of `|` there
  (`สวัสดี|ครับ ไป|ไหน`), the server keeps it (one beside a `|` is dropped as noise), the reader
  shows it as a gap, and the voice pauses there (Audio). Before this every Thai space was dropped,
  so a two-sentence line was spoken as one run with no pause; texts written then still are.
- **A target range, not only a floor** (owner's decision, 12 November 2026). The 95% floor with a
  98% aim gave texts that were nearly all known words, so every dialogue was too easy. The target
  now starts at 92% (`DEFAULT_FLOOR`, `difficulty.py`) and "too easy" ratings lower it to 90%
  (`FLOOR`, `coverage.py`), "too hard" raises it to 99%. A text also has a ceiling, `CEILING_GAP`
  (4 points) above the target, and a draft over it goes back for revision with a message asking for
  more natural words outside the list, each glossed. A text still over the ceiling after 3 attempts
  is served anyway (too easy is never a reason to drop one), choosing the attempt closest to the
  range. The request names the range, and the prompt tells the model to write natural target-language
  speech rather than word-for-word English idioms. Difficulty is saved under a new key
  (`difficulty_v2`), so every language restarts at 92% once, rather than staying at an old 95%.
  The 95% below is the old floor; read it as the target.
- **Revise rather than regenerate.** A text under the 95% floor goes back to the model with the
  unknown words named ("replace ทอน, กลิ่น"). At most 3 attempts in total.
- **The closest attempt is kept** (owner's decision, 26 October 2026, so texts don't fail for
  being a little short). If none of the 3 attempts reaches the floor, the one with the highest
  coverage is served, as long as it's at least 85% (`MINIMUM` in `coverage.py`, 90% until 12 November 2026); under 85% the text
  is dropped as before. 90% is where the brief's evidence says listening comprehension already
  varied widely between people. All 3 attempts are still made first, and the prompt asks the model
  to check every word against the list before answering, so most texts meet the floor. The reader
  notes a text under 90% ("fewer than usual") and offers to highlight the words outside the deck,
  each of which has a gloss. Since the texts table records each text's coverage and floor, how
  often this happens can be read from it, and the exit check's median coverage still counts these
  texts as they are.
- **Model:** `claude-sonnet-5-5` at `high` effort (raised from `medium` on 26 October 2026, so more
  texts meet the floor on the first try, at the cost of more output tokens per text), with server-side refusal fallbacks
  (`fallbacks: "default"`). The owner chose Sonnet to start, at half Opus's price; revisit once real
  texts show whether its Thai holds up within the vocabulary. The reply is JSON held to a schema (`output_config.format`): a title,
  roles (who A and B are, like Waiter and Customer, shown above the lines in the reader), lines (speaker, `|`-split text, English), and glosses for words off the list. Revisions are
  appended to the same conversation, never edited, so the model's earlier thinking stays valid.
  `server/reader/src/franki_reader/generator.py`.
- **A stretch word used fewer than 2 times** sends the text back too, even at full coverage.
- **Prompt caching.** The lexicon is the same on every call that day, so it sits in a cached prefix.
- **Glosses come with the text.** The model returns an English gloss for every word not in the
  lexicon in the same response, so a tap never needs its own API call. Lexicon words use the
  deck's `Meaning`.
- **Common words are glossed after the text is written** (13 November 2026). A common word counts as
  known without being in the deck, so the model isn't asked to gloss it, and a tap showed "No
  meaning available" (most of a Norwegian text, whose deck is small). `meanings.py` finds the words in
  a new text with no gloss (the text's, the deck's, or one kept earlier) and has Claude gloss them
  in one batched call, each with the English of a line it's in. The answers are kept per language and
  lower-case word in `word_meanings` and never asked for twice (a word it gave nothing usable for is
  kept empty, not retried). `Engine.top_up` runs the same pass over the 30 newest waiting or read
  texts, up to 150 words a call, so texts written before this are filled in. A failed call waits
  `FAILURE_COOLDOWN` and never keeps a text from being served. The cost is `meanings` in `/api/costs`.
  The deck's meaning wins over a kept one.
- **Word forms** (13 November 2026). The popup's "Dictionary form" line says what a word is a form
  of, not which form. After a text is written (`Engine.fill_forms`, `forms.py`), one Claude call a
  text is given each word that is a form of another (the ones with a dictionary form shown) with the
  line it's in and its English, and picks the form it has there from the language's own list
  (`data/forms/<code>.json`, `form_primers.py`), or `none`. It's per text, not per word like
  meanings, because one spelling can be different forms in different lines (чем is the instrumental
  of что, and also "than"). Code checks only that the answer is on the list for a word that was
  asked about; a wrong note is worse than none, so the prompt says to answer `none` when unsure. A
  word that occurs more than once is asked about at its first appearance. The answers are kept on
  the text (`texts.forms`; NULL until asked, `{}` once asked and nothing fit), so a tap never makes a
  call and a text is asked once. A failed call waits `FAILURE_COOLDOWN` and never keeps a text from
  being served; its cost is `forms` in `/api/costs`. `Engine.top_up` fills the newest 3 texts a pass
  that have none (`BACKFILL_FORMS`), so texts written before this get them. Thai has no list: it has
  no inflection. Each form's primer (what it means, a table of endings, examples) is fixed text
  written once per language, in the repo and reviewed, served by `GET /api/forms?language=`: nothing
  is generated when the chip is tapped. In the app the chip sits after the meaning, and opens a page
  sheet (`ReadFormSheet`) that ends with what the form is in the tapped word. Not done: the marked
  words list (a mark isn't tied to a text) and a card's example sentences show no form.
- **A text's meanings are its own** (13 November 2026, changing "Common words are glossed after the text is written" above). A word was glossed
  once, from the first line it turned up in, and that meaning was kept for the language and shown in
  every later text, so Spanish vino ("came" or "wine"), cara ("face" or "expensive") and sobre
  ("envelope" or "about") showed their first sense everywhere, and the check after reading marked the
  learner wrong for knowing the word. Now the meanings asked for a text are kept with that text
  (`texts.meanings`, by lower-case word, a column added at startup) and shown there, after the
  model's own gloss and before the deck's. Every new text asks for each of its words that has no gloss
  from the text or the deck, whatever was kept for the language, so a text pays for its own common
  words: one call per text when it's written (up to 150 words), never one per word. Answers are
  numbered, so one call can ask for a word in two texts and keep each one's sense. `word_meanings`
  still keeps the first meaning each word got, only as the fallback for a text with none of its own
  (a failed call) and for cards' example sentences, which have no text and still ask once per word.
  The check's word questions take their answers from the text's words as the server glosses them,
  so they use the text's own meaning. The top-up pass now also asks, once, for the words of the 30
  newest texts that only had the language's meaning, so texts waiting to be read get their own sense
  too.
- **Stretch words** are 1-3 words reviewed today or still young. No random assignment.
- **Never a word due today that isn't reviewed yet** (13 November 2026, the owner's decision, from
  brief principles 4 and 9). Reading a due word in context with its gloss, before its Anki review
  that day, turns the review into short-term recall: it's rated Good and FSRS lengthens an interval
  the learner didn't earn, the corruption principle 9 prevents, by priming rather than grading. So
  no stretch pick (the shelf's texts, a story episode, a typed topic, either practice-word setting)
  takes a word with a card due today and not answered today on any device; a word answered today is
  fine and goes first, then young words not due (`stretch.py`, from the snapshot's `due`, `reviewed`
  and `due_in`, Lexicon). A mature word counts only once reviewed today. "Read a text with these
  words" from Review is unchanged: its words were just reviewed. A text already written waits on the
  shelf as it is; its practice words aren't checked again when it's opened.
- **Nor anywhere else in a new text** (13 November 2026, the owner's decision, following the item
  above). While a text is written, a word with a card due today and not answered today counts as not
  known (`Engine.writing_lexicon`, by the same `due`, `reviewed` and `due_in` as `stretch.py`, and
  `snapshot_days` for a snapshot from an earlier day): it's left out of the word list the model is
  given, and the checker counts it as unknown in any form, even where it's also one of the common
  words (spaced.py, japanese.py) or splits into known Thai words (`withheld` in `lexicon_from`). A
  draft that uses it anyway goes back with it named like any other unknown word, and the text's
  stored coverage is the one measured that way. The text's own practice words are never withheld:
  the ones picked are never waiting, and those of "Read a text with these words" were just reviewed
  in Franki, whatever a snapshot read before Franki synced says. Only writing changes: reading a
  text, its glosses and its known or unknown marks, the vocabulary check and everything else that
  reads the lexicon use the snapshot as before, so a text written earlier isn't re-marked. Texts
  already written stay as they are, and cards' example sentences aren't affected.
  - *Prompt cache.* The list is the cached prefix. The withheld words come from the snapshot and
    the study day, so the prefix is the same for every text written from one snapshot on one day: a
    write's revisions and a top-up's texts share it, as before. It changes when the snapshot is read
    again after reviews (which already changed it whenever a tier did) and at the rollover, and a
    "Read a text with these words" text, whose words aren't withheld, has its own. Fixing the
    withheld words for the whole study day was considered and not done: the cache lasts 5 minutes,
    so it would only keep words out after they'd been reviewed.
  - *A heavy review day.* With 150 words due, those are out of the list until reviewed (and until
    a later snapshot shows it). Most are young or recently missed words; the words most texts lean on
    are mature with long intervals, and in every language but Thai the common words carry most of the
    coverage, so the target is normally still reached. A draft that leans on withheld words is revised
    up to 3 times as usual; if none reaches the target, the closest attempt at 85% or more is served
    with the reader's "fewer than usual" note, and under that the text is dropped and the topic waits
    `FAILURE_COOLDOWN`, like any other miss. Nothing waits for the reviews to be done first.
  - *Reviewing first.* So the shelf suggests it: while the language's deck has reviews due, a card
    at the top says how many ("12 Thai reviews due. Review them first, and new texts can use those
    words.") and opens that deck's review (`ReadReviewFirst`, `src/reader/reviewFirst.ts`). The count
    is the deck list's own row, so it never says 12 and opens a deck with none. It's a suggestion,
    never a gate: nothing on the shelf waits for it.
- **Stretch words come back on later days** (brief, design principle 4). A word that was a stretch
  word in a text read on an earlier study day goes ahead of other reviewed and young words, until it
  has been one on 3 different study days (Anki's, in `TZ` from its "Next day starts at"; `study_day.py`)
  (`RETURN_DAYS` in `server/reader/src/franki_reader/stretch.py`). It still has to be reviewed today
  or young, and not waiting for its review, so a word that has matured since is left alone. In "Fit
  the topic" it's offered first, and the model may still pass it over if it doesn't fit.
- **Short stories** as well as dialogues: a "Text type" setting (`form` in `/api/settings`),
  applying from the next text written. A story is told by a narrator (speaker `N`), one or two plain
  sentences a line, and is spoken in voice A. The brief's feasibility test found narrative drops
  coverage faster than dialogue (92.3% against 96-100%), so stories are an option, not the default,
  and the floor and revision loop are the same for both: a story that can't reach the floor is
  served at its closest attempt if that's 90% or more, like any other text. The system prompt describes both forms, so its cached lexicon prefix is shared;
  the request names the form. Each text records its form (`texts.form`), so the log can show
  whether stories rate differently.
- **Story paragraphs.** The model marks the line that opens each paragraph (`paragraph` on a line, stored in
  the line's JSON); `_paragraphs` in `generator.py` makes the marks consistent (the first line opens one
  whenever any line does; a dialogue has none). The reader shows such a story as continuous text: a gap
  between paragraphs and nothing else, no per-line rows, dividers or buttons. Audio stays one file per line;
  the player bar's previous and next line buttons replace the per-line play button, the line being played is
  shaded inside the text, and Show English puts a paragraph's translation under it. Stories written before
  this have no marks and keep the line-by-line view; nothing is rewritten. A "Paragraphs" switch in the reader
  (on by default, kept in the reader's prefs) turns paragraph mode off for a story, giving the line-by-line view.
- **Dialogue length** is a setting: 6, 8 or 12 lines (`lines` in `/api/settings`), applying from the
  next text written. Longer dialogues have more room for unknown words before missing the floor.
- **The model chooses stretch words to fit the topic** (the default). It gets 15 reviewed or young
  words and uses 1 to the current stretch count of them, so a dialogue about ordering food isn't
  bent around "tiger" because tiger happens to be due. The text records the ones it used. A text
  that uses none, too many, or one fewer than 2 times goes back for revision. The other setting,
  "Any word" ("Any due word" until 13 November 2026), hands the model that many words to use, which
  keeps every word in rotation at the cost of odder dialogues. It's a setting on the Topics screen (`GET`/`PATCH /api/settings`),
  stored on the server so background writes follow it, and like ratings it applies from the next
  text written. It's separate from difficulty on purpose: ratings decide how many stretch words and
  how much coverage; this decides only which words.
- **Names.** The model wraps a person's, pet's or place's name in tildes (`~Kasia~|mieszka`). A
  name is left out of the coverage count, for and against, so it never sends a draft back for an
  unknown word. The server limits it so the mark can't be used to get past the floor: at most
  `MAX_NAMES` (4) different names, and in a spaced language each must start with a capital letter
  (`name_problems`). Thai has no capitals, so the limit is all it has. `segment_line` finds a marked
  name's pieces by position, so jasmine written as a word elsewhere in the line isn't a name, and
  joins them into one piece. The app gets that word with status `"name"` and shades it with its own
  color (the Name switch in the reader's key hides the shading; the name still isn't counted).
  Nothing is migrated: a text written before this has no marks and shows as it did.

## Shelf

Changed on 12 November 2026 by the owner: Read & Listen opens on a shelf of texts already written,
in place of a list of topics to pick from and settings to change between texts. The owner found the
topics, favorites and constant setting changes awkward, though the texts themselves were good.

- **The tab opens on the language read last** (`language`), and its header has a menu of every
  language with how many texts each has waiting. Switching changes `language`, so only the language
  being read is ever written for.
- **The shelf writes nothing on its own** (13 November 2026, by the owner: 41 of 65 texts written in
  a month were never read, and each language opened filled its own shelf of 3). It holds the texts
  asked for: a typed topic, Surprise me (`asked`), a practice text, and the ongoing story's next
  episode, which is written once the last one is read. Before this the shelf kept `SHELF_SIZE` (3)
  texts written ahead per language, one each of `due`, `liked` and `new`, refilled every time one
  was read; those texts keep their reasons and show as they did, but none is written any more, and
  the top-up no longer reads Anki every 30 minutes for a due text (the snapshot is daily again).
- **Spending.** A text is written only because it was asked for, in the language being read. Nothing
  waits unread unless it was asked for. A failed text is reported to the next request for its topic
  and that topic waits out `FAILURE_COOLDOWN` before it's tried again.
- **Steering instead of settings.** Press and hold a card for Remove from shelf (the text is taken
  off unread: status `skipped`, counted in the costs). The end of a text has Shorter, Same or
  Longer, which sets the length (`lines`) the next texts are written at. **There are no liked
  themes** (14 November 2026, by the owner): "More like this", "Write more about this topic" and
  the settings page's "Themes you like" are gone, because a liked topic quietly steered everything
  written toward it, and every text should come from something asked for that time. The topics
  table's `favorite` column is no longer read or written, and `PATCH /api/topics/{id}` is gone. A
  text written under the old shelf keeps its `liked` reason, shown as it was.
- **Write one about anything.** A typed topic is written in the background (`/api/shelf/write`,
  with Dialogue or Story chosen there) and joins the shelf when it's ready, beyond the 3
  (`asked`). The owner still picks whenever they want to (brief, principle 10); the shelf only means
  they don't have to every time.
- **Play all** plays the story's next episode and then the shelf, one text after another, with
  background audio. A text whose last line has played is logged as read, unrated, and the next one
  opens. Whether iOS keeps the app running across the gap between two texts with the screen locked
  is unverified.
- **The language's settings page** (the shelf's sliders button) holds what's set once: the deck,
  common words, voices, grammar, the story, practice words, and the progress
  summary (moved off the home screen). The `form` setting is no longer shown: the shelf varies it.

## Stories

Added on 12 November 2026 by the owner, with the shelf: an ongoing story in each language, whose
next episode is the top of the shelf.

- **One active story per language** (`stories`), started from the shelf or the settings page, with
  an optional line about what it's about. Starting a new one retires the old one; its episodes stay
  in Past texts, listed first to last by Read from the start.
- **Continuity is carried in words, not in the conversation.** The first episode's request asks the
  model to invent two to four named characters and a place, and to return the story's name
  (`series`) and its cast and setting (`cast`) beside the text. Every episode returns one sentence
  about what happened in it (`recap`, on the text). Each later episode's request names the story,
  the cast, and the last 12 recaps (`STORY_RECAPS`), so the request stays short however long the
  story runs. All three fields are optional in the reply's schema and asked for only in a story's
  request.
- **An episode is a story-form text like any other**: the same coverage target, revision loop and
  stretch words, filed under the story's own hidden topic. The next one is written only once the
  last has been read, so at most one waits.
- **An episode ends on a choice** (added 13 November 2026). The same request asks for two or three
  `choices`: short options for what happens next, written like lines (`|` between words, English
  beside each) and counted in the text's coverage, so one with a word outside the deck is sent back
  like any other draft. Fewer than two is no choice, and the story carries on as before. They're
  stored on the episode (`choices`, and `chosen`, the index picked) and sent with it as segmented
  words. The app saves the pick when it's tapped (`POST /api/texts/{id}/choice`), which can change
  until the episode is read: reading is what writes the next episode, and its request then says
  "the reader chose X". No pick means no line saying so. A read episode refuses a new pick (409).
  Play all stops at an episode that has choices. Not built: a typed option of the reader's own.
- **Last time is shown in the story's language** (added 13 November 2026). The same request asks
  for `recap_line`: the recap as one line of the story's language, written like a line and counted
  in coverage like the choices, with its own English. It's stored beside the English `recap`
  (`recap_line`, `recap_english`), which stays what the next episode's request carries. The shelf
  sends it as words (`last_recap_line`), and the card shows them to tap, with the English behind
  Show English, hidden again each time the shelf is left. An episode written before it shows the
  English recap.

- **Seasons** (added 14 November 2026). Episodes of one story kept replaying the last one (the same
  characters doing the same thing with a new stranger), because the request only said "something new
  happens". A story now runs in seasons of `SEASON_EPISODES` (8) episodes, worked out from the episode
  number, so a season needs nothing stored but its plan. Every episode returns `plan` (two or three
  sentences on where the season is heading and how its finale ends), kept on the story
  (`stories.plan`, replaced each episode, an episode that gives none leaves the last) and sent with
  the next request. The request says which episode of the season this is, that the next one is the
  finale, or that this one is the finale (resolve the main question, no cliffhanger, the choices
  being what the next season could be about). The episode after a finale opens a new season with the
  same cast and a new problem, and is sent no plan. Every episode's request also says to open in the
  new scene, not retell what happened or repeat a beat from the last episodes. A story that was
  already running has no plan until its next episode writes one.
- **Not the container plot** (added 14 November 2026). With a small vocabulary nearly every text was
  someone opening a box or drawer, finding something, and a stranger arriving to explain it. Every
  request, dialogues included, now says that plot is overused unless the topic is about it, and to
  give the people a want, a choice or a problem instead (`_PLOT_VARIETY`).
- **"Last time" above the text** (added 14 November 2026). The shelf card's recap is also shown at
  the top of the next episode in the reader (`last_time` on `GET /api/texts/{id}`: the previous
  episode's `recap` and `recap_line`), so the episode doesn't have to retell it. It's the shelf's
  `ReadRecap`: the line in the story's language to tap, its English behind Show English.

## Topics

- Topics now sit behind the shelf, and the old topic routes (`/api/topics`, `/next`) stay for
  Review's "Read a text with these words", which asks for a text on the best-fitting idea written to
  practice the words just studied.
- **A text is written in the background, never inside a request.** Three attempts and the audio
  can take longer than an iPhone waits on one request, so `/next` answers 202 while a text is being
  written and the app asks again every few seconds. One write per topic at a time; a request that
  arrives while one is running waits for it rather than starting a second.
- **A failed write is reported once and then cools down.** The next request for that topic gets
  the reason (503 with a sentence). Asking again after that is a deliberate retry. The background
  top-up skips that topic for 30 minutes (`FAILURE_COOLDOWN`) and carries on with the others, so a
  topic that keeps missing the floor doesn't keep spending. Each topic reports its state (`ready`,
  `writing`, `failed`, `idle`) for the app to show.
- A text is stored as `pending` until its audio is made, then `ready`; one left pending by a
  restart is made ready at startup. A text whose every attempt was under 90% is stored as
  `dropped`, never served, so its cost is still on record; so is a first attempt Claude answered
  with nothing usable (a refusal, a cut-off, invalid JSON), as a dropped row with no text.
- A text leaves the queue once a reading is logged for it, rated or not, so the same text is never
  served twice. Only a `ready` text becomes `read`: a dropped or skipped one keeps its status, so
  the costs still count it as what it was.
- **Topic ideas**, so topics don't all have to be thought up. About 30 everyday situations
  (`server/reader/src/franki_reader/suggestions.py`), each with six Thai words it's likely to need, offered on
  the topics screen a few at a time (until the shelf, which now writes from them itself), ordered by how many of those words the deck knows: the best fit
  is most likely to clear the floor on the first try. The owner still picks (brief, principle 10).
  A fixed list rather than generated ideas, so offering them costs nothing. Tapping one adds it as a
  topic and opens it, so trying an idea doesn't start a queue of texts for it. Topics already added, or added and removed, aren't offered again.
- **Removing a topic** (press and hold it) hides it from the list and the background top-up. It's
  a flag on the row, not a delete, since its texts and readings point at it. Adding a topic with the
  same name brings it back, with any text it still had ready. 

## Characters

A dialogue's speakers are shown as small drawn characters instead of the A and B badges (12 November 2026).

- **The model picks, the app draws.** Each text's draft has `characters` beside `genders`: for A and B, one of the keys in `server/reader/src/franki_reader/characters.py` (parent, grandparent, child, friend, waiter, shopkeeper, doctor, teacher, traveler, person), or "none" in a story. The key is stored with the text (`texts.characters`) and sent with its `genders`. An unknown key is dropped, not retried: the speaker shows the badge.
- **The gender picks the version.** A parent is a father or a mother, from `genders`, so there are 20 drawings from 10 keys and no key says a gender.
- **Two alike.** When A and B share a character and a gender, B is drawn with other hair (or glasses, under a cap), in B's own color.
- **Drawn in code, from the theme.** `src/reader/characters.ts` is a list of shapes naming tones; `ReadSpeaker.tsx` paints them in the speaker's colors (gold for A, green for B) with `react-native-svg`, so dark mode needs no second set. `test_characters.py` checks the app draws every key the server can pick.
- **Speakers are named** (13 November 2026). `roles` holds each speaker's first name in Latin letters, with a job first where the situation gives one ("Waiter Luc"); a friend or relative is only a name. Texts written before this keep roles like "Friend". The reader lists them in a card headed "In this text" above the lines, apart from the dialogue.
- **Older texts keep the badges.** A text with no characters, or a speaker with no gender, shows A or B as before. Texts already written are not redrawn.

## Server API

Every `/api` route needs the passphrase as `Authorization: Bearer <passphrase>`; with no
passphrase set, they all refuse. The server reads it as `APP_PASSPHRASE`, which
`server/docker-compose.yml` fills from `READER_PASSPHRASE` in `server/.env`. `/health` is open.
Through Caddy, every route is under `/reader` (`/reader/api/topics`, `/reader/health`). The routes
are listed at the top of `server/reader/src/franki_reader/app.py`.

- A text comes back already split into words by the server, each with its status (known, partial,
  unknown, or none for punctuation), its gloss and whether it's a stretch word. The app never
  segments Thai itself.
- When something isn't set up yet (no API key, no word list), the route answers 503 with a sentence
  the app can show as is.
- The production app is built by `uvicorn --factory franki_reader.app:production_app`, so importing the
  module opens no database.

## Status

`GET /api/status` (12 November 2026) is for another app, not Franki: dundundun's "Franki" task
(fdsimms/flashcards#79). It says what's due in Anki now and whether a Read & Listen text is waiting
in the current language, with when one was last read to the end. Nothing else leaves the server.

- **Its own key.** It opens with the passphrase or with `STATUS_TOKEN` (`READER_STATUS_TOKEN` in
  `server/.env`), a key that opens this route and nothing else, so the other app never holds the
  passphrase that writes texts and spends on Claude and Azure.
- **Anki's own counts** (`status.py`): it syncs, then reads `deck_due_tree`, the numbers Anki's deck
  list shows, review limits included, never a lookalike of the queue. Every deck with something due
  is listed by its full name, and the totals are the top-level decks'. Learning cards coming due
  later in the study day are listed by when, so the other app can place a task ahead without asking
  again. **New cards are left out**: Franki's progress gate is Franki's own, so Anki's new count can
  differ from the one Franki shows. Reviews and learning cards count the same in both.
- **Study time** (`study_days`): the last 7 study days, each with the cards answered on it on every
  device and the time Anki logged for them (the review log's `time`, capped by each preset's
  maximum answer seconds), and the seconds spent in Read & Listen (`readings.seconds`), every
  language. A study day is the 24 hours before a cutoff, as Anki's own statistics count them.
- **Franki's own counts** (`franki`): Anki can't count new cards the way Franki does, so the app
  sends its deck list's totals (`deckListTotals`, the header's numbers) after each recount while
  its "Share today's counts" setting is on (`useCountsReport`, off by default), to
  `PUT /api/franki-counts` with the passphrase. Status shows the last report only when it was
  made since today's study day began; an older one says nothing about today.
- **It only reads**, under the same lock and the same 45-second limit as the lexicon
  (`due_with_timeout`), and a read leaves nothing to send (`tests/test_collection.py`). It writes no
  texts: a shelf that's empty says `waiting: 0`.

## Audio

- **Speakers are read in a voice of their gender.** The model says in `genders` whether A and B are
  a man or a woman (`male` or `female`; `none` in a story), and varies it from text to text: a man
  and a woman, two men or two women. The text is stored with it (`texts.genders`), and
  `gender.voice_for` picks each speaker's voice: A uses the first voice of their gender, and B the
  same unless A is the same gender, when B uses the second. A story's narrator is read in the
  man's voice. A text from before this has no genders and is read as it was recorded, A a man and
  B a woman.
- **Thai's lines are checked against it in code** (`gender.gender_problems`): a man's line with
  ค่ะ, คะ or ดิฉัน, or a woman's with ครับ or ผม, goes back to the model with the line named, like the
  vocabulary check. ฉัน isn't checked (men say it too), and ผม counts only as a whole word, since it
  also means "hair". A draft that fails is never kept, however good its coverage: if every attempt
  fails, the text is stored as dropped. The other languages mark gender in verb endings and
  adjectives, which code can't check reliably, so they rest on the prompt.
- **Voices**: four slots per language (`male`, `male2`, `female`, `female2`), defaults in
  `languages.py`. Thai's man's and woman's defaults can be set with `AZURE_VOICE_MALE` and
  `AZURE_VOICE_FEMALE` in `server/.env`. A language with no second voice of a gender (no second
  man in Thai, Russian, Greek, Polish or Norwegian; no second woman in Greek) reads two speakers
  of that gender in the same voice until one is chosen. Azure's newer Dragon and MAI voices are
  offered in the picker, but none is a default, as they haven't been tried through this client.
  Azure's Multilingual voices (en-US-AvaMultilingualNeural) are listed under one locale but read
  any language, so `GET /api/voices` adds them after a language's own voices and the settings
  accept them for any language (`franki_speech.is_multilingual`); every other voice still has to
  speak the language. This is how Greek, which has one standard voice of each gender, gets second
  voices. The speech request's `xml:lang` stays the voice's own locale (en-US), and since 13
  November 2026 a Multilingual voice is told the text's language with SSML's `<lang xml:lang>`
  (`franki_speech.ssml`; the language's locale is `Language.locale`, its default voices'), since
  left to itself it guesses the language from the text and a short line, or Japanese in kanji
  alone, can read as another. The Thai pause and pronunciation fixes follow the text's language,
  so a Multilingual voice reading Thai gets them too. The `<lang>` form follows Microsoft's SSML
  docs as known, unchecked against a live key; texts recorded before keep their audio until
  they're re-recorded (a voice change).
  Since 12 November 2026 each slot can be chosen in the app (Read & Listen's settings, from
  `GET /api/voices`, filtered to the slot's gender by `voiceSlots.ts`; `PATCH /api/settings`
  refuses a voice of the other gender), stored in the `voices` setting over those defaults. A
  change re-records the texts waiting to be read, and a text already read keeps its audio. Voices
  chosen for speakers A and B before genders were recorded aren't carried over: nothing said which
  gender they were.
- The same server also speaks a card's word for the app (`POST /api/speech`,
  Settings > Voices in Franki), which keeps the MP3 in the note, so each recording is asked for
  once. The app sends the note's language (`speechLangFor`, th-TH) with it, for a Multilingual
  voice; an app from before that leaves it out, and the voice guesses as it did. Its characters
  count under `recordings` in `/api/costs` (Logging). Azure is called through the client shared
  with the MCP (`server/speech`, `franki_speech`, since 12 November 2026), whose docstring says
  which parts of the API were checked; the first real call is the check for the rest.
- In Thai, each space between clauses becomes a 200 ms SSML `<break>` (`THAI_PAUSE` in
  `franki_speech`), since a voice may not pause at a bare space. It applies to the MCP's
  `add_tts_audio` too. Audio already cached keeps no pauses.
- Each line is spoken once at normal speed and cached as an MP3 on the volume
  (`READER_AUDIO_DIR/<text>/<line>.mp3`). A new text gets its audio before it counts as ready; a line
  with no audio yet is made when it's first asked for, which covers texts written before the Azure
  key was set. An Azure failure leaves that line silent and never blocks the text.
- **The word being spoken is lit as a line plays** (since 13 November 2026). Each line is recorded
  through Azure's Speech SDK (`SpeechClient.speak`), which reports when each word starts and ends;
  the REST API it was recorded with before gives audio only. The timings are kept beside the MP3
  (`<line>.json`), and the server matches Azure's words to the line's own (`timing.py`): in Thai
  Azure segments by itself, so a word here takes the time of every one of Azure's it overlaps, and
  two words Azure spoke as one light up together. Each word goes to the app with its `time`; the
  app reads the player's position every 50 ms while a timed line plays (`useSpokenWords`) and fills
  the word's background (`spoken` in the theme), chosen over fading the rest of the line or a
  karaoke-style "read so far". A word stays lit through the pause after it. It's on unless turned
  off in Read & Listen's settings (Listening, `followWords` in `src/reader/prefs.ts`). Where the SDK can't be
  used (a custom `AZURE_SPEECH_ENDPOINT`, the SDK not loading, Azure unreachable over its
  connection) the line is recorded through REST as before, with no timings, and plays unlit. The
  texts waiting to be read when this came in are re-recorded with timings once
  (`Engine.time_waiting_texts`, on the first top-up, behind the `waiting_texts_timed` flag), as the
  owner chose; texts already read keep their audio and play unlit. Slower playback needs nothing
  more: the player's position is in the audio's own time.
- The 0.7x to 1.0x speed control is the player's rate with pitch kept (`expo-audio`), so there's one
  file per line whatever the speed. "Play" runs the dialogue line by line; each line has its own
  replay button. Playback continues with the ringer on silent and the screen locked; the player
  keeps the audio session active between lines, or iOS could suspend the app in the gap. A line
  whose audio fails to load is skipped with a note. Thai plays over other audio (a podcast keeps
  going), as the owner chose.
- The app fetches audio itself, with the passphrase in the request's headers.
- The microphone is used only by Record yourself (below, under Repeat line); a take stays on the phone.

## Logging

- Per text: date, language, mode, token count, verified coverage, stretch words, words glossed,
  words flagged unknown, rating, audio speed, listen-only or not, time spent.
- The rating adjusts the difficulty of texts written after it (too hard: coverage target up 1
  point, one fewer stretch word; too easy: the reverse), within a 90% to 99% target (92% to start) and 1 to 3
  stretch words (`server/reader/src/franki_reader/difficulty.py`). A text already waiting in a favorite's queue
  keeps the difficulty it was written at, so a rating shows up one text later; the owner chose that
  over discarding queued texts (19 October 2026). The Milestone 1 exit check reads the log.
- **A rating steps from the level the rated text was written at** (13 November 2026, the owner's
  decision from a review of the teaching; `after_reading`). Each text stores its target (`floor`)
  and stretch word count (`stretch_count`, NULL for texts written before, whose rating steps the
  stretch words from the current count as before). Too hard leaves the target at the higher of the
  current one and a step above the text's, and the stretch words at the lower of the current count
  and one below the text's; too easy is the mirror. Before this each rating stepped from the current
  level, so three texts written ahead at 92% and all rated too hard moved the target three steps
  before a text at the new level was read. A poor check steps from the text's level the same way.
- A reading posted twice for the same text (a retried request) is counted once.
- Each text also records the model that actually answered (a refusal fallback can change it), its
  tokens and its cost in dollars, dropped texts included, so the real cost per text can be read
  straight from the `texts` table. `GET /api/costs` sums it per language over a number of days,
  and the MCP's `read_and_listen_costs` asks that route (`server/mcp/franki_mcp/reader.py`, with
  `READER_PASSPHRASE` over the compose network), so Claude can answer "what is this costing?".
  Azure's audio is counted as the characters it billed (`audio_chars` on each text, re-recordings
  included, `tts.billed_chars`) and reported as an estimate at a list price per character
  (`tts.AZURE_USD_PER_MILLION_CHARS`), not Azure's bill. Cards recorded in the app
  (`POST /api/speech`) count the same way, under `recordings`, in total only, not by
  language (an older app doesn't say which language a card is in).
- **A call that failed after Claude answered is still counted**, since it was paid for (a refusal, an
  answer cut off at `max_tokens`, one with no text or that can't be read or used). Each feature's
  `...Failed` exception carries the call's `Usage` (`generator.usage_of`), empty when Claude never
  answered, which costs nothing and is recorded nowhere. Where the cost is kept: a dropped text's in
  `texts`, like any other; a failed batch of meanings, vocabulary check words or drill questions as
  a batch row with nothing asked or kept, so no word or point counts as done and it is asked again
  (a drill's failed batch counts toward `BATCHES_PER_DAY`, which is what caps a point whose call
  keeps failing); a failed note-queue batch shared among its words' `cost_usd`, as a good batch's
  is. Explanations, phrases and the naturalness check cache answers only, so a failed one goes in
  `call_costs` and counts under `explanations`; memory hints, which nothing else keeps, go there
  too, failed or not, under `mnemonics`.
- **Dropped:** the brief's randomized experiment (exposed versus held-back words, Anki outcome
  comparison, kill criterion). The owner decided on 19 October 2026 not to build it.

## Build order

1. Coverage checker, with re-segmenting (done)
2. Lexicon snapshot (done; read through AnkiMCP until 11 November 2026, now a sync client of
   Franki's sync server, tested against a real one)
3. Generator (done, tested against a scripted model; its first real call waits on the API key)
4. Reader and login (done; audio controls come with audio)
5. Audio (done; voices and the Azure call unverified until the first real call)
6. Deploy to Fly.io (done; since moved)
7. Move into Franki: the server beside the sync server, then the app's screens (done), then
   retire the ailing repo, its Fly app and the droplet's Anki proxy
8. Mining, practice words after studying, a deck setting per language (done, 12 November 2026)
9. The shelf and ongoing stories, in place of the topics screen (done, 12 November 2026)

- **The prompt ranks sense above coverage** (12 November 2026, after the first Polish text, "A sink,
  a white bird. It's April."): the rules say every line must be something a person would say there,
  with few known words to pick a plain situation, and the self-check reads each line for sense as
  well as vocabulary. Stretch words are optional when the request lets the model choose: if none fits
  a sensible situation with the known words, it uses fewer or none.

- **The vocabulary check suggests the common-words setting** (12 November 2026, the owner's idea, for
  every language but Thai): 20 questions on a language's most common words, from its settings page.
  The server keeps a bank (`vocab_check.py`): `ASKED_PER_BAND` (14) words asked for from each of eight rank bands (1 to 100
  up to 5,001 to 10,000), a fixed sample per language, glossed by Claude once with three wrong choices
  and checked in code (a word it didn't ask for, or a wrong choice that could also be right, is
  dropped). It is written in the background the first time (`GET /api/vocab-check` answers
  "preparing" until then), its cost is in `/api/costs` as `vocab_checks`, and words already in the
  deck are left out when it's served, and so are proper nouns (a capitalized meaning, "Thames") and
  obvious cognates (a word sharing 80% of its letters with its meaning, "legislador" and "legislator";
  `is_giveaway`), since they test nothing. That runs on what's stored, so a bank written earlier is
  cleaned without being written again, and serves every stored word (the extra asked words are slack for
  deck words and giveaways, and the pool a retake draws on). **A retake prefers words not asked before**: the app remembers each language's
  asked words in the Keychain (`rememberSeen`, starting over once all are seen) and `nextItem` takes an unseen word within a band of
  the next one before a seen one. A bank written when fewer were asked for is topped up in the
  background the next time it's served (only the sampled words not yet stored are asked for), while the
  quiz uses what's there. A Russian or Greek word is compared by its Latin spelling
  ("телефон" as "telefon"), with both sides respelled by sound (ph as f, c as k, v as b) and the
  ending left off; it catches "telephone" and "problem" but not looser ones ("president"). **The quiz and its scoring run in the app** (`src/reader/
  vocabCheck.ts`, pure and tested): it starts at the 251 to 500 band, goes up a band after a right
  answer and down after a wrong one or "I don't know", and scores each band with a wrong answer
  taking a third of a right one (a guess among four). It suggests the largest setting at which at
  least 90% of the words it would count as known are likely known, from one curve fitted to all the
  answers (the chance of knowing a word falls with the log of its rank at a fixed slope, so only where
  it crosses 50% is fitted; a wrong answer is partly a guess, a skip is not), and nothing above the
  highest band asked. Each band's own score is still shown, but doesn't decide the suggestion: scoring
  bands one by one (13 November 2026) let one miss in a four-question band outweigh nine right answers
  in the band above it, and suggested 1,000 for a learner who knew about 3,000. The owner accepts it or
  keeps their setting; it never writes a card or changes anything else, except that after a wrong or skipped answer the word can be added to the deck through the note editor (saving is the approval). Each answer is marked right or wrong at once, and the question stays until Next; marking changes no score. The result lists the words missed (wrong or skipped) with their meaning and what was chosen. The 5,001 to 10,000 band was added on 13 November 2026 so 10,000 can be suggested; a bank stored without it is served as it is and topped up in the background with the new band's words. Twenty questions was checked
  by simulation against a learner whose chance of knowing a word falls with its rank: the suggestion
  was within one setting step of the right one 98% of the time (95% at 12 questions, 99% at 40) and
  exactly right 62% of the time (69% at 40), so more questions buy little. Not tried on a real
  learner.

- **The note queue fills in notes from a typed word** (`server/reader/.../note_queue.py`,
  `src/reader/noteQueue.ts`; 13 November 2026, the owner's idea: "I'm never gonna fill these fields out
  by hand"). Quick add takes words, one per line (with the owner's own meaning after a spaced dash), and
  the server's `note_queue` table holds them as `waiting`, `ready` or `failed`. A background pass sends
  the due words to Claude a language and ten at a time, never a call per word, and writes the Meaning
  (unless the owner gave one), a Context sentence with the word in `<b>`, its translation, the
  romanization of the sentence and word in Thai, Russian and Greek (`ContextRomanized`,
  `Transliteration`), and a Register when the word isn't plain. Generate, then verify: a word is kept
  only if it was asked for and its fields pass `check` (one sentence, balanced bold, no other markup,
  no `|`, `*` or em dashes); anything else is `failed` with the reason, never repaired, and a failed word
  is tried again after ten minutes, up to three tries, then waits for the owner's Try again. Which
  words are due is read at each `GET /api/note-queue`, so a server restart picks up where it left off;
  the app asks every few seconds only while some word is waiting (`useNoteQueue`, one poller for every
  screen showing the queue). **Nothing here writes an Anki note.** The server can't write notes or media
  to Anki, and the approval rule stands: a ready word opens in the note editor with its fields filled
  in, and saving there is the approval, after which the app deletes the word from the queue. The Audio
  field is the one the server doesn't write: the app records it as it does for any note when it's saved
  (`src/core/recording.ts`). The spend is the `note_queue` block of `/api/costs`. Not done: PartOfSpeech
  and Gender (their values in the owner's notes aren't written down anywhere to match), a check that
  the sentence uses only known words (it's one sentence, not a text), and a note that says it was
  filled in by Claude in the editor.
