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
  (tested with vitest, like the rest of Franki), the screens are in `src/ui/reader/`, built from Franki's kit and theme.
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
- Each line has a "Show translation" link under its words that shows that line's English alone (tap the English to hide it), so checking one line doesn't
  give away the rest. "Show English" still shows them all.
- **Explain** (12 November 2026, by the owner's decision). Each line has a third round button that
  opens Claude's note on that line's grammar and vocabulary under it: a few points, each a phrase
  from the line and what to know about it, in plain English. "Explain more simply" asks for a plainer
  version. Asked only on the tap (`POST /api/texts/{id}/lines/{n}/explain`, `explain.py`), with the
  line and the whole text (as for a phrase, below: the prompt says to use it only where it sharpens
  a point; it was the lines around it until 15 November 2026), and kept per line and per version in `explanations`, so opening a
  line again or rereading a past text costs nothing. It only shows text: nothing is graded or added
  to the deck. Each call's cost is kept with it and reported under `explanations` in `/api/costs`,
  apart from the texts' figures. A per-word explanation was left out for now (a free-form question
  is asked about a selected phrase, below).
  **Explain is in English** (16 November 2026: the prompts say so outright, since a Russian line got Russian notes). Settings,
  Read & Listen, Explain in the language (off by default) asks for the notes in the language being read, in simple words, for practice;
  a phrase's meaning and literal stay English. The app sends `in_language`; the answer is kept under its own version
  (`simple` 1, `in_language` 2, both 3), so neither overwrites the other.
  Under the explanation, the grammar points the finders find in the line show as chips that can be
  set to Practice, Know it or Don't know it there (docs/grammar.md, step 3).
- **Explain a phrase** (12 November 2026, by the owner's decision, for idioms and set phrases like
  "ya lo sé"). Hold a word and drag to the phrase's last word (13 November 2026, by the owner's
  request; `usePhraseDrag.ts`): the hold starts it, so a quick swipe still scrolls, and the text's
  scrolling is off until the finger lifts; held and let go on the same word, it's a tap. (A word's
  gloss used to have a "Select a phrase" button; 18 November 2026, by the owner's decision, it was taken
  out of the popover.) The phrase is drawn as one band and Claude's note on it opens in a popup beside
  the phrase (on whichever side has more room, its height capped, the notes scrolling): what it means there, then a few points on its parts (a set expression, how the words combine,
  tone), with "Explain more simply". A phrase stays within one line, so the server can check it's
  there. The request carries the whole text (title, every line numbered with its speaker and English,
  the selected one marked; about 0.1 cent more than five neighbouring lines), and the prompt says to
  use it only where it sharpens the meaning (what "one thing" points to), never to retell the text.
  The app sends the phrase as it appears (the pieces joined, spaces
  and punctuation included, `src/reader/phrase.ts`), and the server refuses one that isn't in the
  line. Asked only on the tap (`POST /api/texts/{id}/lines/{n}/phrase`, `explain.py`) and kept per
  phrase and version in `phrase_explanations`; its cost counts under `explanations` in
  `/api/costs`. **Add to deck** on the note opens the note editor with the phrase and its meaning
  in the language's deck, the same approval step and daily limit as a marked word (`mining.ts`),
  and only for a text in the language being read.
- **Ask about a phrase** (18 November 2026, by the owner's request; the owner picked the field
  inside the popup from a mock over a separate chat sheet). The phrase popup has an "Ask a question"
  button that opens a field under the explanation; the keyboard's Send or the arrow sends the
  question and Claude's answer stacks under the explanation, so follow-ups stay in context. While
  the field is open the popup moves to the top and takes what the keyboard leaves
  (`popupSpace`, `src/reader/phrase.ts`). `POST /api/texts/{id}/lines/{n}/ask` (`ask_phrase.py`,
  modeled on Ask Claude about a card) takes the phrase, as for Explain a phrase, and the
  conversation so far, and answers with Haiku given the line, its English and the whole text,
  which the prompt says to use only where it sharpens the answer. The answer is English, or the
  language being read with Explain in the language on. Questions are asked only when sent and are not graded or added to the deck.
  The conversation is kept on the server per phrase for 2 hours after its last answer
  (`phrase_chats`, `store.PHRASE_CHAT_TTL`; 19 November 2026, by the owner's request after a
  swipe away lost one, who wanted the time kept short), so reopening the popup on that phrase
  shows it again (`GET /api/texts/{id}/lines/{n}/ask?phrase=`); expired rows are deleted on the
  next save. Each call
  is kept in `call_costs` (feature `ask_phrase`) and counts under `explanations` in `/api/costs`.
  There are no starter questions. The popup needs the server for its explanation, so with no
  connection the Ask button isn't shown.
