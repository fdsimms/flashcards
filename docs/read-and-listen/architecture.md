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
- **Listen only** (brief, design principle 6). Once a text is rated "About right", the end view
  offers to play it again with the Thai hidden; the lines show who's speaking instead, and "Show the
  text" brings the words back. The reading is then logged with `listen_only` true. The brief's
  "unlocks for a text" is read as "for the text just rated", since a text is never served twice.
- While audio plays, the text scrolls to keep the line being spoken in view.
- **Repeat line** in the player plays the current line over and over, for shadowing, until it's
  turned off.
- **Past texts**: texts read to the end, newest first (the last 50), opened in the same reader to
  read or listen to again. Reading one again isn't logged: the log is one row per text, and a reread
  shouldn't count toward the exit check or move difficulty. So there's no Done or rating, and words
  can be looked up but not marked unknown. One rated "About right" can be played listen-only straight
  away, since that's when the brief unlocks it.
- The reader's playback speed and the highlight switch are kept between launches, in the Keychain
  next to the passphrase (`src/reader/storage.ts`).
- **Progress** on the topics screen: finished texts over the last 14 days against the Milestone 1
  exit check (10 texts, median coverage 95% or more, most rated "about right"), and the coverage
  target and practice word count new texts are written at, so the effect of a rating is visible.
  Only finished readings count.
- **Marked words**: every word marked unknown in a reading, newest first, with its gloss and whether
  it's in the deck. "Clear" hides a word until it's marked again (`cleared_words` table).
- **Mining** (12 November 2026, by the owner's decision, ahead of the Milestone 1 exit check where
  the brief put it in Milestone 3). A marked word that isn't in the deck has **Add to deck**, which
  opens Franki's note editor on a new Omnilanguage note in the current language's deck, with the
  word and its gloss filled in. **Saving it is the approval** (brief, design principle 13): nothing
  reaches the deck otherwise, and the note goes into the collection as every note added in Franki
  does, reaching Anki at the next sync. At most `MINING_PER_DAY` (10) are added a study day
  (`src/reader/mining.ts`, counted on the phone), to protect the ~300 reviews/day ceiling (principle
  12). An added word is cleared from the list. The brief's "given audio" isn't done here: the note
  plays with the phone's voice until audio is recorded for it (the MCP's `add_tts_audio`).
- **Practice words after studying** (12 November 2026, by the owner's decision). When a Review
  session in a Read & Listen language's deck ends, **Read a text with these words** opens the
  topics screen with the words just studied (each note's Entry, `src/reader/practice.ts`); the
  topic opened next is written to practice them, and topics are as usual after it. The owner still
  picks the topic (principle 10). The app syncs before opening the topics screen, so the answers
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
- Mature and young both count as known for coverage. The prompt asks the model to favor mature words.
- **Partial:** a word that only appears inside a longer deck entry (รับ inside รับอะไรดี). It counts as
  unknown for coverage, and its gloss can point at the entry it came from.
- Only the latest snapshot is kept. No history.

## Languages

Spanish was added on 26 October 2026, by the owner's decision, ahead of the Milestone 1 exit check
and of Milestone 3 where the brief put it. Mining followed on 12 November 2026 (Client). Thai
works as before.

German, French, Russian, Greek, Polish and Norwegian (Bokmål) followed on 12 November 2026, at the
owner's request for "all my other languages" but English. Japanese is held back by the owner's
decision, to be tried with WaniKani's data instead; it would also need a word splitter like Thai's.
The Backlog decks (Portuguese, Italian, Esperanto, Chinese) were empty, and Loopless Letters is
Thai letters, so none of them is a language here. Each new language works as Spanish does
(`spaced.py`, below), with its own deck, voices, list of common words and grammar points
(Grammar). A language with no grammar points would say so on the Grammar screen.

- **Each language's deck is a setting** (12 November 2026, by the owner's decision): `decks` in
  `/api/settings`, chosen on the topics screen from Franki's decks, defaulting to the owner's. A
  language's skipped subdecks (Thai's consonant classes) are skipped under whichever deck is chosen
  (`with_deck`). Changing the deck forgets the old snapshot and reads the new deck at once, so a
  text is never written from the old deck's words; texts already waiting stay as they are. Another
  language still needs its deck, voices and rules for its entries in code (`languages.py`,
  `spaced.py`) and a list of common words (`scripts/build_common.py`).

- **One setting, `language`** (`th`, `es`, `de`, `fr`, `ru`, `el`, `pl` or `nb`), picks the
  language new texts are written and served in. It's a menu at the top of the topics screen. **Topics are shared**: a topic like "At a
  coffee shop" has texts in each language. The lexicon snapshot, ready texts, difficulty, progress,
  past texts, marked words, practiced stretch words and failures are per language. Only the current
  language is topped up in the background, so a second language doesn't double the spending.
  `server/reader/src/franki_reader/languages.py` holds what differs: the deck, the query, the voices,
  whether words are written with spaces, the default common-words count and what the prompt says
  about the variety (Mexican Spanish, Bokmål).