- **Register and naturalness** (13 November 2026, by the owner's decision). Texts are written by a
  model, and a line that is grammatical but stiff passes every check in code, so two things show how
  a line is said, and neither grades or adds anything. (1) Each line carries a **register** chip
  (casual, neutral, formal or slang) at the end of its buttons. The generator asks for it with the
  line (`Line.register`, `REGISTERS`, `generator.py`), so it costs no extra call and is kept in the
  text's `lines`; a text written before it, or an answer outside the list, shows no chip. (2) The
  explanation has **Does this sound natural?**, asked only on the tap
  (`POST /api/texts/{id}/lines/{n}/natural`, `explain.py`) and kept per line in `naturalness`, so
  asking again costs nothing; its cost counts under `explanations` in `/api/costs`. It is a second,
  separate call that judges the line as a native speaker with who says it and the whole text (the lines around it until 15 November 2026)
  (a model grading its own draft in the same call mostly approves it), and answers natural, stiff or
  unusual with a reason and, unless natural, what a native speaker would more likely say. That is
  text only: the line's recorded audio is unchanged. Tried and left out for now: running the review
  on every line when a text is written (a cost on every text for lines never questioned), to be
  reconsidered if the taps show lines are often off, and coloring the chip when it disagrees with the
  situation.
- **Register on words and phrases** (17 November 2026, by the owner's decision after a mock). A
  phrase explanation carries `register` (one of the four, or "" when the model isn't sure) and a
  one-sentence `register_note`, shown as a **Register** line (`explain.py`; answers kept before it
  have none). A word's popup shows the same chip beside its title: the deck note's own Register field
  first (`lexicon.normalize_register` maps neutral, formal, informal or colloquial or casual, slang;
  "vulgar", "literary" and the like show no chip rather than a wrong one; kept in `lexicon.register`,
  read with the snapshot), else the one the meanings pass gave the word in its line
  (`texts.registers`, asked in the same call as the meaning, so no extra call). Words glossed by the
  text's writer (off the list) have no chip, and a text whose meanings were asked before this keeps
  none for them. Card example sentences and recaps show none. It only shows text, like the line chip.
- **Check what you understood** (13 November 2026, the owner chose from a mock). After Done, the end
  view offers a few multiple-choice questions, one at a time, each marked at once
  with the line that answers it (its words, English and audio). Three kinds, built when Done is
  tapped (`src/reader/check.ts`, pure and tested; `src/ui/reader/ReaderCheck.tsx`): up to two about what
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
  unchanged (readings before this counted them). A text with fewer than three questions that count (no
  questions about what happens, or one) adds too little, and the check's offer then doesn't say a
  low score makes new texts a level easier. **Poor scores on two texts in a row make new texts a
  level easier** (the owner's choice, changed 15 November 2026 from one text: three answers are mostly
  noise, so the server steers on this text's answers and those of the last text that had a check,
  within 7 days, taken together, `engine.record_reading` and `store.previous_check`): under 60% right
  of at least six between them steps the language's text difficulty one level easier (Harder to
  Standard, Standard to Easier; `difficulty.after_reading`, below). A text counts toward the next
  one's check too. A good score changes nothing, and nothing steps back: only the Text difficulty
  setting does. Nothing is graded or added to the deck. Not done:
  the check on a past text read again (its reading isn't logged), and questions for texts written
  before it.
- **Use the lines yourself** (14 November 2026, the owner chose from a mock). Under the check, the
  end view offers two ways to make the text's lines again, each in place of the end view until it's
  done or stopped (`src/reader/lineDrill.ts`, pure and tested; `src/ui/reader/ReadLineDrill.tsx`): **Say it
  back** shows a line's English (and who says it), to say aloud or type in the language, and **Write
  what you hear** plays a line (at 0.7x to start, 1x a tap away) to type. Check shows the line with
  what was typed against it, letter by letter (`src/core/typedCompare.ts`, shared with Review's Type
  it), plays it, and offers Record yourself and the line's Explain; the reader then marks it Missed
  it or Got it, and a missed line comes back at the end of the round, at most twice. Lines with
  fewer than two words or no English are left out, and Write what you hear needs the line's
  recording. Built from the text's own lines, English and audio, so it costs nothing (Explain asks
  only when tapped, as in the reader), and nothing is logged, sent or graded: the score at the end
  ("right the first time") is shown and forgotten.
- **Listen only** (brief, design principle 6). The end view offers to play a finished text again with
  the Thai hidden (until 15 November 2026 only once it was rated "About right", and the rating is
  gone: below); the lines show who's speaking instead, and "Show the text" brings the words back. The
  reading is then logged with `listen_only` true. A text already read can be played this way too:
  Listen again, below.
  Removed from the end view on 19 November 2026, by the owner: its Listen without the text button
  (the header's remains), Write episode N and Next: title. The end view ends with one button, Back to
  Read & Listen, which still logs the text as read; the story's next episode is written from that, as
  from any other way of leaving. Play all still moves on by itself.
- While audio plays, the text scrolls to keep the line being spoken in view.
- **Repeat line** in the player plays the current line again, for shadowing. One chip steps through
  Off, 2×, 3×, 5× and ∞ (a count is the line's total plays; ∞ goes until turned off). The count isn't
  kept: it starts at Off each time a text opens, and a line started fresh (Play, a skip, a line's own
  replay button) begins its count again.
- **Loop text and Start over** (19 November 2026, the owner: the repeat button was assumed to loop
  the whole story). Loop text, beside Repeat line, plays the text again from its first line each time
  the last one ends (`nextLine`'s `loop`, `wrapsToStart`), and combines with Repeat line (each line
  its count, then round again). Start over, beside Play, plays from the first line with audio, at
  any time. Neither is kept: both start Off, like the repeat count. **Only the first pass counts**:
  the first time round ends it is the text played through (a listen-only past text counts as heard
  again), but with Loop text on Play all stays on this text instead of moving to the next shelf text,
  and later passes count nothing, so looping can't pad the Listen again schedule. The mini-player
  carries the loop on when the reader closes (`Handoff.loop`), but passes over a line with no sound
  rather than around to the first. The three icons are drawn (`PlayerIcons.tsx`), since SF Symbols
  have no pair that tells one line from the whole text.
- **Record yourself** in the player, beside Repeat line, records the line playing or last played
  ("Record line 2"), pausing playback; Stop (or 30 seconds) ends the take and plays it back. Yours
  replays it, Compare plays the line as it was played and then the take, either stops while it plays, and
  the line's own buttons replay the native line. One take at a time, for that line
  only: moving to another line or closing the text deletes it, and it's never sent to the server.
- **Past texts**: texts read to the end, newest first (the last 50), opened in the same reader to
  read or listen to again. Reading one again isn't logged: the log is one row per text, and a reread
  shouldn't count toward the exit check or move difficulty. So there's no Done or rating, and words
  can be looked up but not marked unknown. Any past text with audio can be played listen-only, whatever
  it was rated (15 November 2026, below); each row also has a headphones button that plays it that way
  without opening it to read.
- **Listen again** (15 November 2026, the owner chose from a mock). Hearing a text again a few days
  later, with the words hidden, is the spaced, repeated listening the research supports, and by then
  it's easy to follow, so the listen-only gate (rated "About right") is lifted for a text already read.
  The shelf shows a Hear again row ("2 texts", with a play button and Not now) for the finished texts due, up to three at a
  time, oldest first, and let go 30 days after it was read (`relisten.py`, `GET /api/relisten`).
  **How often is a setting, Hear texts again** (15 November 2026, the owner's: reading a new episode
  every day, three more listens each is a daily pile, and the research gives 3 to 4 passes for
  drilling one passage, not for every text, while words are learned across many different texts):
  **Once** (the default; 3 study days after it was read), **Three times** (1, 4 and 10 days) or
  **Never**. The app sends it as `listens`, and a single listen comes a few days on, not the next
  day, since the gap should grow with how long it's to be remembered. A text heard as many times as
  the setting wants is done, so changing it later doesn't bring old texts back. Play runs them one after
  another in listen-only (the reader's `past` source with `listen`: the texts still to come, so the
  Back button returns to the shelf). A text played through to its last line with its words hidden, from
  the card, a Past texts button or the text's own Listen without the text, is counted
  (`POST /api/texts/{id}/listen`, the `listens` table); that's all it does. **It is not a reading:**
  nothing is logged to `readings`, no rating, no check, no difficulty change, no coverage figures, and
  nothing grades a card (`tests/reader/noGrading.test.ts`). Not now hides the card until the shelf is
  opened again; a listen cut short isn't counted, so the text is offered again.
- **Listen before reading** (15 November 2026, the owner's idea, a setting in Settings, Read & Listen,
  Listening; off by default). A new text opens with its words hidden, as in Listen only, and the words
  appear once every line with audio has played to its end (`src/reader/listenFirst.ts`: the lines
  heard are tracked per text, so playing them one at a time works too, and a line with no sound isn't
  waited for). The reasoning: hearing a text before reading it is listening practice with no
  spelling to lean on, and the words then show whether it was understood, which is feedback. It is
  hard at the lowest coverage target, 95%, which is what the listening research asks for, so it's
  opt-in and **Show the text now** skips the wait (it is also the way out when a text's audio won't
  play). It applies only to a new text: a past text has its own Listen without the text, and Play all
  is unchanged. **It isn't listen-only in the log:** the reading is logged as an ordinary reading
  (`listen_only` false), since the words are read once they appear. Lookups can only happen after
  the words show, so effective coverage (`recognition.py`) reflects words met after hearing them.
  **Listen twice first** (15 November 2026, a second switch shown with the first, off by default):
  the words wait for every line to play twice (`listensNeeded`, `allHeard` counts each line's plays), the
  usual "double play" for listening practice. The gate's text says "twice", and a line replayed on
  its own or by Repeat line counts each play, so the second listen need not be a second pass from
  the top. Show the text now still skips it. These listens are part of the first reading: they
  don't count toward the 1, 4 and 10 day Listen again schedule, which starts the day after.
- **Guess first** (15 November 2026, the owner chose from a mock). A tap on a word shows its meaning
  only when asked for (Settings, Read & Listen, Meanings, on by default), so the learner tries before
  being told: a word counted as known is recalled. **A word outside the deck (or only inside a longer
  phrase) shows its meaning at once** (16 November 2026): it first asked for a guess from the line,
  with a box for a typed one, and the owner found being made to guess before looking up annoying.
  The hint is "Try to remember it first."; a name and a word with no meaning to show open as before (`src/reader/guess.ts`,
  `ReadWordGuess.tsx`). A second setting, **Quiz me on words I know** (off by default, shown with the
  first), replaces the Show meaning row on a known word with four choices (its meaning and three other
  glosses from the text, as the check after reading builds them) and I don't know: any answer keeps
  the popover open with the choices as a record, the right one marked with a check alone (with a
  haptic, no bounce; the other choices fold away at once) or "Meaning" and a wrong pick marked with an X alone (19 November 2026: "Your pick" crowded the row; 16 November 2026, the owner:
  a right answer used to close it, so the meaning was never seen). A text with fewer than three other glosses has no quiz. **A lookup is logged when the meaning
  is shown**, not at the tap (`Session.glossed`), so a word recalled isn't counted as looked up, which
  keeps effective coverage (`recognition.py`) honest; marking a word unknown shows its meaning too.
  A right quiz answer is no lookup, but every answer is kept on the reading, by word, as
  `quiz_right` and `quiz_wrong` (`Session.quizRight`, `readings.quiz_right`; the latest answer to a
  word wins), a record only: nothing reads it yet, and a wrong one or I don't know is also a lookup.
  Nothing is graded or added to the deck, and a card's example
  sentence and the shelf's practice-word popovers are unchanged.
- The reader's playback speed and the highlight switch are kept between launches, in the Keychain
  next to the passphrase (`src/reader/storage.ts`).
- **Progress** on the language's settings page (on the topics screen before the shelf): finished texts over the last 14 days with their median coverage and
  the check after reading's score (no goal is set; the Milestone 1 exit check's 10 texts was dropped), and
  the coverage target and practice word count new texts are written at. The language's settings page
  also has the Text difficulty choice. Only finished readings count.
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
- Finishing a text (tapping Done) logs the reading once, which takes it off the ready
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
  `effort: medium` (raised from low on 15 November 2026, since a wrong verdict teaches the wrong
  thing); the cost is `production` in `/api/costs`, failed calls included. The app draws the
  correction against what was typed with Review's own comparison (`src/core/typedCompare.ts`).
- **Use today's words** (`src/ui/reader/ReadUseWords.tsx`, the `read-use-words` route): offered at the end
  of a review session of a language's deck while Read & Listen is on, with the notes answered while
  new in it (`wordsToUse`), one at a time, to write a sentence with. Placed after the session rather
  than on the answer side (the owner's choice): it doesn't slow reviewing, and recalling the word a
  few minutes later is the better practice.
- **Retell it** (`POST /api/texts/{id}/retell`, `src/ui/reader/ReadRetell.tsx`): the third row of the end
  view's "Use the lines yourself". The same check, with the text's lines and English sent, plus up to
  four words from the text the retelling could have used (each kept only if it is in the text and not
  already in the retelling, with the line it's in, which a tap shows and plays) and what it left out.
- **Sentences** (`sentences.py`, `POST /api/sentences`, the Practice tab's Sentences tool): an
  English sentence built around a word, to say or type, then compared with the sentence written for
  it; Check mine asks the check above when one's own wording differs. The words are a text's stretch
  words' (`pick_stretch`): the most fragile young words first, then those reviewed today, **never one waiting for its review**,
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
- **Their lines are spoken by the phone's voice by default, and by Azure when the owner turns it on**
  (15 November 2026; before this it was always Azure, the owner's first choice over the phone's voice).
  The phone's voice is the one chosen for the language (Settings, Voices; `lineSpeech`), so a reply
  arrives as soon as Claude has written it and costs nothing, and Slow is the chosen speed times 0.8,
  made by the voice itself. The setting is `situationsAzure` in `src/reader/prefs.ts` (Settings,
  Read & Listen, Situations), off by default, for a language whose phone voice sounds too poor. The
  app sends it as `speak` on each turn, so the server records and bills nothing while it's off. With it
  on, the line is spoken in the language's voice for their gender, as each arrives, and kept as a clip
  for two days (`ClipCache`, `GET /api/situations/audio/{key}`) so a replay costs nothing. A line with
  no clip (Azure's voices off, or a failed recording) is read by the phone, so its button always plays.
  Slow with Azure on is `POST /api/situations/slow` (`{language, gender, line}`), a clip of its own
  (`tts.SLOW_RATE`) recorded the first time and billed like any recording; if it can't be made, the
  normal clip plays stretched to 0.65. "Heard only" hides their words behind Show the text.
- **The owner's lines** may hold an English word in [brackets] for a word they don't know; Claude
  answers as a helpful native speaker would. No correction during the conversation.
- **Finish** (`POST /api/situations/feedback`): each of the owner's lines with a verdict, the line
  with only its mistakes fixed (brackets put in the language) and a note, and up to six words worth
  adding, each kept only if the deck doesn't know it and, for a word heard, if it was in their lines.
  **Add** puts a word in the note queue (Quick add's), where it's filled in and saved, or not, in
  the note editor: nothing reaches the deck without that.
- **Cost:** `situations` in `/api/costs`, Claude's calls (failed ones included) and Azure's estimate
  for the lines spoken. No daily cap (the owner's choice); the costs page shows it.

## Audio lessons

Decided 15 November 2026, the owner's idea: a guided audio course in the manner of a prompt-and-answer
language course, for the car or a walk. French first, as an experiment, then Thai and every other language but English, whose
speaker is the narrator (`LESSON_LANGUAGES` in `lesson_service.py`, and the app's in `src/reader/lessons.ts`; another
language written with spaces needs only its voices). Thai and Japanese have no spaces, so `lesson.tokens` cuts Thai into
words with newmm and Japanese as the reader splits a line (`japanese.words`), for pauses and for checking mixes; their
parts are joined with no space; Japanese's request asks for kanji and kana, never romaji, and the polite です/ます form
(Japanese added 17 November 2026, the owner's decision); and every phrase carries the learner's chosen polite particle (ครับ or ค่ะ, below). Not a replay of the
texts: a lesson teaches 3 to 5 new phrases on a scene the owner types ("ordering a coffee"), from
outside the deck. Nothing here grades a card or writes a note (the deck is read only for the dialogue's
vocabulary check, below); what the learner says
aloud is never heard by the phone.

- **Claude chooses the content; code builds the lesson** (`lesson.py`). Claude writes a title, a
  short dialogue and the phrases to teach, each split into parts (`lesson_writer.py`). Generate, then
  verify: a phrase is kept only if its parts, put back together, are the phrase, and a plan with fewer
  than 3 kept phrases is asked for again once, then fails. Everything about how the lesson runs
  (`build_script`) is code, so the spacing is exact and the narrator's English is fixed text:
  the dialogue is played once; each phrase is said, its meaning given, built up from its last part
  to the whole (backward build-up) with a silence after each step to repeat, then asked for in
  English with a silence to answer; earlier phrases are asked again after 1, then 3 more phrases
  are taught (a recall the phrases run out before reaching is dropped, 18 November 2026, the owner: the closing pass felt like the same question over and over). Five phrases make about four to five minutes.
- **The lesson builds on itself** (16 November 2026, the owner: it felt like five separate phrases).
  The phrases are written as a ladder in the order they come up in the dialogue, each reusing words
  from an earlier one. After the last is taught, up to 3 `mixes` are asked: new sentences made only
  of words from the taught phrases (`clean_mix` drops one with any other word, since the model
  doesn't always keep to it). The lesson then closes with a role-play instead of replaying the
  dialogue: the learner is the first speaker, the narrator gives each of their lines in English,
  a silence follows and the native voice answers; the other speaker's lines are played.
- **The role-play never asks for what wasn't taught** (18 November 2026, the owner, after a lesson on "can you say that again", "soon" and "don't forget"): the narrator said "first speaker" while speaker B opened the conversation, a "put them together" sentence was just "soon, don't forget", and the role-play asked for A's lines the lesson never taught. Now the request has A speak first, and the narrator says "first" or "second" as the dialogue really runs (`_role_play`). A line of A's made only of words the phrases taught is asked cold; any other is said by the native voice first and then repeated in a silence, with one narrator line saying so. A lesson on the learner's own words drops a mix that is only whole phrases in a row (`_is_phrases_end_to_end`; not applied to written lessons, whose phrases can make a sentence), and both requests say a mix is one complete sentence a person would say. The request also keeps A's lines short and built from the phrases.
- **Each phrase does a different job** (18 November 2026, the owner: "How Are You?" came out as "how are you" said over and over). A narrow scene gave four phrases that were one question with a word added, and every phrase is heard many times (taught, built up, asked, recalled), so the repeats filled the lesson. The request now asks for different jobs (ask, answer, ask back, react, thank), reaching to what comes before and after a narrow scene, and the ladder rule asks for at least two words the earlier phrases lack. Prompt only: a code check on word overlap was tried and flagged real ladders ("Please" then "The check, please"), so it was dropped.
- **A lesson can teach the learner's own words instead** (18 November 2026, the owner's cram: words
  from a tutor lesson, to use at the next one). `POST /api/lessons` takes `phrases` (each a card's
  word and meaning, up to `lesson.MAX_GIVEN`, 15), and the scene is then the situation they're for (the
  cram's name). Claude still writes the title, the dialogue (up to `MAX_GIVEN_DIALOGUE` lines, to fit
  more of them), the parts and the mixes (`lesson_writer.write_given_plan`), but the code decides what's
  taught (`lesson.clean_given_plan`): every given phrase, as the learner has it and with their
  meaning, with Claude's parts only where it wrote the phrase back exactly, and any it left out or
  changed taught whole at the end; phrases Claude added are dropped. A Thai phrase isn't sent back for
  lacking ครับ or ค่ะ, since it's the learner's own word; the speakers' lines still are. The app
  keeps the lesson's id in the cram (`Cram.lesson`) and offers to make it again once the words change.
  The Lessons tab asks the same way (18 November 2026, the owner's request): the New lesson card's
  "Words to teach (optional)" row takes up to 15 words, chosen from the decks (`LessonWordPicker.tsx`: the
  language's notes, newest first, or only those due today or lapsed, searched by word or meaning; what's
  offered is what `lessonPhraseOf` would send) or typed in (`LessonWordAdd.tsx`, for a tutor's or a book's
  words; never saved as a note). The draft is per language and held in memory (`useLessonWords`), emptied once
  the lesson is asked for, and `core/lessonWords.ts` refuses a blank, too-long, repeated or sixteenth word with
  the reason. The scene stays required: with words it's what they're for. With none chosen, Claude picks the phrases as before.
- **Claude can suggest the scene** (18 November 2026, the owner's request). A "Suggest topics" link under the New lesson card's
  scene field (`LessonTopics.tsx`) shows four short scenes as chips; tapping one fills the field and nothing is made until
  Make a lesson, and "More ideas" asks again without repeating. `POST /api/lessons/topics` (`lesson_topics.py`, one small
  Claude call, the cheap model) is given the language, the words chosen (so the scenes are where they'd come up) and the
  scenes of lessons already made plus the ideas already shown; `clean_topics` keeps the usable ones in code (trimmed, at
  most 60 characters, none repeated or taken). Claude only: without it, or when it doesn't answer, the link shows the
  reason and Try again, and the fixed ideas of `suggestions.py` (Situations' scenes) are not used instead. The ideas are dropped when the
  language or the words change. Its cost is kept in `call_costs` as "lesson_topics" and is the `lesson_topics` block of `/api/costs`, apart from `lessons` so a suggestion isn't counted as a lesson made.
- **A typed word is confirmed before the lesson speaks it** (18 November 2026, the owner: romanization typed in Add a word was spoken completely wrong, and word plus Meaning boxes felt like inventing words; then "it shouldn't be only for Thai"). The voice reads what it is given as the language's own writing, so romanization came out as noise. In every lesson language Add a word (`LessonWordAdd.tsx`) is one box that takes romanization, the language or English; **Find word** asks `POST /api/lessons/words` (`lesson_words.py`, Haiku, one call per tap), which lists up to five real words it could be, each in the language's own writing with its reading (Thai's romanization with tone marks, Russian's and Greek's romanization, Japanese's kana; empty for the Latin-script languages) and its meaning. The learner picks one and that word and meaning join the lesson, so there is no meaning to type. `lesson_words.clean` drops a candidate with none of the language's script, or, for Thai, Russian, Greek and Japanese, one with a Latin letter, since that is the romanization handed back as the word; a repeat and one without a meaning go too. A word already written in the language goes through the same list, so it is shown once for confirmation (and a misspelling is corrected). The cost is kept in `call_costs` (feature "lesson_words"); nothing here is a card or a rating.
- **Thai lessons are made for the learner's polite ending** (16 November 2026, the owner: a man's voice said ฉัน, and no phrase carried ครับ or ค่ะ). The lessons screen has a ครับ / ค่ะ choice for Thai, kept on the phone (`lessonStorage.ts`) and sent as `particle`. It sets `learner` (`lesson.Learner`): the voice every phrase is repeated after, who plays A in the dialogue and role-play, and the particle every taught phrase carries. The request says so, and `lesson_writer.thai_problems` checks it in code (a phrase without the particle, the other gender's particle, or a man saying ฉัน or a woman ผม sends the plan back once, and a second miss fails the lesson). Replaces the earlier rule that left ครับ and ค่ะ out of the phrases taught.
- **The voice slows down while a phrase is taught** (17 November 2026, the owner's request). The native voice's clips inside `_teach` (the first "Listen." hearing and each repeat-after step) are `Say(..., slow=True)` and spoken at `lesson.TEACH_RATE` (0.8). Asking for a phrase, its answer, the dialogue, the role-play and the narrator stay at normal speed, so the learner still hears natural speed. `slow` is part of a clip's identity, so a phrase heard slowly and then asked for normally is two recordings (a little more Azure billing); the last build-up step and the first hearing are the same slow clip and are spoken once. A lesson made before this keeps its old audio.
- **Silences are sized to the phrase** (`pause_ms`: 2 s plus 0.7 s a word, 3 to 15 s), so a longer
  phrase gets longer to say. They are baked into the audio, so they can't be adjusted after the
  lesson is made. Chosen over a phone that times each clip because one MP3 plays with the screen
  locked, in a car, with the lock screen's controls, and a stall between clips can't happen.
- **Wait for my answer** (18 November 2026, the owner's request): a switch on the lesson's screen and
  in Settings, Lessons (the same setting, kept on the phone, off by default so a lesson still plays
  straight through in the car). On, the lesson stops at each place the learner speaks (each
  repeat-after step, each "How do you say", each line of theirs in the role-play) and goes on when
  they tap Continue, which skips the rest of the silence so the answer plays at once. The MP3 is
  unchanged: the script marks those silences (`Silence.answer`, `lesson.answer`), `render` keeps
  where each falls (`pauses`, start and end in milliseconds, in the lessons table and in
  `GET /api/lessons`), and the app pauses the shared player on reaching one (`lessonWaits.ts`,
  `useLessonWaits`, the owner chose the layout from a mock: the play button becomes Continue, with
  "Your turn" above it). A lesson left while it waits carries on in the mini-player, which says
  "Your turn"; Play there or on the lock screen goes on as Continue does, and skipping back or forward
  lets the wait go. A lesson made before pauses were kept has them found by length the first time the
  list is read (`lesson_audio.find_pauses`, in the background: an answer silence is at least 3 s and
  every other gap at most 1.4 s, so a quiet run of 2.7 s is an answer's), and its pauses are null
  until then. Kept lessons are brought up to date from the list, so the found pauses reach one
  played offline. Nothing the learner says is heard: Continue is the only signal.
- **Turns, the transcript, reviews and cards** (18 November 2026, the owner chose all five from a mock):
  - **The transcript** (`lesson.script_of`, the `script` column, `script` in `GET /api/lessons`):
    each thing said and each turn, with its start and end in the MP3. A turn says what the learner
    is to say (the native line after a question, or the line just heard for a repeat), its meaning
    where it's a whole phrase, and `replay`, where its prompt starts. The player shows what's been
    said so far (`LessonTranscript.tsx`), so an answer stays hidden until it's said, and a tap on a
    line goes back to it. A lesson made before transcripts has none, and the row says so.
  - **Again** at a turn plays its prompt once more and notes the phrase for a review.
  - **Carry on when I stop talking** (with Wait for my answer): at a turn the lesson waits at, the
    microphone's level is read (`voiceEnd.ts`: the room's quiet measured first, then speech, then
    0.9 s of quiet), and the lesson goes on as Continue would. Only the level, never the words, so it
    works in every language and nothing leaves the phone; chosen over the iPhone's recognizer, which
    sends some languages to Apple and needs its own permission.
  - **Play my answer back**: the answer is recorded at each turn (the lesson's own silence when not
    waiting) and played once the native voice has given it (`lessonScript.takeAfter`), then the
    lesson goes on. The take is in the caches folder until the next turn, never saved or sent.
    Either microphone setting keeps the lesson's audio session allowing recording for the whole
    lesson (`lessonAudioMode`), since iOS won't start a recording in the background otherwise; that
    puts Bluetooth headphones in call quality, which Settings, Lessons says.
  - **Reviews**: Again, and an answer that took longer than the lesson's own pause (under a minute,
    or the learner was away), note the turn's phrase (`POST /api/lessons/{id}/marks`, the
    `lesson_marks` table; a part being built up isn't noted). With 3 or more noted, the Lessons tab
    offers a review (`LessonReviewCard.tsx`), made when asked for like any lesson: up to 12 phrases,
    each asked, then all again in the other order (`lesson.build_review`), with no Claude call. Its
    phrases are then taken; one noted again after its review waits for the next. Never a rating.
  - **Add to deck**: after a lesson (and from its screen), the phrases are offered for the language's
    deck, those already in it marked (`lessonCards.ts`), and each chosen one opens in the note editor
    with its meaning and the lesson's recording of it, cut from the MP3 by the server
    (`GET /api/lessons/{id}/phrases/{n}/audio`, the answer to its question at normal speed). Saving
    is the approval; a recording for a phrase not saved is deleted again.
  - **Open risk**: none of this has run on a device. Recording and reading the level with the screen
    locked, and the level thresholds in a car, are untested.
- **One MP3 per lesson** (`lesson_audio.py`, `<audio dir>/lessons/<id>.mp3`). Each distinct clip is
  spoken once by Azure (the narrator in an English voice chosen for the lesson, else the settings'
  English male voice; the dialogue's A and the teaching in the language's male voice, B in its female
  voice, as chosen in settings), leveled with
  `franki_speech.loudness`, laid end to end with generated silences as raw 16-bit audio, and encoded
  by ffmpeg. The server image installs ffmpeg for it.
- **The narrator is chosen per lesson** (15 November 2026, the owner's request): `POST /api/lessons`
  takes an optional English voice (`narrator`, checked by name only, `is_narrator_voice`), kept on the
  phone (`lessonStorage.ts`) and picked on the lessons screen's Narrator row. English is hidden from the
  app's language list, so its voice slots can't be reached, and a per-language slot would have
  widened the voice code for one use.
- **Made in the background** (`lesson_service.py`): `POST /api/lessons` adds a row in the `lessons`
  table (`making`) and returns its id; the row becomes `ready` or `failed` with the reason, and the
  app polls `GET /api/lessons` while any is making. At most 2 are made at once. A row still `making`
  when the server starts was cut off by a restart and is marked failed.
- **Cost**: one Claude call (two if the first plan isn't usable) and Azure's characters for each
  distinct clip, about 600 for five phrases. Its figures are the `lessons` block of `/api/costs`.
- **Open risk**: Azure's request shapes are unverified against a live key, as for the texts' audio,
  and the narrator's English voice and the Multilingual `<lang>` handling haven't been listened to.
  The first real lesson is the check.
- **In the app** (the owner chose the layout from a mock, 15 November 2026): the Lessons tab (an
  Audio lessons row on the shelf until 17 November 2026, Shelf, Browse), for the language Read &
  Listen is reading, saying so when the server makes no lessons in it (`lessonsOffered`, mirroring
  `LESSON_LANGUAGES`), is a list with a scene field (`ReadLessons.tsx`; it asks again
  every 5 seconds while one is being made, and tapping a failed one offers to delete it). A lesson
  being made shows its steps (`LessonMakingRow.tsx`: writing, recording, joining), from the row's
  `stage`, which the server sets as `make_lesson` goes (`lesson_service.py`); a server from before
  stages sends none, and the row shows the first step. A ready
  lesson opens its player (`ReadLesson.tsx`): play or pause, skip back or forward 15 seconds to hear
  a phrase again, Start over, Loop (19 November 2026, the owner's request: played to its end, the
  lesson starts again from 0:00; `useLessonLoop.ts`, kept on the shared player so it holds in the
  mini-player, off each time a lesson opens unless it's the one playing), the lock screen's controls, and the phrases and conversation behind a row, hidden
  until asked for so the lesson can be heard first. Background playback is on only once it plays; playing it stops Play all on the mini-player, and only opening it leaves Play all going. **A lesson plays on the reader's shared player** (`useReaderPlayer.tsx`, 18 November 2026, the owner's request): leaving the lesson while it plays hands it to the tab bar's mini-player (title, play or pause, back and forward 15 seconds, stop), a tap on the pill reopens the lesson where it is (`resumeLesson`), and the reader or another lesson playing takes the player back and stops it. A paused or finished lesson stops on leaving, as the reader does without Play all. The listening Live Activity (lock screen and Dynamic Island, `targets/listening-activity/`) has Start over and Loop on either side of its back, play and forward buttons, for a text or a lesson alike, with Loop filled while on.
- **The dialogue is held to words the learner knows** (16 November 2026, the owner: the closing
  dialogue was made of words never taught). It is played first and acted out last, so
  `lesson.unfamiliar_words` checks each line against the deck's checker (`engine.snapshot`: studied
  notes plus the language's common words) and the phrases taught. A line may hold 2 words that are
  neither (a name, the scene's one noun); a dialogue with a line over that goes back to Claude once,
  naming the words (`lesson_writer._RETRY_WORDS`). If no attempt is clear, the usable plan with the
  fewest such words is kept rather than no lesson. Claude isn't given the learner's word list, only
  told to keep to the phrases and very basic words, since the retry names what to replace. The deck
  is only read: nothing is graded or written.
- **Not done**: other languages, a seekable scrubber, and adapting the phrases taught to what the
  learner already knows. Not run on a device yet: the lock screen controls and background playback
  are untested.

## Cram themes

Themes to talk about at a lesson with a tutor (19 November 2026, the owner: from a video on preparing for tutoring, "a way to help generate themes to talk about"). On a new cram's sheet, "Suggest themes" (and "Plan the next lesson" on the cram list, once a cram is finished) opens Theme ideas: three themes, each with a title, a reason, chips for the words it reuses (from last time, missed, recently added) and new words, and counts. A theme opens to its words, common words the deck lacks (a + sends one to the note queue), questions to steer the lesson with (tap to hear) and "Things to say", a short story built from the owner's words that can be edited and listened to. "Use theme" fills the cram's sheet: the title is the name, the theme's deck words are the first words, and the questions and story are kept on the cram (`Cram.theme`, shown on its page).

- **The app picks the seeds, the server writes, the code checks** (`src/core/cramThemes.ts`, `cram_themes.py`). The phone sends up to 60 studied words in the language, each labeled why it's on offer (the last finished cram's unused words, missed in the latest cram's last round or tagged leech, added in the last 14 days, else just studied), the Practice tools' live misses as lines ("Telling the time: band:thum"), and the titles to avoid (every cram's name and theme, and the ideas already shown). The server adds the common words the deck lacks (`word_suggestions.suggest`) and sends Claude both lists numbered. Claude answers with numbers, so only a word really in a list can be named; a new word takes the list's meaning, else Claude's. Questions and the story are kept only when written in the language's own script (`lesson_words.is_written`, shared with Find word). A theme with no words or fewer than two questions is dropped, not repaired.
- **Cheap model, one call per tap** (`CHEAP_MODEL`, effort low; cost kept as "cram_themes" in `call_costs`, its own block in `/api/costs`). It's asked when Theme ideas opens, on Show different themes, and when Comfortable/Stretch changes; never in the background.
- **Nothing here grades or writes.** A theme's words are only tagged when the cram is saved (the cram's own tag, as any cram), a word to learn is only queued, and the notes it becomes are saved in the note editor, where saving is the approval. The ideas and the picked theme live in memory (`themeStore.ts`) and go when the sheet closes.
- **Rehearse in Situations** (19 November 2026, the owner: "cram should be intertwined with the situations practice feature"). A cram's page and a theme's page have a Rehearse row: Situations opens on the cram's title (or the theme's) as the scene, and `POST /api/situations/turn` takes `words`, up to 15 "word (meaning)" strings (`rehearsalParams` and `rehearsalOf`, `src/reader/situations.ts`). The turn's prompt asks the other person to work them in where the scene allows and never to require, list or explain them; the existing check on their lines is unchanged. The scene screen says "Leaning on N words from this cram", with Start and Pick a different scene. Play it again keeps the words.
- **Keep these** (`src/reader/corrections.ts`, `correctionsStorage.ts`). After a rehearsal's How it went, "Keep these" stores the lines that needed a fix (what was said, the correction, the note) in `kept-corrections.json` in the documents folder, on the phone only, up to 30, none older than 60 days, and only when tapped. Theme ideas adds the newest four for the language to what Practice has been missing, as lines like `Mistake in a rehearsal: said "X", corrected to "Y"` (`combineWeakSpots`: Practice's up to four first). Those lines go to Claude with the theme request, as the lines already do in Situations. Nothing is added to the deck or graded.
- **No personal data as a seed**: a journal or the calendar is never sent; the seeds are the deck, the rounds and Practice only.

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
- **Score it was removed** (16 November 2026, the owner's decision; don't bring it back without new
  evidence). It sent a Record yourself take to Azure's pronunciation assessment and colored each word
  by its score. Tried on a Thai word said with no tones at all, it gave 100 for sounds, flow and words
  said: Azure scores phonemes, and a Thai tone isn't one, so the feature showed green where tones, the
  hardest part for a learner, were wrong. Its leniency in other languages was never measured. A score
  that can't say a take is wrong is worse than none, so it went from every language. Record yourself
  stays: hearing your take next to the recording, which never leaves the phone.

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

- A note's tier comes from its weakest reviewed **reading or listening card**, its Front and Audio
  cards (15 November 2026, the owner's decision from a review of the learning science): **mature**
  if the lowest interval is 21 days or more, **young** if reviewed but below that, **unreviewed** if
  no card has been reviewed (`server/reader/src/franki_reader/tiers.py`). The Reverse card (English to
  the word) is production, which says little about whether a word is recognized in a text, and used to
  hold a word young while its Front card was long mature. When a note has no studied Front or Audio
  card, all its cards decide, so a word studied only from English still counts as studied. What
  counts as known for coverage is unchanged (any studied card). The tier picks stretch words and marks
  M or Y in the model's list; `Entry.stability` is read from the same cards. A suspended card is
  left out first, as below.
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
- **Transliteration** (Thai; Japanese's reading is the same field): a word's popover always shows it under the meaning (18 November 2026,
  by the owner's decision; it used to sit behind a "Show transliteration" button). A deck word shows
  its note's `Transliteration` field, kept in the snapshot. A word off the list shows the one the model
  writes beside its gloss, in the style of the deck's (tone marks, syllables joined by hyphens), stored
  with the text (`texts.translits`). It can't be checked in code the way coverage is, so it's the model's
  word for it, and a word it gave none for shows none rather than a guess. Texts written before
  this have none for their off-list words. Only Thai's prompt asks for it.
- **IPA** (15 November 2026, by the owner's decision): the word popover shows a word's IPA beside the word, and tapping it opens a tooltip
  with where it's from ("IPA from Wiktionary"; 18 November 2026, it was a status line), in every language but English (issue #296). It's there by default;
  there is no setting. A token carries `ipa` and `ipa_source`, one of three:
  - **`wiktionary`**: the tables are Wiktionary's, built from kaikki.org's extracts by `scripts/build_ipa.py`
    into `data/ipa/<code>.tsv.gz` (`ipa.py`), under CC BY-SA 4.0, which Settings, Read & Listen says.
    **A word is looked up as written, never through its dictionary form**: a form's pronunciation isn't
    its lemma's (hablé is not hablar), and Russian stress moves between forms, so a form with no entry
    shows nothing from the table. Russian, Polish and Thai have entries for nearly every form; the
    others mostly have lemmas. A homograph takes the first entry that has IPA. Measured on the owner's
    decks (30 to 60 notes a language), single words had IPA for 100% of Russian, Polish and French, 95% of
    German, 93% of Spanish, 81% of Greek and 24% of Norwegian.
  - **`rules`** (Japanese): the kana reading (the deck's KanaReading, else Sudachi's) turned into IPA by
    rule (`kana_ipa.py`), in Wiktionary's phonemic style. Approximate: no pitch accent, no devoicing.
  - **`ai`**: written by Claude for a word the table has none for (`ai_ipa.py`), shown labeled as AI
    everywhere (the IPA drawn in the warning color, "IPA written by AI, may be wrong" in its tooltip, "Written by AI. Check
    it before saving." under the note's field), since nothing checks it and stress is where it goes
    wrong. The table always wins. It's asked after a text is written, in the same background pass as the
    meanings, one call of up to 150 words with the line each is in, and kept for the language
    (`word_ipa`), so a tap never makes a call; a word it gives nothing usable for is kept empty and not
    asked again. A failed call waits `FAILURE_COOLDOWN` and its cost is reported (`/api/costs`, `ipa`).
  Saving a word to the deck fills the note's **Pronunciation** field with the IPA, to check before saving.
- **The word popover's layout** (18 November 2026, by the owner's decision, mocked as option G). The meaning's line carries the word's
  register chip and, for a word whose note is in the deck (`inDeck`), a card-stack icon with a check, drawn from two SF Symbols; its tooltip says
  "In your deck". The other statuses (a name, only inside a phrase, not in the deck, learned in WaniKani) keep their text line. The IPA is
  amber when written by AI. Both tooltips open above the text, and below it when the popover is near the top of the screen
  (`ReadWordTips.tsx`), and close on the next tap or after a few seconds.
  **On a card** (18 November 2026, by the owner's decision) the back shows that field after the answer:
  behind a "Show pronunciation" tap when the card already keeps a reading behind one (a Transliteration, a
  KanaReading: Thai, Japanese), so the sound isn't given away while the reading is hidden, and plainly
  otherwise (`renderCard`). The MCP's `fill_pronunciation` fills the field for notes already in the deck,
  from `/api/pronunciations` (`ipa.ipa_of_entry`, the same lookup a text's token gets, so a card and the
  popup agree): previewed first, never over a field with anything in it, and a note whose IPA is `ai`
  is tagged `ipa-unverified`. It reads only and never asks Claude for a word's IPA, so it costs nothing.
  A daily fill for notes added since (`set_pronunciation_auto_fill`) is off until the owner turns it on.
  The field is in `omnilanguageFieldNames`, after Forms, where `add_field` puts it: the live note type
  needs it too (`add_field`, which makes every device download the whole collection once, so sync every
  device first), or a TSV with no `#columns` header maps by position onto a field that isn't there.
  The editor leaves the prefilled key out of a note type that has no such field.

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
  the marked words list (the gloss leaves it out when the frequency meter shows), and outside Thai the highlight's row in the reader's key is "Might be new to you". Every
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
- **Hidden until the app was rebuilt with it**, as Japanese was: `HIDDEN_LANGUAGES` in
  `languages.py` keeps a language out of the shelf and settings for a build that has no entry for
  it. Emptied on 17 November 2026, once the owner's build had both (the owner's confirmation).

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
- **Phrases in new-card order and tiers** (17 November 2026): a deck entry is a phrase when the
  lexicon would file it as one (`japanese.is_phrase`: several words once what conjugates the last is
  set aside, a prefix or suffix not counting), so 約束を破る and 気を失う have no rank and go first
  and in Tier 1. Before, a phrase was ranked by its head word (気を失う as 気, #87). **A run of
  nouns is one word here** (18 November 2026, the owner's decision): Sudachi splits a numeral from
  its noun (一月 is 一 and 月), which made every month, 百円 and 一日中 a Tier 1 phrase. Tiering and
  the new-card order ask `is_phrase`/`rank_of` with `nouns_are_one_word`, so they rank by the list or
  fall to the last tier like any word; an entry with a particle, verb or adjective is still a phrase.
  The reader's own word checks keep the default count.
- **Practice** (`src/tools/japanese/`): telling the time, dates and money, each answer in kanji
  with its reading in hiragana where the other languages show a romanization. The counters' sound
  changes are worked out in `numbers.ts` (四時 よじ, 六分 ろっぷん, 一日 ついたち, 四円 よえん). A
  date's other forms are the short weekday and the era year (令和, 平成, 昭和, by the day each
  began, first year 元年), and a date typed in kana is accepted as its reading. Prices are whole
  yen. Reading the script has kana words (`script.ts`, 17 November 2026, the owner's decision; it was
  left to WaniKani before): small っ and ゃ, long vowels, ん on its own and katakana's small
  vowels, answered in Hepburn romaji.
- **Answers in kana** (17 November 2026): Type it, Answer by speaking, Say it back, Write what you
  hear and the form quiz take a word or line as its reading in kana, romaji read as kana and
  katakana for hiragana (`compareTypedAnswer`, `src/core/kana.ts`). A missing ゛ or ゜ is a wrong
  letter, not a missing accent (`stripMarks`). Japanese text is drawn in Hiragino Sans
  (`japaneseFont`), so kanji keep their Japanese forms.
- **Recordings from the reading** (17 November 2026, #480, the owner's choice): a card's recording
  in the app and the MCP's add_tts_audio send the word's KanaReading. The server says it in the
  word's place (Azure's `<sub alias>`, `Part.reading`) only where Sudachi reads the kanji otherwise
  (`japanese.spoken_reading`: 今日 meant as こんにち), since kanji as written keep the word's pitch,
  which kana alone can lose (はし). The MCP asks `/api/readings`. Azure's Japanese phonemes weren't
  used: they need a pitch accent no reading carries.
- **Verb forms** (17 November 2026, #479): `conjugation.py` writes a verb's Forms lines from its
  conjugation type as Sudachi gives it (五段-ラ行 for 帰る), seventeen forms with their readings, for
  the MCP's fill_forms (`/api/conjugations`). Japanese grammar points name the groups they practice.
- **Furigana** (17 November 2026, #477, the owner's choices: three settings, per kanji, the
  sentence too): Settings, Furigana is Off (the default), every kanji, or kanji not learned in
  WaniKani (Guru or above, and none over a word learned there as vocabulary). Shown only once the
  answer is, over the word and its example sentence's words (`src/core/furigana.ts`, `Ruby.tsx`).
  A run of kanji is split by WaniKani's kanji readings where they allow one way, else read whole.
  WaniKani's kanji and learned items are read once a study day while it's on
  (`src/wanikani/furigana.ts`).
- **Similar words** (17 November 2026, #478): a Japanese lookalike shares a start of two
  characters with a kanji in it (経験, 経験する); words a kanji apart (劇団, 劇場) are asked in
  Similar words but not held apart; by ear, a long vowel heard short and a missed small っ or ゃ
  make sound-alikes (おばさん, おばあさん).

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
- **A target range, not only a floor** (owner's decision, 12 November 2026; the range moved up on 15
  November 2026, below). The 95% floor with a 98% aim gave texts that were nearly all known words,
  so every dialogue was too easy, and the target was lowered to a range starting at 92%. A text has
  a ceiling, `CEILING_GAP` (4 points) above the target, and a draft over it goes back for revision
  with a message asking for more natural words outside the list, each glossed. A text still over the
  ceiling after 3 attempts is served anyway (too easy is never a reason to drop one), choosing the
  attempt closest to the range. The request names the range, and the prompt tells the model to write
  natural target-language speech rather than word-for-word English idioms.
- **The target is 93%, 95% or 97%, and texts hold at most 98%** (15 November 2026, the owner's
  decision: not to go against the research, which finds 95% the least adequate for reading and, since
  speech can't be reread, for listening; below it comprehension varied widely). **Standard is 95%,
  Easier is 97%, Harder is 93%** (`STANDARD_FLOOR`, `EASIER_FLOOR` and `HARDER_FLOOR`,
  `difficulty.py`), chosen per language in Settings (Text difficulty) or stepped easier by a poor
  check after reading. **Harder is below the research's least** and the setting says so: the
  evidence is that coverage helps gradually, not as a cliff, and the reader has a gloss on every
  word, but at about 7 new words in 100 expect more lookups. It is only ever a deliberate choice: a
  floor saved by an older server never reads as Harder, and the spread-out rule (`crowding.py`)
  allows three new words in ten at that level, since two in ten is ordinary there. A text may hold at most 98% known
  words (`MAX_CEILING`; the ceiling is 4 points above the target but never higher): above that it has
  about one new word in 50, too few to learn from, and the research calls 98% the comfortable end of
  adequate coverage. **The end-of-text rating is gone** (the owner's decision, the same day, after
  working through it): a rating is a feeling, which tracks fluency more than learning, the range is
  two points wide, and a prompt after every text for that was a poor use of a tap; the check after
  reading, which measures understanding, and effective coverage (`recognition.py`), which measures
  lookups of known words, are the better signals. **The number of practice words isn't a difficulty
  setting**: they are words already studied, so they count as known and more of them repeat a few
  words more without making a text harder, while the words outside the deck are what makes it harder
  (from 95% to 97% about 5 new words in 100 become about 3). Nothing moves the practice word count;
  a saved one is kept.
  **The cost the owner already found:** at 95% to 98% a text can hold very few words the learner
  hasn't studied, which is why it was lowered on 12 November. The practice words, the grammar
  points and the guess-first prompt are what keep a text from teaching nothing; 95% is as many new
  words as this allows, so a text that is still too easy is a reason for the challenge mode in
  issue #298, not a rating. The reader's "fewer than usual"
  note (`underFloor`) now shows for any text under 95%, which after 3 attempts is the closest one
  that is still at 85% or more (`MINIMUM`, unchanged: raising it to 90% would drop more texts for
  cost, and is the owner's call).
- **New words spread out, with a clue** (15 November 2026, the owner's idea from a screenshot of a
  line with four new words in a row). Coverage counts a whole text, so a draft can hold the right
  share of new words and still pack several into one sentence, where nothing around them is known
  well enough to infer a meaning from, and the guess-first prompt is wasted. Two parts, both in the
  system prompts (Thai's and the shared template): spread the words that aren't known out (at most
  two in any ten words, never two in a row), and put each stretch word and each new word where the
  line shows what it means from words the learner knows (a fire before its sparks), with a short
  clue and no explanation, and a stretch word's second use in a different situation. The first is
  also checked in code (`crowding.py`): more than `CROWD_MAX` (2) words that aren't known, in any
  `CROWD_WINDOW` (10) counted words in a row, send the draft back with those words named. It is
  **soft, like the grammar rules**: if no attempt is clean, the closest by coverage is kept (a less
  crowded one on a tie), so a text is never dropped for it alone, and it costs more revision rounds
  when the model clusters. The clue can't be checked in code: it rests on the prompt, and a second
  model call to judge it was left out for cost. Watch the effect through the guess-first lookups.
- **Revise rather than regenerate.** A text under the 95% floor goes back to the model with the
  unknown words named ("replace ทอน, กลิ่น"). At most 3 attempts in total.
- **The closest attempt is kept** (owner's decision, 26 October 2026, so texts don't fail for
  being a little short). If none of the 3 attempts reaches the floor, the one with the highest
  coverage is served, as long as it's at least 85% (`MINIMUM` in `coverage.py`, 90% until 12 November 2026); under 85% the text
  is dropped as before. 90% is where the brief's evidence says listening comprehension already
  varied widely between people. All 3 attempts are still made first, and the prompt asks the model
  to check every word against the list before answering, so most texts meet the floor. The reader
  notes a text under 95% ("fewer than usual") and offers to highlight the words outside the deck,
  each of which has a gloss. Since the texts table records each text's coverage and floor, how
  often this happens can be read from it, and the exit check's median coverage still counts these
  texts as they are.
- **Model:** `claude-sonnet-5-5` at `high` effort (raised from `medium` on 26 October 2026, so more
  texts meet the floor on the first try, at the cost of more output tokens per text), with server-side refusal fallbacks
  (`fallbacks: "default"`). The owner chose Sonnet to start, at half Opus's price; revisit once real
  texts show whether its Thai holds up within the vocabulary. The reply is JSON held to a schema (`output_config.format`): a title,
  roles (who A and B are, like Waiter and Customer, shown above the lines in the reader), lines (speaker, `|`-split text, English), and glosses for words off the list. Revisions are
  appended to the same conversation, never edited, so the model's earlier thinking stays valid.
  Thinking counts against `max_tokens` (32,000), so a response cut off there is asked again once at `medium` effort with 48,000 (both calls are counted in the cost), and a story episode, which also returns a recap, plan and choices, starts at `medium` (16 November 2026, after episodes kept failing with "The response was cut off").
  `server/reader/src/franki_reader/generator.py`.
- **Cheaper model for short, checked calls** (15 November 2026): glosses for common words, word forms,
  IPA, memory hints, Explain, comprehension questions, the vocabulary check and audio lesson content
  use `claude-haiku-5-5` (`CHEAP_MODEL`, about a twentieth of Sonnet's price). Haiku has no server-side
  refusal fallback, so those calls send none and treat `stop_reason: "refusal"` as a failed call, as
  they already did. Texts, drills, sentences, topics, the note queue, the writing check and Situations
  stay on Sonnet, where a wrong answer is taught back to the learner. Watch the spot checks in
  `/api/costs` and Russian word forms first.
- **Written by** (15 November 2026, a trial): the write sheet (the shelf's +) has a Sonnet or Haiku switch,
  sent as `model` on `POST /api/shelf/write` (Sonnet when left out, 422 for any other model) and used
  by Surprise me too. It's per text, so the same topic can be asked of both and compared. The model
  that answered is kept with the text (`texts.model`), shown after the shelf row's length ("Dialogue ·
  3 min · Haiku"), and priced in `/api/costs`. Haiku sends no refusal fallback, so a refusal
  fails that attempt as it does when a fallback also declines. Practice texts, story episodes and
  topic-queue texts stay on Sonnet. Remove the switch once one model is chosen.
- **A listed stretch word missing from the text** sends it back too, even at full coverage (15 November 2026: a word used once is enough; it was 2).
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
- **Kanji in the word popup** (18 November 2026). A Japanese word's popup lists each kanji in it once,
  with its English meanings and kun and on readings (`kanji.py`, `data/kanji.json`, from KANJIDIC2,
  CC BY-SA 4.0, so the list carries the credit line). It's a lookup in a file shipped with the server:
  nothing is generated, asked of a model or fetched, and `kanji` is on every word the server sends
  (null for a word with none). A kanji KANJIDIC2 doesn't list (々) is skipped. The marked words list
  shows the same block (`ReadKanji`). With a WaniKani token entered, each kanji also carries the level
  that teaches it, read from WaniKani once a study day and kept on the phone (`useKanjiLevels`,
  `src/wanikani/kanjiLevels.ts`); without one there is no tag.
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
  **The word a form goes with** (15 November 2026): the same call also gives the one word in the
  line the form goes with and the English of the word with it: the preposition that puts a noun in its
  case ("в", "in hoods"), a verb that takes the case (помогает, dative), the auxiliary of a compound
  tense ("a", "has eaten") or the word a subjunctive follows (que, να). Code keeps them only when the
  word is one of the language's own for that kind of form (`helpers.py`, `data/helpers/<code>.json`):
  prepositions for any case, before the word; a verb with the one case it takes (found by its
  dictionary form); and for a form id the auxiliaries and triggers that go with it, anywhere in the
  line, since a verb-final clause puts the auxiliary last. Anything else is kept as the form alone, so
  a wrong claim shows nothing rather than something wrong. The popup shows it as a line under the
  meaning ("в + prepositional: in hoods", `helperNote`), and the meaning itself leaves the helper out
  (the gloss prompts say so), since it is a word of its own with its own tap. Each word's kept form is
  `{id, helper, phrase}`; forms kept before this hold only the id, and a text in a language that has
  helper words is asked again by the backfill, once (`forms.is_current`).
  **Contractions** need no model: a word that is a preposition and an article in one (στο, al, zum,
  au) says what it is made of ("σε + το") from a table in the same files, shown in the same place.
  Only contractions that are never anything else are listed (French des and du are also plain
  articles, German am is also the superlative's marker). Not done: Japanese verb chains, and reflexive
  or passive "se", "-ся", "się".
- **Form quiz** (16 November 2026, the owner's idea: a practice word shown in its dictionary form that
  you tap to put in the right form). A few words of a text are hidden behind a slot in the line, and a
  tap opens a sheet to type the form that fits. Nothing new is generated: `form_quiz.py` picks the words
  in code from what `render` already has, a known word (never a practice word, a name or one outside the
  deck and common words) with a dictionary form and a form named by the forms pass, so the sheet can say
  why. First appearance only, since that is the line the form was picked for; never the first word of a
  line, whose capital says nothing; one to a line, spread down the text, different forms where it has
  them, and the same words every time (`text_id` only moves where the spread starts). One slot for every
  four lines, at most three, so a short text still reads as a text. The server flags them `quiz` on the
  word (`Word.quiz`); the app decides whether to show them. **The word is hidden, not shown as its
  dictionary form**: shown in a dictionary form it read as part of the story and the wrong grammar went
  unnoticed. The slot is a solid accent pill with a question mark, as wide as the word so the line wraps
  where it would have, and says nothing of the word to VoiceOver. It shows the real word while its line
  plays (the voice is saying it, and listening first is a fair way to answer), and goes back to the pill
  when the line stops, until it's answered or skipped. The sheet (`ReaderFormQuiz`) shows the line with a
  blank, the dictionary form and its meaning, and a field. Typing is compared with the form in the text
  (`typedCompare`, case and spacing ignored, accents counted: Polish ę is not e), and a wrong answer says
  what the text has and the form's name with the helper word (`formReason`). After a miss, **Explain why** asks Claude on the server why the line has that form (`POST /api/texts/{id}/lines/{n}/form`, `explain.py` `FORM_SYSTEM`: not paragraphs, which weren't read, but four short parts the sheet draws (`ReaderFormQuiz.tsx`, `FormWhy`): the line with the deciding word marked (`deciding`, kept only if it is in the line, `markDecider`), one `rule` sentence, up to two `changes` shown as before and after chips, and a `tip`), only on the tap and kept per word in `form_explanations` (an answer kept as paragraphs is asked again); it counts with the other explanations in `/api/costs`. **Practice only:** nothing
  grades a card, rates, schedules or is saved; the answers last as long as the text is open
  (`useFormQuiz`), and `tests/reader/noGrading.test.ts` scans the hook. It's on by default, with a switch
  in the reading options menu (when the text has slots) and in Settings, Read & Listen, Word forms
  (`formQuiz` in `prefs.ts`). Thai has no inflection, so it never has a slot. Not done: a fading tally of
  missed forms to lean later texts toward them (the Practice tools' `marks.ts` shape), multiple choice,
  and slots in a text's recap or choices.
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
- **Stretch words** are 1-4 words (15 November 2026: was 1-3, `MAX_STRETCH`), each asked for once or twice (twice for a word with several forms or senses or a longer phrase, once for a simple one), young words first (most fragile, below), then ones reviewed today. No random assignment.
- **Stretch order: fragile young words first** (15 November 2026, the owner's decision from a review of
  the learning science). The order is words returning from an earlier day (`RETURN_DAYS`), then young
  words not waiting, lowest FSRS stability first (the note's most fragile studied card, read from
  Anki's memory state into `Entry.stability`, `lexicon.stability` in the snapshot), then words
  reviewed today. A word just reviewed is at its strongest, so another encounter adds the least; a
  young word's memory is weakest and gains most. Retrievability can't rank them: FSRS schedules a
  review for when it falls to the desired retention, so every word that isn't due sits just above
  it, and the lowest is simply the soonest due. **A young word due within `PRIMING_DAYS` (2) study
  days is left out** (`stretch.due_soon`): read that close to its review, the exposure primes it,
  principle 9's corruption softened by the days between. A word reviewed today is exempt, since its
  next review is a full interval away. Sentences' practice words (`sentences.candidates`) use the
  same pick. This relaxes the 13 November rule only for young words due in 3 or more days; a word
  that is due or past due is still never picked or used.
- **Several texts in one study day don't repeat their practice words** (15 November 2026, the
  owner's decision). A word that was a stretch word in a text already read today goes after every
  other candidate (`pick_stretch`'s `today`, from `store.practiced_since`), returning words
  included, so it still fills a pick when too few other words qualify but is never the only kind
  while a fresh word is left. A pick made only of today's words drops one of them (a single
  practice word is kept), so the next text isn't the same words again.
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
  that uses none or too many goes back for revision. The other setting,
  "Any word" ("Any due word" until 13 November 2026), hands the model that many words to use, which
  keeps every word in rotation at the cost of odder dialogues. It's a setting on the Topics screen (`GET`/`PATCH /api/settings`),
  stored on the server so background writes follow it, and like the text difficulty it applies from
  the next text written. It's separate from difficulty on purpose: the text difficulty decides how
  much coverage (the practice word count is separate); this decides only which words.
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
  asked for: a typed topic, Surprise me (`asked`), a practice text, and each running story's next
  episode, which is written once its last one is read. Before this the shelf kept `SHELF_SIZE` (3)
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
- **Play all** plays the shelf's texts (Up next), one text after another, with
  background audio. A text whose last line has played is logged as read, unrated, and the next one
  opens. Whether iOS keeps the app running across the gap between two texts with the screen locked
  is unverified.
- **Browse** (17 November 2026, the owner chose from a mock, after a simpler list the same day: "it
  should feel like browsing a streaming app and creating your own shows"). The home is rows of
  covers that scroll sideways, each a tint (picked from the id, so it keeps its color) with the kind
  small and the title large, never a picture. Top to bottom: the reviews-due row; a **banner** for
  the pinned story (its next episode, practice words, Play episode N, Episodes); **Your stories** (the
  other running and ended stories, with how far through the season each is and whether its next
  episode is ready; See all opens Stories); **Texts** (what the shelf has: texts asked for
  that aren't story episodes, the name used for them in the app since then, with Play all); **Hear
  again**; **Reread** (texts read, newest first; See all opens the full list); and Marked
  words. A text's cover says its length, model and reason; the line count is gone. Play all
  plays only the Texts row: the reader's Next after an episode still goes on to the shelf
  (`playOrder`), while Play all moving on stays within it (`upNextOrder`). The header's + opens a
  sheet with three tiles: **Series** (what this file calls a story elsewhere: episodes that pick up
  where the last one ended), **Dialogue** and **Story** (a one-off), each of those two with Surprise
  me, or a topic, and Written by; it isn't shown offline, and neither are the rows that need the
  server. The app says "Series" for the running kind, while the server's routes and tables keep
  `story`. A series' own page (`GET /api/stories/{id}`, with the banner's Last time and practice words) has its next
  episode, Last time, and its episodes by season, and its ••• sets the order, pins it to the top, ends it or
  continues it. The newest season and episode come first (••• sets newest or oldest first, kept in the
  reader's settings as `episodeOrder`). With several seasons each folds under its header: the latest
  starts open and earlier ones closed, and what the reader opens or closes is kept per series on the phone. **Audio lessons moved to a tab of their own** (Lessons, shown while Read & Listen
  is signed in), since they're speaking drills rather than texts to browse.
- **The language's settings page** (the shelf's gear button) holds what's set once: the deck,
  common words, voices, grammar, practice words, and the progress
  summary (moved off the home screen). The story that used to be here (start a new one, Read from the
  start) was removed on 18 November 2026, by the owner: the + sheet, Stories and the banner do both. The `form` setting is no longer shown: the shelf varies it.

## Stories

Added on 12 November 2026 by the owner, with the shelf: an ongoing story in each language, whose
next episode is the top of the shelf.

- **Several stories run at once, one pinned to the top** (17 November 2026, by the owner: a new
  story used to retire the old one, for no reason anyone wrote down). A story (`stories`) is started
  from the + sheet or Stories, with an optional line about what it's about, and
  runs (`active`) until it's ended. Each language has one pinned story (`pinned`), the one the
  home's banner shows (`pinned_story`); a new story is pinned only when none is running, and ending
  the pinned one passes the pin to the newest running story. Stories (`GET /api/stories`) lists the
  language's stories, running then ended; a story's page pins, ends and continues it (`POST
  /api/stories/{id}/pin`, `/end`, `/continue`). An ended story's episodes stay on its page and in
  Reread's full list. **Spending:** each running story writes its next episode once its last one
  is read (the top-up goes through them all), so a story left unread writes nothing more and each has
  at most one episode waiting. Only the pinned story's episode is downloaded for offline. Play all
  never includes an episode (Shelf, Browse).
- **Continuity is carried in words, not in the conversation.** The first episode's request asks the
  model to invent two to four named characters and a place, and to return the story's name
  (`series`, in the text's language like a title, so the shelf card reads in the language being
  learned; a story named before this keeps its English name) and its cast and setting (`cast`) beside the text. Every episode returns one sentence
  about what happened in it (`recap`, on the text). Each later episode's request names the story,
  the cast, and the last 12 recaps (`STORY_RECAPS`), so the request stays short however long the
  story runs. All three fields are optional in the reply's schema and asked for only in a story's
  request.
- **The last episode's ending is quoted too** (added 19 November 2026). A recap is one or two
  sentences, so it dropped small state: an episode ended with the cake still baking and the next
  opened with it burnt. The next request now also quotes the previous episode's last
  `STORY_ENDING_LINES` (3) lines in English (`StoryContext.ending`) and says not to contradict them.
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
  English recap. The line must carry the recap's main event and who did it (16 November 2026):
  told it could be "simpler than the recap", the model kept filler and dropped the event ("the man
  knows where the temple is"), and the English shown is that line's own translation, so the card
  read as a worse recap than the one stored.

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
  The shelf's story sends where the card's episode falls (`season`, `season_episode`, `season_length`),
  and the card shows it beside the story's name ("Episode 8 of 8 · Finale"); an older server
  sends none and the card keeps its running episode number.
  Every shelf text also sends `created_at` (when it was written, with its UTC offset). The story card
  showed it as "Released Nov 16" until the shelf's layout was simplified (17 November 2026, Shelf).
- **X-Ray** (added 19 November 2026, by the owner): who a series' characters are, as far as the
  episode being read. Every episode's reply carries `xray`, a list of `{name, fact}` for each named
  character it introduces or tells something new about (a fact is English, under twelve words, true
  as of that episode; it is `xray` because `characters` on a text already means the drawn dialogue
  speakers). The request lists what is already known ("Characters so far") and says not to repeat
  it. The story keeps one entry per character with each fact tagged by the episode that gave it
  (`stories.characters`, `xray.py`), so a card shown for episode N uses only facts up to N and gives
  nothing later away. A series already running has none until its next episode, whose request asks
  for every named character with `since`, the episode each first appeared in. `GET /api/texts/{id}`
  sends `xray` (each character's description, `first_episode` and whether they turn up in the text)
  and tags each name word that is one with `character`; matching allows an inflected name
  (`xray.matches`). A series' own page sends `xray` as of the last episode read. In the app a tap on
  a character's name shows their description in place of "A name", with See all characters; the
  reader's header has a Characters button opening the sheet (in this episode first, then earlier),
  and the series page lists them. Display only: nothing here rates or writes a card.
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

## Your topics

A grammar page the owner asks for by typing a topic ("Serial verbs") that the fixed catalog
(`grammar_points.json`) doesn't have. Claude writes it in the background from the known words
(`grammar_topics.py`): a one-line `lead` (the card's headline), an `explanation` in the catalog's
format and 3 to 6 `examples`, each with its English and the `words` that show the structure. The
routes are `/api/grammar-topics` (not `/api/topics`, which are the reading topics). A page's status
is `writing`, `ready` or `failed`; a rewrite or new examples that fail leave the old page `ready`
with a `note` saying what happened, cleared by the next write that works.

- **Nothing is graded or scheduled.** There is no finder, no exposure count, no due date and no
  card; the server never touches Anki or FSRS for a page. A Situation may take a page as its
  `focus` (title and lead): the other person works the structure in and invites the learner to use
  it, never naming it, and the feedback notes say how the learner's lines used it.
- **Code verifies the vocabulary and the format, not the grammar.** An example is kept only if it
  has at most one word outside the known ones (the drills' check), no `|*~` or em dashes, its
  `words` in the line in order, and isn't a repeat. A failing example is dropped, never repaired;
  fewer than three left fails the write. Whether the explanation is right is Claude's word alone,
  so the app labels every page "Written by Claude".
- **Writes are asked for and capped.** Each write (a page, new examples, a rewrite) is counted when
  it starts, 10 in a study day across all pages (429 past that), and a language holds 30 pages
  (409 past that). Writes are costed in `grammar_topic_writes`, shown under `topics` in
  `/api/costs`, failed calls included. A title is one page per language, any case.

## Characters

A dialogue's speakers are shown as small drawn characters instead of the A and B badges (12 November 2026).

- **The model picks, the app draws.** Each text's draft has `characters` beside `genders`: for A and B, one of the keys in `server/reader/src/franki_reader/characters.py` (parent, grandparent, child, friend, waiter, shopkeeper, doctor, teacher, traveler, person), or "none" in a story. The key is stored with the text (`texts.characters`) and sent with its `genders`. An unknown key is dropped, not retried: the speaker shows the badge.
- **The gender picks the version.** A parent is a father or a mother, from `genders`, so there are 20 drawings from 10 keys and no key says a gender.
- **Two alike.** When A and B share a character and a gender, B is drawn with other hair (or glasses, under a cap), in B's own color.
- **Drawn in code, from the theme.** `src/reader/characters.ts` is a list of shapes naming tones; `ReadSpeaker.tsx` paints them in the speaker's colors (gold for A, green for B) with `react-native-svg`, so dark mode needs no second set. `test_characters.py` checks the app draws every key the server can pick.
- **Speakers are named** (13 November 2026). `roles` holds each speaker's first name in Latin letters, with a job first where the situation gives one ("Waiter Luc"); a friend or relative is only a name. Texts written before this keep roles like "Friend". The reader lists them in a card headed "In this text" above the lines, apart from the dialogue.
- **Older texts keep the badges.** A text with no characters, or a speaker with no gender, shows A or B as before. Texts already written are not redrawn.

## Aspect pairs

Russian and Polish verbs come in aspect pairs, and the deck keeps each pair as **two notes, one per
verb**: tagged `perfective` or `imperfective`, each with `AspectPartner` holding the other. Separate
notes because each aspect is learned and forgotten on its own (FSRS schedules them separately, and a
word counts as known only when its own note is studied), and because some verbs have one aspect only.
Drilling a pair together is the practice layer's job (`AspectPartner` is a form in the forms drill),
never a shared card.

Add to deck (`useAddMinedWord`) keeps the pair linked both ways, whichever half is added first:

- **Before the editor opens**, a Russian or Polish word with no space in it is sent to
  `POST /api/aspect-pair` (`aspect.py`): one cheap Claude call, made only on that tap (a plain tap of
  a word never makes one). The editor opens with `AspectPartner` and the aspect tag filled in, and
  says under the field that it was written by AI. Nothing checks it against Wiktionary. A failed
  lookup opens the editor as before, without a suggestion.
- **After the verb is saved**, `pairFollowUp` offers one thing: add the partner as its own note
  (pointing back, tagged with the other aspect), or link back a partner already in the deck whose
  `AspectPartner` is empty. A partner that lists some other verb is left as it is. Both are an alert
  the owner can decline; saving the new note, or tapping Link them, is the approval.

The call's cost goes in `call_costs` (feature `aspect`) and is not yet in `/api/costs`.

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

- **Every language** (`read_and_listen_languages`, 17 November 2026): each language the app can show,
  with `waiting` (often 0) and `last_read_at`, so dundundun can make one task per language and
  choose which get one today (its Settings, Franki). `read_and_listen` stays as the current
  language's entry, for a build of dundundun from before this.
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
  man's voice, and its characters in voices of their own (below). A text from before this has no genders and is read as it was recorded, A a man and
  B a woman.
- **Story characters have voices of their own** (15 November 2026). A story episode is still told by
  the narrator (speaker `N`, the man's voice), but what a character says aloud goes in the language's
  quotation marks inside the narrator's line, and the model names who says each one (`quotes` on the
  line, in order) and, once for each new character, `speakers`: name, `male` or `female`, and
  `child`, `adult` or `elder`. Only episodes are asked (`request.story`); the system prompt is
  untouched, so its cache is shared. Code does the rest (`cast.py`):
  - `quote_spans` finds the quotations in a line (« », " ", „ " , 「 」 and a straight "); a mark
    never closed starts nothing. A line whose names don't match its quotations in number, or that
    names someone not in `speakers`, goes back for revision like a vocabulary miss. A text whose
    attributions never fit is kept as the closest attempt, its unnamed quotations read by the narrator.
  - `assign` gives each new character a voice and a pitch no one else in the story has, from the
    language's voices for their gender (the four slots, as chosen in the app): first an unused
    voice at the pitch their age asks for (child +8%, adult 0, elder -8%), then the same voices
    a step higher or lower (`PITCH_STEPS`), and once all are used the least used. The narrator's
    voice and pitch are taken from the start. A pitch step doesn't make two adults of one gender
    sound like different people; another voice does, so a language with one voice of a gender
    (Russian's man, Thai's) runs out sooner, and a Multilingual voice chosen in a slot is the way
    to add one.
  - **The voice for each kind of character is chosen in the app** (15 November 2026, Read &
    Listen's voices, Story characters). The kinds are a man, woman, boy, girl, older man and older
    woman (`cast.CAST_TYPES`, a gender and an age), each with a voice and a pitch from -30% to +35%,
    kept per language in the `cast` setting (`PATCH /api/settings`; null puts a kind back). A kind
    with none chosen has what `assign` would give it (`cast.presets`), which `GET /api/settings`
    sends, so the app shows what's used. `assign` tries a kind's chosen voice and pitch first, and
    a second character of the same kind gets the next combination nobody has, as before. The
    screens are `ReadCast` (the six kinds, a sample on each, a scene, Reset to defaults) and
    `ReadCastKind` (the voices of the kind's gender, and a pitch in steps of 2% that is saved and
    played once the taps settle). A change applies to characters given a voice afterwards, never to
    one already in a story.
  - **Audition** (`ReadCastAudition`, opened from a kind's screen): one line played in each voice of
    the kind's gender (or only the Multilingual ones) at one pitch, to compare voices without saving
    each. Tapping a voice plays and checks it, the pitch buttons replay it, and "Use" saves the
    checked voice and pitch for the kind. It uses `/api/cast/sample` and the same cached samples as
    the kind's screen, so the server needed nothing new.
  - **Hearing a choice**: `POST /api/cast/sample` speaks a line (`cast_samples.sample_line`; in Thai a
    man's has ครับ) in a voice at a pitch, and `POST /api/cast/scene` reads a short scene, the
    narrator, then a girl, then a woman, in the voices a story would give them now, as one
    recording in several voices. The scene is the first real use of that request, so it is also
    the quickest way to find out whether Azure takes it. Both are counted as recordings in
    `/api/costs`. The app keeps each answer in the cache folder under the voices and pitches in it.
    Not built: showing the scene's text in the app (it's the server's, in `cast_samples.SCENES`).
  - **A character's voice is kept for good** (`stories.voices`, set when the episode is saved,
    before its audio): the stored voice name and pitch, not the slot, so changing the voices
    chosen in the app, or `assign`'s rules, never changes how a character in the story sounds. A
    later episode's request lists the characters who have a voice (name, gender, age) and asks
    only for new ones; a name told again, or in another case, is not given a second voice. A new
    story has its own cast, and a story that was running before this has none until its next
    episode lists its speakers. Not built: renaming or merging characters, or changing one's voice.
  - **One recording per line still.** A line with a character's quotation is cut into the narrator's
    parts and the characters' (`cast.line_parts`, which always join back to the spoken text, so the
    word timings match) and sent as one SSML document with a `<voice>` element for each
    (`franki_speech.ssml_parts`, `SpeechClient.speak_parts`). The pitch is `<prosody pitch>` inside
    it. Unchecked against a live key, like the rest of the Azure calls: if Azure refuses
    several voices in one request, or the SDK's word boundaries stop at the first, look there
    first. If Azure refuses it, the line is recorded whole in the narrator's voice rather than left
    silent (logged). A line with no character in it is spoken as before.
  - In Thai a quotation is checked against its speaker's gender as a dialogue's lines are
    (`gender.quote_gender_problems`), and a draft that fails it is never kept.
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
- In Thai, each space between clauses becomes a 60 ms SSML `<break>` (`THAI_PAUSE` in
  `franki_speech`), since a voice may not pause at a bare space. It applies to the MCP's
  `add_tts_audio` too. A space before a conjunction that opens a clause (แต่, และ, หรือ, เพราะ, ถ้า, แล้ว, เมื่อ) gets no
  break and is dropped, so the voice says it straight on from the clause before (a break there made
  the voice end the clause and sound halting); after `?` or `!` it keeps its break. Audio already
  cached keeps its old pauses until it's re-recorded.
- Each new line's recording has the silence Azure leaves at its end cut down to 0.12 s
  (`trim_trailing_silence`, ffmpeg; `tts.trimmed`), so lines don't play with a long gap between them in any
  language. Only the end is cut, so word times stay right. Where ffmpeg fails the line is kept as
  recorded. Audio already cached keeps its gaps until its text's audio is dropped and re-recorded.
- Each line is spoken once at normal speed and cached as an MP3 on the volume
  (`READER_AUDIO_DIR/<text>/<line>.mp3`). A new text gets its audio before it counts as ready; a line
  with no audio yet is made when it's first asked for, which covers texts written before the Azure
  key was set. An Azure failure leaves that line silent and never blocks the text.
- **The word being spoken is lit as a line plays** (since 13 November 2026). Each line is recorded
  through Azure's Speech SDK (`SpeechClient.speak`), which reports when each word starts and ends;
  the REST API it was recorded with before gives audio only. The timings are kept beside the MP3
  (`<line>.json`), and the server matches Azure's words to the line's own (`timing.py`) each time a
  line is served. In Thai Azure reports a whole run of text between spaces as one word, so until 19
  November 2026 every word in a run lit up at once; now each of Azure's words has its time shared
  out over its letters (not Thai's vowel and tone marks), and a word here takes the share its
  letters account for, so a run lights up a word at a time. It's an estimate within the run, as
  Azure gives no finer time, and since the raw timings are what's cached it applied to every text
  already recorded. Each word goes to the app with its `time`; the
  app reads the player's position every 50 ms while a timed line plays (`useSpokenWords`) and fills
  the word's background (`spoken` in the theme), chosen over fading the rest of the line or a
  karaoke-style "read so far". A word stays lit through the pause after it. It's on unless turned
  off in Read & Listen's settings (Listening, `followWords` in `src/reader/prefs.ts`). Where the SDK can't be
  used (a custom `AZURE_SPEECH_ENDPOINT`, the SDK not loading, Azure unreachable over its
  connection) the line is recorded through REST as before, with no timings, and plays unlit. The
  texts waiting to be read when this came in are re-recorded with timings once
  (`Engine.time_waiting_texts`, on the first top-up, behind the `waiting_texts_timed` flag), as the
  owner chose; texts already read keep their audio and play unlit. A slow recording has its own
  timings (below), since slower speech is longer.
- **Speed is Slow or Normal (15 November 2026).** Before this it was four speeds, 0.7x to 1.0x, which
  the player made by stretching the one recording; that sounded robotic. Slow is now a second
  recording of the line, spoken by Azure at `tts.SLOW_RATE` (0.65, SSML prosody -35%; it was 0.8 until 18 November 2026, and the slow recordings made at 0.8 were dropped once, `Engine.drop_old_slow_audio`), kept beside
  the normal one (`<line>.slow.mp3`, `<line>.slow.json`; `AudioCache`) and made the first time the
  line is played slowly, so a line never played slowly costs nothing extra. It is billed as a
  recording of its own (`audio_chars`). `GET .../lines/{n}/audio?speed=slow` serves it, and
  `GET .../lines/{n}/slow` records it and returns its word times, which the reader fetches before
  a slow line plays so the words light up in time (`Reader.startLine`; the text's own words keep the
  normal recording's times). If recording it fails, the reader plays the normal recording stretched
  to 0.65 as before. Slow is offered per language (`slowLanguages` in `src/reader/prefs.ts`, Settings, Read &
  Listen, Slow speed; every language but Spanish and French to begin with): a language without it
  plays at normal speed everywhere and the player shows no speed control (`speedFor`, `hasSlow`).
  Choosing the other speed while a line plays starts the line again. A speed saved
  below 1 is Slow (`toRate`). Re-recording a text for new voices drops its slow lines too. Situations'
  clips are covered under Situations' voices below. The other screens that play a line (Retell, the check, Write what you hear) ask for the slow
  recording too. "Play" runs the dialogue line by line; each line has its own
  replay button. Playback continues with the ringer on silent and the screen locked; the player
  keeps the audio session active between lines, or iOS could suspend the app in the gap. A line
  whose audio fails to load is skipped with a note. Thai plays over other audio (a podcast keeps
  going), as the owner chose.
- The app fetches audio itself, with the passphrase in the request's headers.
- The microphone is used only by Record yourself (below, under Repeat line); a take stays on the phone.

## Logging

- Per text: date, language, mode, token count, verified coverage, stretch words, words glossed,
  words flagged unknown, rating, audio speed, listen-only or not, time spent.
- **Text difficulty** (15 November 2026, the owner's decision; it replaces the end-of-text rating).
  Words, rating, audio speed and the rest are logged per text as before, but a rating moves nothing:
  an older app that still sends one has it logged and ignored, and the end view no longer asks. The
  coverage target is one of three for each language, **Harder (93% known words)**, **Standard
  (95%)** or **Easier (97%)**, chosen on the language's settings page (`PUT /api/difficulty`),
  applying from the next text written, or stepped one level easier by a poor score on the check after
  reading (`difficulty.after_reading`). A text already waiting in a favorite's queue keeps the difficulty it was
  written at; the owner chose that over discarding queued texts (19 October 2026). The Milestone 1
  exit check reads the log. The level is saved as `difficulty_v3`; a floor saved by an older server
  (`difficulty_v2`) is read as Standard or Easier by `store.load_difficulty` (96% or more is Easier).
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
  comparison, kill criterion). The owner decided on 19 October 2026 not to build it. A random
  holdout is still the only way to show the mode helps vocabulary; the observational comparison
  below is the cheap stand-in, and a holdout can be designed later (the default "topic" mode lets
  the model choose stretch words, so it would need a randomized candidate list).
- **Effective coverage** (15 November 2026, the owner's decision from a review of the learning
  science). Verified coverage counts a word as known when it's studied and not waiting for its
  review, but the owner's recall in Anki (79% of reviews remembered in the last 30 days, against a
  90% desired retention) says some of those words aren't recognized. When a reading is logged the
  server measures it (`recognition.py`, from the text's lines, the current snapshot's checker and the
  words the reader tapped or marked): the text's words, how many were known, and how many of those
  were looked up, as tokens and as distinct words, kept in the `readings` row (NULL before this).
  **Effective coverage** is verified coverage less the known words looked up. It's a floor on the
  misses (a word not recognized and not tapped isn't seen) and a little high where a word was tapped
  for curiosity, so read it as a trend. `GET /api/progress` reports it as `recognition`
  (`texts`, `verified`, `effective`, `known_types`, `looked_up_types`) over the finished readings
  that kept it. Display only: the difficulty adaptation doesn't read it, and the app doesn't show
  it yet.
- **Exposure effect** (15 November 2026). `GET /api/exposure-effect?days=90` (`exposure_effect.py`)
  asks whether a stretch word was remembered better at its next Anki review than similar words that
  weren't stretch words. The exposures are the stretch words of texts read to the end
  (`store.stretch_readings`), the outcomes the collection's review log (`collection.read_reviews`,
  a sync first, read only). A card's review is exposed when its word was a stretch word in a text
  read after the card's previous answer and no later than this one; it's compared with unexposed
  reviews of cards at about the same interval before the review, averaged over the exposed reviews'
  mix of intervals, with a 95% interval, and says `not_enough` below 40 exposed reviews. **It shows
  an association, never proof:** which words became stretch words wasn't random, and what else sets
  them apart (how hard the word is) isn't controlled for. Nothing here grades FSRS or changes a card.

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
  `Transliteration`), the Register ("neutral" when plain, as the finished notes have it), PartOfSpeech
  (also the new note's tag), a Notes line, the `Language` and `GenerateReverse` every note carries, and
  what each language's finished notes carry (`EXTRAS` in `note_queue.py`, read off the deck on 16 November
  2026): Thai noun Classifier; German noun Gender, Plural and Genitive, verb VerbClass, Auxiliary and
  KeyForms; French noun Gender; Russian noun Gender (м, ж, с), verb AspectPartner, KeyForms for nouns and
  verbs; Polish noun Gender, KeyForms for nouns and verbs; Greek verb VerbClass (active, deponent) and
  KeyForms; Japanese Hanzi. KeyForms is written a line to a form, each under the name of what it is
  (`pattern:` first, then `genitive:`, `plural:`, `I:`, `you:`, `past:`, `perfect:`), which is what the
  card's Grammar box reads and the MCP holds notes to; Claude answers each form under a key of its own
  and `check` writes the lines. Spanish, Norwegian and English have nothing beyond the common fields. The extras are kept
  only when they pass, and one that doesn't is left out without failing the word. Generate, then verify: a word is kept
  only if it was asked for and its fields pass `check` (one sentence, balanced bold, no other markup,
  no `|`, `*` or em dashes); anything else is `failed` with the reason, never repaired, and a failed word
  is tried again after ten minutes, up to three tries, then waits for the owner's Try again. Which
  words are due is read at each `GET /api/note-queue`, so a server restart picks up where it left off;
  the app asks every few seconds only while some word is waiting (`useNoteQueue`, one poller for every
  screen showing the queue). **Nothing here writes an Anki note.** The server can't write notes or media
  to Anki, and the approval rule stands: a ready word opens in the note editor with its fields filled
  in, and saving there is the approval, after which the app deletes the word from the queue. The Audio
  field is the one the server doesn't write: the app records it as it does for any note when it's saved
  (`src/core/recording.ts`). The spend is the `note_queue` block of `/api/costs`. A noun's Gender is filled for every language
  that has one, and the Entry is the bare noun (the card shows the article from the Gender, and the app drops
  the article the Gender gives when a ready word opens in the editor). Not done:
  Spanish `Forms` (`fill_forms` writes them), Etymology and Mnemonic, the aspect tags on Russian and
  Polish verbs, a check that
  the sentence uses only known words (it's one sentence, not a text), and a note that says it was
  filled in by Claude in the editor.

## Suggested words

Decided 18 November 2026, the owner's idea: when a language deck is about to run out of new cards,
suggest words to add, so the deck keeps going without the owner having to think them up.

- **When:** a Read & Listen language's deck with fewer than three days of new cards left
  (`RUNWAY_DAYS`, `src/reader/newWords.ts`): its never-studied, unsuspended cards (the deck row's
  `unstudied`, its subdecks and frequency tiers included) under three times its own daily new limit
  (the row's `newPerDay`: the preset's, not today's Custom Study limit). Not for a deck taking no new
  cards, not while vacation mode is on, and not while words for that deck wait in the note queue or are
  held offline, since the queue's own card on Today already says so.
- **Where:** a card on Today ("Español: 2 days of new cards left", `NewWordsCard.tsx`), whose x hides it
  until the next study day (kept in the Keychain), and an "Add new words" row in a finished session's
  Keep going list for that deck, a deck under it or the deck it's in (`useNewWordsStep`). Both open
  Suggested words (`src/ui/reader/SuggestedWords.tsx`, the `read-new-words` route). Mocked first; the
  owner picked a card on Today over a chip in Today's extras, and kept the session row too.
- **The words** (`GET /api/word-suggestions`, `word_suggestions.py`), neither source asking Claude:
  words in texts read to the end that count as unknown, by dictionary form, the most texts first; then
  the language's most common words from just past the `common` setting (Thai, which counts none, from
  the top). Up to 50 of each. Left out: anything in the deck in any form, studied or not; WaniKani's
  words for Japanese (the owner's choice); words in the note queue; and words dismissed with Not
  interested (`POST /api/word-suggestions/dismiss`, the `dismissed_words` table, never suggested again).
  The server's snapshot of the deck can be a day old, so the phone also leaves out what its own copy
  of the deck has (`entryKeys`, an entry with or without its article) and words held for Claude.
- **The screen** groups the words by source, each with its meaning when one is known (a text's gloss,
  the vocabulary check's, or the deck's) and its count of texts or its rank. About three days of new
  cards' worth start ticked (`wordsToTick`: three days at the daily limit over the deck's cards per
  note, at most 50, Quick add's limit), texts first. Add sends them to the note queue with no meaning,
  so Claude writes one rather than keeping a line's gloss as the owner's own. Nothing reaches the deck
  until each note is saved in the note editor, one at a time, as for Quick add.
- Other sources were considered and left for later by the owner's choice: Situations' leftover
  words, parts of compounds named in a note's Notes, missing aspect partners, topic and grammar words.

## Ask Claude about a card

The review screen's ⋯ menu has Ask Claude (`src/ui/AskCardSheet.tsx`, `src/core/askCard.ts`). The
learner types a question about the card on screen and `POST /api/ask-card` (`ask_card.py`) answers
it with Haiku; nothing is asked until a question is sent. The card goes as plain text (an
Omnilanguage note's word, meaning, example and mnemonic; any other note type as its template
renders), so a card of any note type can be asked about, and the language is sent only when the
note has one Read & Listen writes in. The conversation is kept only while the sheet is open and
sent again with each follow-up (cut to the latest 12 turns). Answers are text only: they never
grade a card. An answer isn't necessarily a mnemonic (it may be grammar or an example), so the
button "Add to the note's Notes" adds it to the Notes field under what's there (`withNotesAnswer`),
only for Omnilanguage notes; tapping the button, which names the field, is the approval. "Open in the Claude app instead" opens a
claude.ai/new link with the card and the typed question in the message box, for asking on the
learner's own Claude plan instead of the server's key; it works without Read & Listen. The prefilled
`q` on a plain new chat is documented for desktop only, so on iOS it may open claude.ai in the
browser. The cost is in `call_costs` (feature `ask_card`), not yet in `/api/costs`.

## Fix a flagged card with Claude

The flag sheet (`src/ui/AgentFlagSheet.tsx`) has Fix with Claude now beside Flag for later, shown
while Read & Listen is signed in. It flags the card as usual, then `POST /api/fix-card`
(`fix_card.py`) sends the note's fields (HTML as stored), the reason and the owner's note to Haiku,
once, only on that tap. The server returns `{changes: {field: new html}, explanation}` and writes
nothing: the app checks it again (`src/core/fixCard.ts`: only fields the note has, only ones that
change, and no `[sound:]` or `<img>` reference dropped or added), shows each changed field old above
new, and applies it through `saveNote` only when the owner taps Apply, which also clears the flag
and its tags. Not now keeps the flag for the MCP. A fix that needs a new recording or image comes
back with no changes and says so. The cost is in `call_costs` (feature `fix_card`), not yet in
`/api/costs`.

## Offline

The brief left offline mode out of milestone 1; it came back because the app is used on the subway.
Every request goes through the app's connection guard (`guardedFetch`, `src/core/connection.ts`):
with no network nothing is tried, and a request that stalls checks the server at once, giving up
in seconds when nothing answers, while a slow answer (a Claude explanation) is left to finish.

- **What the phone keeps:** the server's settings (`saveSettingsCopy`), so an offline launch still
  knows each language's deck for Today's extras and Review's glosses, and card glosses
  (`useCardGlosses`, the newest 3,000 sentences). Each copy is replaced when the server is read again.
- **Words added offline** (a gloss's Add, Quick add) are held on the phone (`src/reader/heldNotes.ts`)
  and sent to the note queue when the server can be reached; Today's queue card counts them. One
  the server refuses stays on the queue screen with its reason.
- **A new note's recording** is held the same way and made when the server answers.
- **The shelf's texts are kept on the phone with their line audio** (`src/reader/downloads.ts`,
  `src/ui/reader/readerDownloads.ts`, under the documents folder), downloaded by `ShelfDownloads` as
  Settings, Read & Listen, Download for offline says: Wi-Fi only by default, any connection, or
  off. It reads the shelves at launch, on coming back to the app and when the connection returns,
  and plans again whenever a screen reads one: the reader's own language (reading it is what opening
  the shelf does, so nothing is written that wasn't asked for), then every other language with
  texts ready, through `GET /api/shelf?language=`, which only reads that shelf: the reader's
  language stays, and nothing is topped up for it. A language with Slow speed on keeps the slow recordings
  too, made by Azure the first time as when played slowly; the rest play the normal recording at
  0.8x offline, as when slow can't be fetched. A text is kept whole or shown as not saved, and its
  copy is deleted once it leaves the shelf, or when the server gives the text differently (a voice
  change recorded it again).
- **Playing a shelf text keeps it** (`useKeepPlaying`, called as a line starts), on any connection
  unless the setting is Off: the text is already streaming over that connection, and the Wi-Fi only
  setting is for downloads nobody asked for. It keeps the same things as the automatic download (the
  text with its check questions, every line's recording, the slow ones where the language has Slow),
  and the lines saved so far play from the phone (`withOffline`'s `audioSource`) before the text is
  whole, so a tunnel mid-download doesn't stop it. A text played from Past texts or Listen again is
  kept the same way, marked `past`: the shelf plan leaves it alone and the shelf shown offline
  leaves it out, and only the latest ten stay (`pastOverflow`). What needs Claude (Explain, Retell) can't be kept.
- **Every screen gets the server through `withOffline`** (`src/reader/offlineApi.ts`, in
  `useReader`): a kept text opens from the phone when the server can't be reached, its lines play
  from the files online too, and the shelf shown offline is the kept texts under the heading
  Downloaded, less those read since. Switching language offline shows that language's kept texts;
  the switch is held and sent when the server answers, and until then the shelf stays the kept one,
  so it doesn't jump back to the server's language. Readings, listens and story choices made offline are held
  (`heldReader`) and sent in order by `HeldWork`, a choice before its reading, since the server
  refuses a choice for an episode already read. A reading sent late is dated when it arrives (the
  log has no time of its own) and counted once however often it's sent.
- **Audio lessons are kept when Download is tapped**, asking first on cellular unless the setting is
  Any connection, and deleted when removed or when the server's list no longer has them.
- What needs the server is left out offline: writing a text or the next episode, Past texts, the
  end view's "For the next ones".