- **How many common words count as known is a setting for each language but Thai** (12 November
  2026, the owner's decision: they weren't sure of their level in each, and found 10,000 a stretch
  for every language, Spanish included): `common` in `/api/settings`, None, 1,000, 2,000, 3,000,
  5,000 or 10,000, chosen on the topics screen under the deck. The defaults are first guesses from
  each deck, to be moved by feel: Spanish keeps 10,000, so nothing changed under it; German, French,
  Russian and Greek, whose decks hold advanced words, 3,000; Norwegian, whose deck holds everyday
  words, 1,000; Polish, a beginner's deck, none, as the owner chose (only the deck counts, as for
  Thai). The count goes in each request, not the cached system prompt, so changing it costs no
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
- **Voices**: a male voice for A (and the narrator) and a female one for B, Azure's standard
  neural voices for the country, checked to exist with the MCP's `list_voices`: Mexican Spanish
  `es-MX-JorgeNeural` and `es-MX-DaliaNeural` (the owner's choice), German `de-DE-ConradNeural`
  and `de-DE-KatjaNeural`, French `fr-FR-HenriNeural` and `fr-FR-DeniseNeural`, Russian
  `ru-RU-DmitryNeural` and `ru-RU-SvetlanaNeural`, Greek `el-GR-NestorasNeural` and
  `el-GR-AthinaNeural`, Polish `pl-PL-MarekNeural` and `pl-PL-ZofiaNeural`, Norwegian
  `nb-NO-FinnNeural` and `nb-NO-PernilleNeural`. The speech request's language comes from the
  voice's name.
- **In the app**, a word known for being common rather than from the deck says "A common word" in
  its gloss, and outside Thai the highlight switch is "Highlight words you might not know". Every
  language but Thai is set a little smaller than Thai.
- **Topic ideas** are ranked by fit for Thai only: their words are Thai, so every other language
  keeps the listed order.
- The reading log names each language in English, lowercase (`thai`, `spanish`, `german`, `french`,
  `russian`, `greek`, `polish`, `norwegian`).

## Grammar

Added on 26 October 2026 at the owner's request: grammar to practice or avoid, for each language.

- **Points** (`server/reader/src/franki_reader/grammar.py`). Spanish: preterite, imperfect, present perfect,
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
  (left out, for grammar not learned yet) or **normal**. At most 2 are practiced at once, so texts
  stay natural; avoiding has no limit. The choices are stored together for every language and
  apply from the next text written (`GET /api/grammar`, `PUT /api/grammar/{id}`).
- **Generate, then verify, as for coverage.** The request names the points to practice and avoid,
  and the server finds them in the draft. A practiced point used fewer than twice, or an avoided one
  used at all, sends the draft back with the words named ("Don't use the Preterite; this draft has:
  hablé, dijo"). Among attempts that all miss, the closest kept is the one with the fewest grammar
  misses (uses short of a practiced point, plus uses of an avoided one), then the highest coverage;
  it's served if it's at 90% or more, like any closest attempt, so a slip is possible but rare.
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
  words are underlined solid; a word using an avoided point that slipped in is underlined dashed.
  Tapping either explains the grammar.
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
- **Revise rather than regenerate.** A text under the 95% floor goes back to the model with the
  unknown words named ("replace ทอน, กลิ่น"). At most 3 attempts in total.
- **The closest attempt is kept** (owner's decision, 26 October 2026, so texts don't fail for
  being a little short). If none of the 3 attempts reaches the floor, the one with the highest
  coverage is served, as long as it's at least 90% (`MINIMUM` in `coverage.py`); under 90% the text
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
  `server/reader/src/franki_reader/generator.py`.
- **A stretch word used fewer than 2 times** sends the text back too, even at full coverage.
- **Prompt caching.** The lexicon is the same on every call that day, so it sits in a cached prefix.
- **Glosses come with the text.** The model returns an English gloss for every word not in the
  lexicon in the same response, so tap-to-gloss never needs its own API call. Lexicon words use the
  deck's `Meaning`.
- **Stretch words** are 1-3 words due today or still young. No random assignment.
- **Stretch words come back on later days** (brief, design principle 4). A word that was a stretch
  word in a text read on an earlier day goes ahead of other due and young words, until it has been
  one on 3 different days (`RETURN_DAYS` in `server/reader/src/franki_reader/stretch.py`). It still has to be due
  or young, so a word that has matured since is left alone. In "Fit the topic" it's offered first,
  and the model may still pass it over if it doesn't fit.
- **Short stories** as well as dialogues: a "Text type" setting (`form` in `/api/settings`),
  applying from the next text written. A story is told by a narrator (speaker `N`), one or two plain
  sentences a line, and is spoken in voice A. The brief's feasibility test found narrative drops
  coverage faster than dialogue (92.3% against 96-100%), so stories are an option, not the default,
  and the floor and revision loop are the same for both: a story that can't reach the floor is
  served at its closest attempt if that's 90% or more, like any other text. The system prompt describes both forms, so its cached lexicon prefix is shared;
  the request names the form. Each text records its form (`texts.form`), so the log can show
  whether stories rate differently.
- **Dialogue length** is a setting: 6, 8 or 12 lines (`lines` in `/api/settings`), applying from the
  next text written. Longer dialogues have more room for unknown words before missing the floor.
- **The model chooses stretch words to fit the topic** (the default). It gets 15 due or young
  words and uses 1 to the current stretch count of them, so a dialogue about ordering food isn't
  bent around "tiger" because tiger happens to be due. The text records the ones it used. A text
  that uses none, too many, or one fewer than 2 times goes back for revision. The other setting,
  "Any due word", hands the model that many words to use, which keeps every due word in rotation at
  the cost of odder dialogues. It's a setting on the Topics screen (`GET`/`PATCH /api/settings`),
  stored on the server so background writes follow it, and like ratings it applies from the next
  text written. It's separate from difficulty on purpose: ratings decide how many stretch words and
  how much coverage; this decides only which words.

## Topics

- You keep a short list of favorite topics. The server keeps one ready text per favorite
  (`READY_PER_FAVORITE` in `engine.py`), topped up in the background after each request, so reading
  those never waits. A new topic, or a favorite whose text was just read, waits for one generation
  (about half a minute).
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
  `dropped`, never served, so its cost is still on record.
- A text leaves the queue once a reading is logged for it, rated or not, so the same text is never
  served twice.
- **Topic ideas**, so topics don't all have to be thought up. About 30 everyday situations
  (`server/reader/src/franki_reader/suggestions.py`), each with six Thai words it's likely to need, offered on
  the topics screen a few at a time, ordered by how many of those words the deck knows: the best fit
  is most likely to clear the floor on the first try. The owner still picks (brief, principle 10).
  A fixed list rather than generated ideas, so offering them costs nothing. Tapping one adds it as a
  topic that isn't a favorite and opens it, so trying an idea doesn't start a queue of texts for it;
  starring it does. Topics already added, or added and removed, aren't offered again.
- **Removing a topic** (press and hold it) hides it from the list and the background top-up. It's
  a flag on the row, not a delete, since its texts and readings point at it. Adding a topic with the
  same name brings it back, with any text it still had ready.

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

## Audio

- Azure neural voices, one per speaker: `th-TH-NiwatNeural` (male) for A and `th-TH-PremwadeeNeural`
  (female) for B. `AZURE_VOICE_A` and `AZURE_VOICE_B` in `server/.env` override them without a code
  change (the other languages' are set in `languages.py`). Since 12 November 2026 each speaker's voice can be
  chosen in the app (Read & Listen's settings, from `GET /api/voices`), stored in the `voices`
  setting over those defaults; a change re-records the texts waiting to be read, and a text already
  read keeps its audio. The same server also speaks a card's word for the app (`POST /api/speech`,
  Settings > Voices in Franki), which keeps the MP3 in the note, so each recording is asked for
  once. Azure is
  called through the client shared with the MCP (`server/speech`, `franki_speech`, since 12 November
  2026), whose docstring says which parts of the API were checked; the first real call is the check
  for the rest.
- In Thai, each space between clauses becomes a 300 ms SSML `<break>` (`THAI_PAUSE` in
  `franki_speech`), since a voice may not pause at a bare space. It applies to the MCP's
  `add_tts_audio` too. Audio already cached keeps no pauses.
- Each line is spoken once at normal speed and cached as an MP3 on the volume
  (`READER_AUDIO_DIR/<text>/<line>.mp3`). A new text gets its audio before it counts as ready; a line
  with no audio yet is made when it's first asked for, which covers texts written before the Azure
  key was set. An Azure failure leaves that line silent and never blocks the text.
- The 0.7x to 1.0x speed control is the player's rate with pitch kept (`expo-audio`), so there's one
  file per line whatever the speed. "Play" runs the dialogue line by line; each line has its own
  replay button. Playback continues with the ringer on silent and the screen locked; the player
  keeps the audio session active between lines, or iOS could suspend the app in the gap. A line
  whose audio fails to load is skipped with a note. Thai plays over other audio (a podcast keeps
  going), as the owner chose.
- The app fetches audio itself, with the passphrase in the request's headers.
- The `expo-audio` plugin is configured with no microphone permission: the app never records.

## Logging

- Per text: date, language, mode, token count, verified coverage, stretch words, words glossed,
  words flagged unknown, rating, audio speed, listen-only or not, time spent.
- The rating adjusts the difficulty of texts written after it (too hard: coverage target up 1
  point, one fewer stretch word; too easy: the reverse), within a 95% to 99% target and 1 to 3
  stretch words (`server/reader/src/franki_reader/difficulty.py`). A text already waiting in a favorite's queue
  keeps the difficulty it was written at, so a rating shows up one text later; the owner chose that
  over discarding queued texts (19 October 2026). The Milestone 1 exit check reads the log.
- A reading posted twice for the same text (a retried request) is counted once.
- Each text also records the model that actually answered (a refusal fallback can change it), its
  tokens and its cost in dollars, dropped texts included, so the real cost per text can be read
  straight from the `texts` table.
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
