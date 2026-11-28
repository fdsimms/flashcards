"""The HTTP API the iOS app calls. Every /api route needs the passphrase as a bearer token
(docs/read-and-listen/architecture.md, Hosting); /health doesn't, so it shows whether the server is up. Caddy
serves all of it under /reader (../../Caddyfile), so the app's address ends in /reader.
Each route's code is in routes/, one module per area; create_app builds them here.

    GET   /api/check                  204 if the passphrase is right
    GET   /api/status                 what's due in Anki now and whether a Read & Listen text is
                                      waiting, for another app (dundundun). Opens with the
                                      passphrase or STATUS_TOKEN, a key for this route alone:
                                      {reviews, learning, learning_later: [{at, count}],
                                      decks: [{name, reviews, learning}], day_ends_at,
                                      read_and_listen: {language, name, waiting, last_read_at},
                                      read_and_listen_languages: [{language, name, waiting,
                                      last_read_at}] (every language the app shows),
                                      read_and_listen_today: [{language, name, mode, waiting,
                                      done}] (the languages that get a reading task today,
                                      chosen by read_plan.py),
                                      study_days: [{starts_at, cards, answer_seconds,
                                      reading_seconds, reading_seconds_by_language: {code:
                                      seconds}] (the last 7 study days, today last),
                                      franki: {due, new, reported_at} or null (Franki's own deck
                                      list counts, progress gates included, when it reported
                                      them since today's study day began)}
    PUT   /api/franki-counts          {due, new} the app's deck list totals, sent after each sync
                                      while the app's "Share today's counts" setting is on
    GET   /api/topics                 topics with their state and ready count; tops up in the background
    POST  /api/topics                 {name} adds a topic (or returns the existing one)
    DELETE /api/topics/{id}           removes a topic from the list (adding it again brings it back)
    GET   /api/suggestions            topic ideas not yet added, the best fit for the deck first
    POST  /api/topics/{id}/next       the next text for a topic; 202 {"writing": true, "stage":
                                      writing | translating | recording | null} while one is
                                      being written in the background, so ask again shortly. With
                                      {words: [...]}, a text written to practice those words
    GET   /api/settings               {stretch_words: "topic" | "any", lines: 6 | 8 | 12,
                                      form: "dialogue" | "story", language: "th" | "es" | ...,
                                      decks: {th: <deck>, es: <deck>, ...},
                                      cast: {th: {girl: {voice, pitch}}} the voice and pitch for a
                                      kind of story character (man, woman, boy, girl, elder_man,
                                      elder_woman); null puts one back to the default
                                      voices: {th: {male: <voice>, male2: <voice>, female: <voice>,
                                      female2: <voice>}, es: {...}, ...}, a text's speakers are
                                      read in the voice of their gender (second voices for a
                                      dialogue between two men or two women),
                                      common: {es: 10000, de: 3000, ...}} (every language but
                                      Thai: how many of its most common words count as known)

Topics are shared by every language. Everything else (ready texts, /next, progress, past texts,
marked words, ideas) is in the current language, the `language` setting.
    PATCH /api/settings               the same fields; takes effect from the next text written. A
                                      changed deck is read again at once; texts waiting to be read
                                      are spoken again in changed voices
    GET   /api/shelf                  the current language's shelf: the texts waiting (each
                                      with why it's there), the pinned story and its next episode,
                                      what's being written, and each language's
                                      count of texts waiting; tops up in the background
    POST  /api/shelf/write            {name, form} writes a text on a topic typed in; it joins the
                                      shelf when it's ready (202)
    POST  /api/own-texts/preview      {language, text, title?} what adding a pasted text would give:
                                      its coverage, new words, parts and cost (own_text.py)
    POST  /api/own-texts              the same, adding it: its parts are translated and recorded,
                                      then join the shelf's own row (202)
    POST  /api/story                  {about?} starts a new story in the current language, beside
                                      those running, and writes its first episode (202)
    GET   /api/stories                the current language's stories, running then ended, and which
                                      one is pinned to the shelf's card
    GET   /api/stories/{id}           one story as the card has it (Last time, practice words), for
                                      its own page; 404 if there's no such story
    POST  /api/stories/{id}/pin       pins a running story to the shelf's card; 404 if it isn't running
    POST  /api/stories/{id}/end       ends a story (no more episodes); 404 if it already has
    POST  /api/stories/{id}/continue  runs an ended story again; 404 if it's running
    POST  /api/texts/{id}/skip        takes a text off the shelf unread (Not this); 404 if it isn't
                                      waiting
    GET   /api/texts                  texts read to the end, newest first, to read again; with
                                      ?story=<id>, that story's episodes, first to last
    GET   /api/texts/{id}             one text, in the same shape as /next; reading it again isn't logged
    POST  /api/texts/{id}/reading     logs a session with a text and adjusts difficulty, from its
                                      rating and the check after reading's score (check_right of
                                      check_asked, both left out when it wasn't taken)
    POST  /api/texts/{id}/choice      {choice} the option picked at the end of a story episode, as an
                                      index into its choices; it can be changed until the episode is
                                      read, which is when the next one is written from it (404 for
                                      no such text or choice, 409 once it's read)
    GET   /api/relisten?listens=3     finished texts due to be heard again (relisten.py); 3, 1 or 0
                                      listens wanted per text
    POST  /api/texts/{id}/listen      counts a finished text heard again (204; 404 if never read)
    POST  /api/reading-lines          {language, words: [str]} lines from texts read that use each word,
                                      up to 5 a word, one a text, the latest read first: {lines: {word:
                                      [{text_id, title, line, english}]}}, for a card's answer side
    GET   /api/input-time             {days, languages: [{language, reading_seconds, listening_seconds,
                                      last_read_at}]} time read and listened to in each language over
                                      the last 7 days, most first; it only reports
    GET   /api/progress               finished texts, coverage and ratings over the last 14 days,
                                      the check after reading's answers over them, how well the
                                      known words were recognized (recognition.py), and the
                                      difficulty the next text is written at
    GET   /api/audit/texts            every language's texts for review, newest first (audit.py,
                                      the MCP's list_read_and_listen_texts): ?language, story, days,
                                      limit, status (shown, the default; skipped; dropped; all)
    GET   /api/audit/texts/{id}       one of them in full, with `asked`: what Claude answered when
                                      its lines were asked about (Explain, natural, phrase, form)
    GET   /api/audit/lessons          audio lessons of every state with their marks' count
                                      (?language, days, limit); /api/audit/lessons/{id} one in full:
                                      phrases, dialogue, script and the phrases marked
    GET   /api/audit/grammar          ?language every grammar page Claude wrote: Your topics
                                      ("topic") and the points' lessons ("point");
                                      /api/audit/grammar/{kind}/{id} one in full
    GET   /api/audit/practice         ?kind (drill, sentence, vocab, meaning, sentence_meaning),
                                      language, point, word, days, limit: the practice items Claude
                                      wrote, newest first, with what their batches asked and kept.
                                      Every /api/audit route only reads: it never starts a write
    GET   /api/exposure-effect?days=90  whether stretch words were remembered better at their
                                      next review than similar words (exposure_effect.py)
    GET   /api/costs?days=30          what Claude cost over the last `days` days, per language:
                                      texts read, waiting, dropped and skipped, attempts and dollars,
                                      plus Azure's audio estimated from the characters it spoke (every
                                      language, not just the current one; the MCP's
                                      read_and_listen_costs reads it). Then, over the same days,
                                      apart from the texts: `explanations`, what Explain's calls
                                      (lines and phrases) and the naturalness check cost;
                                      `drills`, `meanings` (glossing common words), `vocab_checks`
                                      and `note_queue`; `mnemonics`, memory hints; `questions`,
                                      the check after reading's questions (comprehension.py);
                                      `forms`, the grammatical form picked for a text's inflected
                                      words (forms.py); and
                                      `recordings`, the cards recorded through /api/speech, as
                                      Azure's characters and their estimate. A call that failed
                                      after Claude answered was still paid for, and counts in its
                                      feature's figure
    GET   /api/grammar                the current language's grammar points, each practice, avoid,
                                      normal ("Know it") or unset, with how often each came up in
                                      texts read; `least`, the known ones worked in next;
                                      `stretch`: {uses, next}, how many times a text may use
                                      grammar not set, and the easiest point to practice next
    GET   /api/grammar/choices        {choices}: every language's choices by point id (practice,
                                      avoid or normal; a point not set isn't listed), for the
                                      app's Forms practice (docs/grammar.md)
    POST  /api/drills                 {points, count?} a grammar drill's questions (drills.py), each
                                      {kind: "which", point, line, words, english, title, choices}
                                      or {kind: "gap", id, point, before, answer, after, english,
                                      wrong, hint}; `missing` names points that got none. Writes
                                      more gap questions in the background when Claude is set up.
                                      A word_named point (its name is the word itself: Thai's, Greek
                                      θα) gets gap questions only, half from its own stock and the
                                      rest from its related word_named points', each carrying
                                      "for": the drilled point's id (a rival's question has another
                                      "point"); the rivals' stock is written too
    GET   /api/vocab-check?language=pl   the vocabulary check's questions (vocab_check.py): {state:
                                      "ready", items: [{word, rank, meaning, wrong}]} without the
                                      deck's words, or "preparing" (Claude is writing them, ask
                                      again soon), "failed" or "unavailable"; not for Thai. The
                                      quiz and its scoring are in the app
    GET   /api/note-queue             the owner's queued words (note_queue.py): {available, items: [{id,
                                      language, deck, entry, meaning, state: "waiting" | "ready" |
                                      "failed", fields, error}]}. `fields` is what Claude filled in,
                                      by Anki field name, for a ready word. Starts filling any that are
                                      due; the app asks again every few seconds while some are waiting
    POST  /api/note-queue             {language, deck, entries: [{entry, meaning?}]} queues words for
                                      Claude to fill in; 503 without a Claude key. A ready word also
                                      has `spelling`, how it's really written when it was typed the
                                      way it sounds (else empty), and `alternatives`, the other words
                                      it could be ([{spelling, meaning}])
    POST  /api/word-lookup            {language, meaning}: words for a meaning typed in English
                                      (word_lookup.py, Quick add's "Don't know the word?"): {words:
                                      [{entry, meaning, note}]}; 503 without a Claude key
    POST  /api/note-queue/{id}/retry  a failed word waiting to be filled again
    DELETE /api/note-queue/{id}       takes a word off the queue (after the app saves it, or on remove)
    GET   /api/word-suggestions       ?language=: words to add when the deck's new cards run low
                                      (word_suggestions.py): {texts, common, written: [{word, meaning,
                                      rank, texts}], written_error}, from texts read and the common
                                      words the deck lacks; for English, no common words, but rare
                                      ones Claude writes (rare_words.py, kept in `written_words`,
                                      asked again only when fewer than 20 are left; its cost is kept
                                      in `call_costs`, feature "rare_words"; `written_error` says why
                                      none came, "" when nothing went wrong)
    POST  /api/word-suggestions/dismiss  {language, word}: Not interested, never suggested again
    GET   /api/grammar/{id}           one point's page: {id, state, seen, choices (its language's,
                                      for the related points), examples: [{text_id, title, line,
                                      english, words}]}, lines from texts read, the latest first;
                                      `?examples=1..6` (default 3) sets how many, and `?shuffle=<int>`
                                      a random sample of that many instead, from that seed
    PUT   /api/difficulty             {level: harder | standard | easier}: the text difficulty (93%, 95%
                                      or 97% known words) for the language, from the next text written
    PUT   /api/grammar/stretch        {uses: 1 to 4}: how many times the next texts may use grammar
                                      not set (the Grammar dial on the wrap-up screen); answers as
                                      GET /api/grammar does
    PUT   /api/grammar/level          {through: 5 to 1}: "I know through N_" (Japanese): each point
                                      at that JLPT level or easier becomes Know it unless it's
                                      practiced, each above it Don't know it; answers as GET
                                      /api/grammar does, where each point has its `jlpt`
    PUT   /api/grammar/{id}           {state}; at most 2 practiced at once; from the next text
    GET   /api/forms?language=ru      the grammatical forms a word can be marked as in that language
                                      and the primer for each (form_primers.py): {forms: [{id, name,
                                      summary, table, examples}]}; none for Thai, which has no
                                      inflection
    GET   /api/words                  words marked unknown and not cleared, newest first
    POST  /api/words/clear            {word} takes a word off that list until it's marked again
    POST  /api/ranks                  {language, words: [...]} each word's place among the language's
                                      most common words (frequency.py): {ranks: {word: place | null}},
                                      null past the list's end. Read-only; the MCP orders new cards by it
    GET   /api/texts/{id}/lines/{n}/audio   one line's MP3, made now if it isn't cached yet;
                                      `?speed=slow` is the one Azure speaks slowly (tts.SLOW_RATE)
    GET   /api/texts/{id}/lines/{n}/slow    records the slow one if needed, and `{times}` for its words
    GET   /api/voices?language=th     Azure's voices in a language (any code: th, pl, es-MX) and then
                                      its Multilingual voices of other locales, for the speakers
                                      here and for recording cards in the app
    POST  /api/cast/sample            {language, voice, pitch?, gender?} one line a story character
                                      might say, spoken in that voice at that pitch (a percent
                                      change), as MP3: the Story characters screen's way to hear a
                                      choice before making it
    POST  /api/cast/scene             {language} a short scene read by the narrator, a girl and a
                                      woman in the voices a story would give them now, as one MP3
    POST  /api/speech                 {text, voice, rate?, language?} the text spoken by an Azure
                                      voice, as MP3: the app records a card's audio with it and
                                      keeps the file, so each recording is asked for once. The
                                      language (th-TH, or th) tells a Multilingual voice what to read
                                      the text as
    POST  /api/texts/{id}/lines/{n}/explain   {simple?, in_language?} the line's grammar and vocabulary explained in
                                      English by Claude: {points: [{phrase, note}]}. Asked on the
                                      owner's tap and kept per line (and per simple version).
                                      With `grammar`: the points the finders find in the line,
                                      each {id, name, note, state}, as the choices stand now
    POST  /api/texts/{id}/lines/{n}/form      {word, lemma, form, helper?} why the word has that form (form quiz)
    POST  /api/texts/{id}/lines/{n}/phrase    {phrase, simple?, in_language?} a phrase the owner selected in the
                                      line, as it appears there, explained by Claude:
                                      {meaning, literal ("" when it matches the meaning; absent
                                      from an answer kept earlier), points: [{phrase, note}]}.
                                      Kept per phrase, like
                                      the line's
    POST  /api/texts/{id}/lines/{n}/natural   whether a native speaker would say the line, judged by
                                      Claude: {verdict, reason, alternative}, verdict one of
                                      natural, stiff, unusual. Asked on the owner's tap and kept
                                      per line
    POST  /api/texts/{id}/lines/{n}/ask       {phrase, turns: [{role, content}], in_language?} the answer
                                      to the owner's question about a phrase selected in the line,
                                      from the conversation so far (the last turn is the new
                                      question): {answer}. Asked only when a question is sent, not
                                      kept. 503 without Claude. Its cost is kept in `call_costs`
                                      (feature "ask_phrase") and counts under explanations in
                                      /api/costs
    POST  /api/videos/preview         {language, link} what adding a YouTube video would give (video.py):
                                      its title, channel, length, whether its subtitles are
                                      YouTube's automatic ones, and the own-text preview (coverage,
                                      new words, lines, cost). 422 with the reason when it can't be
                                      added (no subtitles in the language, too long, not a link)
    POST  /api/videos                 {language, link} -> 202 {id}: the video's subtitles as a text
                                      on the own row, translated and glossed in the background, not
                                      recorded (the video is their sound)
    GET   /api/podcasts/search        ?language&term shows in Apple's podcast directory (podcast.py),
                                      the first few saying whether their episodes have transcripts
    POST  /api/podcasts/episodes      {link} a show's episodes, newest first, from its feed or an
                                      Apple Podcasts link (and the episode it names: `picked`)
    POST  /api/podcasts/preview       {language, feed, guid} what adding an episode with a transcript
                                      would give: coverage, new words, lines, length, cost. 422 when
                                      it has no transcript with times, or is over two hours
    POST  /api/podcasts               {language, feed, guid} -> 202 {id}: the episode's transcript as
                                      a text on the own row, translated and glossed, not recorded
    POST  /api/native/find            {language, words} each word's native speakers' recordings on
                                      Wikimedia Commons (franki_speech.commons: Lingua Libre's,
                                      then Wiktionary's older files), each with its speaker,
                                      license and credit: {results, pending}. Up to 3 new words
                                      are looked up while it waits; the rest come back `pending`
                                      and are looked up in the background. Kept 180 days (30 when
                                      none was found). 503 when Commons can't be reached
    GET   /api/native/audio?title     a found recording, trimmed and leveled, as MP3 (kept on disk)
    GET   /api/journal?language&days  the writing journal (journal.py): {entries, kinds, idea,
                                      checks}: entries newest first, the kinds of mistake their
                                      first checks found in the last `days` days (60; 0 for all)
                                      most frequent first with the latest example, and the study
                                      day's idea with a few of the words being learned. Reads only
    POST  /api/journal/check          {language, text, prompt?, entry_id?, key?} an entry checked by
                                      Claude sentence by sentence and kept: a new one, or
                                      `entry_id` written again (its first check's mistakes stay
                                      as counted). A `key` already checked comes back with no
                                      call. 503 without Claude or when the check fails (its cost
                                      kept, feature "journal")
    GET   /api/journal/{id}           one entry with its latest check
    DELETE /api/journal/{id}          deletes an entry and its mistakes from the counts
    POST  /api/production/check       {kind, language, attempt, word?, meaning?, english?, reference?}
                                      the owner's own writing checked by Claude (production.py):
                                      a sentence with `word` (kind "sentence") or their way of
                                      saying `english` (kind "translate", `reference` the sentence
                                      written for it): {verdict, corrected, english, notes,
                                      used_word}, verdict one of right, almost, wrong. Asked on the
                                      owner's tap, never kept
    POST  /api/texts/{id}/retell      {attempt} the owner's retelling of the text, checked the same
                                      way, plus {words: [{word, english, line}], left_out}: words
                                      from the text it could have used, and what it left out
    POST  /api/sentences              {language, count?} sentences to say (sentences.py), one a
                                      word, reviewed-today words first: {sentences: [{id, word,
                                      meaning, sentence, english, reviewed_today}], writing}. More
                                      are written in the background; never a word waiting for its
                                      review
    GET   /api/situations/scenes      ?language= scenes to pick from for Situations (situations.py):
                                      everyday situations, best fit to the deck first (Thai)
    GET   /api/grammar-topics         ?language= "Your topics" (grammar_topics.py): grammar pages
                                      the owner asked for by name, newest first: {topics: [{id,
                                      title, status: writing | ready | failed, created_at}]}.
                                      (Not /api/topics, which is the reading topics above)
    POST  /api/grammar-topics         {language, title} (1 to 80 characters): 202 with the page,
                                      status "writing", written by Claude in the background; a
                                      title already there (any case) answers 200 with that page and
                                      no new call. 409 past 30 pages a language, 429 past 10 writes
                                      in a study day (every page's, regenerations too), 503 without
                                      Claude. The page: {id, language, title, status, note, lead,
                                      explanation, examples: [{line, english, words}], created_at}.
                                      Poll GET /api/grammar-topics/{id} while it's "writing"
    GET   /api/grammar-topics/{id}    the page; 404 once deleted. A page that was never written is
                                      "failed" with a `note`; a rewrite or new examples that
                                      failed leave the old page "ready" with the `note`, cleared by
                                      the next write that works. Nothing is graded or scheduled
    POST  /api/grammar-topics/{id}/examples  202: a fresh set of examples replaces the old when
                                      they pass (the old stay shown, status "writing", meanwhile)
    POST  /api/grammar-topics/{id}/rewrite   202: lead, explanation and examples written again
    DELETE /api/grammar-topics/{id}   204, also when it's already gone
    POST  /api/situations/turn        {language, scene, roles?, lines: [{speaker, text}], focus?}
                                      `focus` {title, lead}: a grammar structure (one of Your
                                      topics) the other person works in and invites the learner to
                                      use, without explaining it. The other person's
                                      person's next line, written by Claude from the deck's words:
                                      {line, english, words: [word], unknown, done, roles?, audio}.
                                      The first turn (no lines) also sets `roles` {you, them, name,
                                      gender}, which the app sends back on every turn after. `audio`
                                      is a clip's key, or null. Nothing is kept: the app holds the
                                      conversation
    POST  /api/situations/feedback    {language, scene, roles, lines, focus?} at the end: each of the
                                      owner's lines checked {index, verdict, corrected, note}, and
                                      words worth adding {word, english, why: asked | heard}. With
                                      `focus`, the notes say how their lines used that structure
    POST  /api/situations/slow        {language, gender, line} one of their lines spoken slowly: {audio} is the
                                      clip's key, recorded the first time
    GET   /api/situations/audio/{key} a clip of one of the other person's lines (MP3)
    POST  /api/lessons                {language, scene, narrator?, particle?} an audio lesson on a scene
                                      (lesson.py), made in the background: {id}. `narrator` is an
                                      English Azure voice (en-US-GuyNeural) for this lesson. every language but Japanese and English (`languages`
                                      in GET). At most 2 at a time
    GET   /api/lessons                ?language= {languages, lessons: [{id, language, scene, title,
                                      state: making | ready | failed, stage: writing | recording |
                                      joining (while making), error, duration_ms,
                                      created_at, phrases, dialogue, pauses: [[start, end]]
                                      ms where the learner speaks, or null until found in an older
                                      lesson (found in the background)}], review, lines: the
                                      drill on offer (line_drill.py) or null}, newest first
    POST  /api/lessons/lines          {language, narrator?, particle?} Lines from your reading: a
                                      lesson of lines from texts read lately, asked in English and
                                      answered by their own recordings, no Claude call: {id}
    POST  /api/lessons/topics         {language, phrases?: [{text, english}], shown?: [str]} ideas for
                                      a lesson's scene, written by Claude: {topics: [str]}, never
                                      one already made as a lesson or in `shown`. 503 without
                                      Claude. Its cost is kept in `call_costs` (feature
                                      "lesson_topics") and counts under `lesson_topics` in
                                      /api/costs
    POST  /api/cram/themes            {language, words: [{id, text, english, kind: carried | missed |
                                      fresh | deck}], weak_spots?, avoid?, stretch?} themes to talk
                                      about at a lesson, written by Claude from the words:
                                      {themes: [{title, why, word_ids, new_words: [{word,
                                      english}], questions: [{text, english}], story}]}. 503
                                      without Claude. Its cost is kept in `call_costs` (feature
                                      "cram_themes") and counts under `cram_themes` in /api/costs
    POST  /api/cram/say/ask           {language, topic?, turns?: [{asker: claude | you, text}]} the
                                      next question of a talk in English about a lesson's topic:
                                      {question}. 503 without Claude. Its cost is kept in
                                      `call_costs` (feature "cram_say")
    POST  /api/cram/say/lines         {language, said, topic?, words?: [{id, text, english, kind}]}
                                      what the learner would want to say, from what they said in
                                      English: {summary, lines: [{english, text, known, missing:
                                      [{word, english}]}]}, built from their words. 503 without
                                      Claude. Its cost is kept in `call_costs` (feature "cram_say")
    GET   /api/lessons/{id}/audio     the lesson's MP3, once it's ready
    POST  /api/lessons/{id}/heard     the lesson was played to the end, so a later lesson may open by
                                      asking for its phrases (204; 404 with no such lesson)
    DELETE /api/lessons/{id}          forgets the lesson and its audio
    POST  /api/mnemonics              {language, entry, meaning, transliteration?, context?} three
                                      memory hints for a word the owner keeps forgetting: {hints: [...]}
    POST  /api/ask-card               {language?, front, back, details?, turns: [{role, content}]} the
                                      answer to the owner's question about the card on screen, from
                                      the conversation so far (the last turn is the new question):
                                      {answer}. Asked only when a question is sent. 503 without
                                      Claude. Its cost is kept in `call_costs` (feature "ask_card"),
                                      not yet in /api/costs
    POST  /api/lessons/words          {language, text} the words in the language what the learner typed in Add a
                                      phrase (romanization, the language or English) could mean, for
                                      them to pick one: {candidates: [{text (in the language's own
                                      script), reading, english}]}, none when nothing real fits. Any
                                      language lessons are made in. It writes nothing; asked only on Find
                                      word. 503 without Claude. Its cost is kept in `call_costs`
                                      (feature "lesson_words")
    POST  /api/cram/words             {language, topic?, facts?, focus?, exclude?: [word]} about eight
                                      words in the language's own script for what a cram is for
                                      (Suggest words), leaving out `exclude`: {words: [{text, reading,
                                      english, commonness, register}]}. It writes nothing; the app
                                      tags the ones the deck has and queues the rest. Asked when the
                                      screen opens, on a typed focus and on More words. 503 without
                                      Claude. Its cost is kept in `call_costs` (feature "cram_words")
    POST  /api/cram/phrases           {language, topic?, facts?, focus?, words?: [{text, english}],
                                      exclude?: [phrase], register?, particle?} about six short phrases
                                      in the language for what a cram is for, built from the cram's
                                      words and words the learner knows (Suggest words, Phrases):
                                      {phrases: [{text, reading, english}]}. It writes nothing; the
                                      app keeps the checked ones on the cram. 503 without Claude. Its
                                      cost is kept in `call_costs` (feature "cram_phrases")
    POST  /api/fix-card               {language?, fields: {name: html}, reason, note?, chat?} a fix for a
                                      card the owner flagged, or asked for in an Ask Claude chat (`chat`, the
                                      last 12 turns): {changes: {field: new html}, explanation}, only the
                                      fields that change (none when Claude can't fix it from text). It
                                      writes nothing: the app applies it when the owner taps Apply. Asked
                                      only on Fix with Claude now or Change the card. 503 without Claude. Its
                                      cost is kept in `call_costs` (feature "fix_card")
    POST  /api/wanikani-senses        {words: [{id, characters, glosses, sentences: [{ja, en}]}]} which of a
                                      WaniKani word's glosses are different senses, asked by the app
                                      before it saves a batch of production notes (wanikani_senses.py):
                                      {words: [{id, glosses: [[index]], sentences: [index], labels}]},
                                      only the words with two or three senses. It writes nothing. 503
                                      without Claude. Its cost is kept in `call_costs` (feature
                                      "wanikani_senses")
    POST  /api/aspect-pair            {language, word, line?} a Russian or Polish verb's aspect and its aspect
                                      partner, written by Claude for the note editor to check, asked
                                      only on Add to deck: {aspect, partner, partner_meaning,
                                      aspect_source}, all null when there's none to suggest. 422 for
                                      another language, 503 without Claude. Its cost is kept in
                                      `call_costs` (feature "aspect"), not yet in /api/costs
    POST  /api/glosses                {language, sentences: [{text, english?}]} cards' example
                                      sentences split and glossed as a text's lines are, for the
                                      app's word popovers on a card: {ready, sentences: [[word]]},
                                      in the order sent. `ready` is false (and `sentences` empty)
                                      until the language's deck has been read. Asked once for a
                                      whole study session; afterwards, in the background, reads the
                                      deck if it's a day old and has Claude gloss the words that
                                      had no meaning, so they have one next time
"""

import hmac
import ipaddress
import logging
import math
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

import anthropic
import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from franki_speech import SpeechClient
from franki_speech.commons import Commons

from franki_reader import (
    ai_ipa,
    ask_card,
    ask_phrase,
    aspect,
    comprehension,
    config,
    cram_phrases,
    cram_say,
    cram_themes,
    cram_words,
    drills,
    fix_card,
    forms,
    grammar_lessons,
    grammar_topics,
    journal,
    lesson_topics,
    lesson_words,
    lesson_writer,
    meanings,
    note_queue,
    own_text,
    podcast,
    production,
    rare_words,
    sentences,
    situations,
    store,
    topic_image,
    video,
    vocab_check,
    wanikani_senses,
    word_lookup,
    written_points,
)
from franki_reader.collection import AnkiDeck, SyncSettings
from franki_reader.cram_themes import WriteThemes
from franki_reader.engine import Engine
from franki_reader.explain import (
    CheckNatural,
    Explain,
    ExplainForm,
    ExplainPhrase,
    claude_check,
    claude_explain,
    claude_explain_form,
    claude_explain_phrase,
)
from franki_reader.gateway import (
    ReadDue,
    ReadReviews,
    due_with_timeout,
    reviews_with_timeout,
    with_timeout,
)
from franki_reader.generator import (
    EFFORT,
    MODEL,
    Ask,
    Effort,
    TextModel,
    claude_ask,
)
from franki_reader.languages import Code
from franki_reader.lesson_topics import WriteTopics
from franki_reader.lesson_writer import WriteGiven, WritePlan
from franki_reader.lexicon import Entry
from franki_reader.mnemonics import (
    MakeMnemonics,
    claude_mnemonics,
)
from franki_reader.routes import AREAS
from franki_reader.routes.context import AppContext
from franki_reader.study_day import DEFAULT_ROLLOVER
from franki_reader.tts import (
    AudioCache,
    ClipCache,
    Speech,
    azure_synthesize,
    azure_synthesize_parts,
    azure_transcribe,
)
from franki_reader.wanikani import wanikani_reader

# Wrong passphrases from one source before it's refused for a while (refuse_if_guessing).
MAX_WRONG = 20
WRONG_WINDOW = 15 * 60


def client_source(request: Request) -> str:
    """Where a request came from, as the wrong-passphrase limit counts it: the address uvicorn gives
    (Caddy's X-Forwarded-For, believed only from the proxy's network: start.sh), an IPv6 one by its
    /64, since a connection is usually given a whole /64. The MCP counts its password page the same way."""
    host = request.client.host if request.client else ""
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return host
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped:
            return str(ip.ipv4_mapped)
        return str(ipaddress.ip_network(f"{ip}/64", strict=False))
    return str(ip)


def create_app(
    engine: Engine,
    passphrase: str | None,
    speech: Speech | None = None,
    mnemonics: MakeMnemonics | None = None,
    explain: Explain | None = None,
    explain_phrase: ExplainPhrase | None = None,
    explain_form: ExplainForm | None = None,
    status_token: str | None = None,
    read_due: ReadDue | None = None,
    read_reviews: ReadReviews | None = None,
    write_drills: drills.WriteDrills | None = None,
    write_vocab: vocab_check.WriteVocab | None = None,
    write_notes: note_queue.WriteNotes | None = None,
    check_natural: CheckNatural | None = None,
    check_attempt: production.CheckAttempt | None = None,
    check_journal: journal.CheckEntry | None = None,
    check_retell: production.CheckRetell | None = None,
    write_sentences: sentences.WriteSentences | None = None,
    play: situations.Play | None = None,
    give_feedback: situations.GiveFeedback | None = None,
    write_topic: grammar_topics.WriteTopic | None = None,
    read_topic_image: topic_image.ReadTopic | None = None,
    clips: ClipCache | None = None,
    write_grammar_lesson: grammar_lessons.WriteLesson | None = None,
    write_lesson: WritePlan | None = None,
    write_given_lesson: WriteGiven | None = None,
    write_lesson_topics: WriteTopics | None = None,
    lessons_dir: Path | None = None,
    commons: Commons | None = None,
    fetch_captions: video.FetchCaptions | None = None,
    podcasts: podcast.Podcasts | None = None,
    transcribe: podcast.Transcribe | None = None,
    native_dir: Path | None = None,
    clip_episode: podcast.ClipEpisode | None = None,
    clips_dir: Path | None = None,
    write_aspect: aspect.WriteAspect | None = None,
    ask_about_card: ask_card.AskCard | None = None,
    ask_about_phrase: ask_phrase.AskPhrase | None = None,
    fix_flagged_card: fix_card.FixCard | None = None,
    sort_senses: wanikani_senses.SortSenses | None = None,
    find_lesson_words: lesson_words.FindWords | None = None,
    write_cram_themes: WriteThemes | None = None,
    suggest_cram_words: cram_words.SuggestWords | None = None,
    write_cram_phrases: cram_phrases.WritePhrases | None = None,
    write_cram_say: cram_say.WriteSay | None = None,
    write_rare_words: rare_words.WriteRareWords | None = None,
    look_up_words: word_lookup.LookUpWords | None = None,
) -> FastAPI:
    # No /docs, /redoc or /openapi.json: FastAPI serves those without the passphrase. The schema the
    # app's types are generated from comes from app.openapi() (openapi.py), which needs no route.
    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        # Pasted texts' parts a restart left without English are translated once it's started.
        engine.start_own_retry()
        yield

    app = FastAPI(
        title="franki-reader", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )

    def given_key(authorization: str | None) -> bytes:
        # Header values arrive decoded as latin-1, so turn them back into the bytes that were sent
        # before comparing with the passphrase's UTF-8 bytes; otherwise "pässword" never matches.
        return (authorization or "").removeprefix("Bearer ").strip().encode("latin-1")

    # Wrong passphrases by where they came from: past MAX_WRONG in WRONG_WINDOW seconds, that source
    # is refused, right passphrase or not, so it can't be guessed. Only by source, never for everyone,
    # so a guesser can't lock the phone out. Async, so it's only ever touched on the event loop.
    wrong: dict[str, list[float]] = {}

    def refuse_if_guessing(request: Request) -> str:
        source = client_source(request)
        now = time.monotonic()
        for key in list(wrong):
            if not (kept := [t for t in wrong[key] if now - t < WRONG_WINDOW]):
                del wrong[key]
            else:
                wrong[key] = kept
        mine = wrong.get(source, [])
        if len(mine) >= MAX_WRONG:
            minutes = max(1, math.ceil((mine[-MAX_WRONG] + WRONG_WINDOW - now) / 60))
            raise HTTPException(
                429,
                f"Too many wrong passphrases from your network. Try again in {minutes} "
                f"{'minute' if minutes == 1 else 'minutes'}.",
            )
        return source

    def count_wrong(source: str) -> None:
        wrong.setdefault(source, []).append(time.monotonic())

    async def require_passphrase(
        request: Request, authorization: Annotated[str | None, Header()] = None
    ) -> None:
        if not passphrase:
            raise HTTPException(503, "The server has no passphrase set.")
        source = refuse_if_guessing(request)
        if not hmac.compare_digest(given_key(authorization), passphrase.encode()):
            count_wrong(source)
            raise HTTPException(401, "Wrong passphrase.")

    async def require_status_key(
        request: Request, authorization: Annotated[str | None, Header()] = None
    ) -> None:
        keys = [k for k in (passphrase, status_token) if k]
        if not keys:
            raise HTTPException(503, "The server has no passphrase set.")
        source = refuse_if_guessing(request)
        given = given_key(authorization)
        # Both compared every time, so the answer's timing doesn't say which one was close.
        matches = [hmac.compare_digest(given, k.encode()) for k in keys]
        if not any(matches):
            count_wrong(source)
            raise HTTPException(401, "Wrong passphrase or status key.")

    ctx = AppContext(
        engine=engine,
        speech=speech,
        mnemonics=mnemonics,
        explain=explain,
        explain_phrase=explain_phrase,
        explain_form=explain_form,
        read_due=read_due,
        read_reviews=read_reviews,
        write_drills=write_drills,
        write_vocab=write_vocab,
        write_notes=write_notes,
        check_natural=check_natural,
        check_attempt=check_attempt,
        check_journal=check_journal,
        check_retell=check_retell,
        write_sentences=write_sentences,
        play=play,
        give_feedback=give_feedback,
        write_topic=write_topic,
        read_topic_image=read_topic_image,
        clips=clips,
        write_grammar_lesson=write_grammar_lesson,
        write_lesson=write_lesson,
        write_given_lesson=write_given_lesson,
        write_lesson_topics=write_lesson_topics,
        lessons_dir=lessons_dir,
        commons=commons,
        fetch_captions=fetch_captions,
        podcasts=podcasts,
        transcribe=transcribe,
        native_dir=native_dir,
        clip_episode=clip_episode,
        clips_dir=clips_dir,
        write_aspect=write_aspect,
        ask_about_card=ask_about_card,
        ask_about_phrase=ask_about_phrase,
        fix_flagged_card=fix_flagged_card,
        sort_senses=sort_senses,
        find_lesson_words=find_lesson_words,
        write_cram_themes=write_cram_themes,
        suggest_cram_words=suggest_cram_words,
        write_cram_phrases=write_cram_phrases,
        write_cram_say=write_cram_say,
        write_rare_words=write_rare_words,
        look_up_words=look_up_words,
        authed=[Depends(require_passphrase)],
        status_auth=[Depends(require_status_key)],
    )
    for area in AREAS:
        app.include_router(area.router(ctx))
    return app


def production_app() -> FastAPI:
    """Built on startup by `uvicorn --factory franki_reader.app:production_app`, so importing this module
    (as the tests do) opens no database and reads no secrets."""
    settings = config.load()
    if settings.short_passphrase():
        logging.getLogger(__name__).warning(
            "READER_PASSPHRASE is shorter than %d characters. Set a longer one in .env.",
            config.MIN_PASSPHRASE,
        )
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = store.connect(settings.db_path)
    store.fail_interrupted_lessons(conn)
    store.fail_interrupted_grammar_lessons(conn, grammar_lessons.FAILED)
    ask_for: Callable[..., Ask] | None = None
    mnemonics: MakeMnemonics | None = None
    explain: Explain | None = None
    explain_phrase: ExplainPhrase | None = None
    explain_form: ExplainForm | None = None
    check_natural: CheckNatural | None = None
    check_attempt: production.CheckAttempt | None = None
    check_journal: journal.CheckEntry | None = None
    check_retell: production.CheckRetell | None = None
    write_sentences: sentences.WriteSentences | None = None
    play: situations.Play | None = None
    give_feedback: situations.GiveFeedback | None = None
    write_drills: drills.WriteDrills | None = None
    write_topic: grammar_topics.WriteTopic | None = None
    write_grammar_lesson: grammar_lessons.WriteLesson | None = None
    write_point: written_points.WritePoint | None = None
    write_translation: own_text.WriteTranslation | None = None
    read_topic_image: topic_image.ReadTopic | None = None
    write_vocab: vocab_check.WriteVocab | None = None
    write_notes: note_queue.WriteNotes | None = None
    write_meanings: meanings.WriteMeanings | None = None
    write_questions: comprehension.WriteQuestions | None = None
    write_forms: forms.WriteForms | None = None
    write_lesson: WritePlan | None = None
    write_given_lesson: WriteGiven | None = None
    write_lesson_topics: WriteTopics | None = None
    write_ipa: ai_ipa.WriteIpa | None = None
    write_aspect: aspect.WriteAspect | None = None
    ask_about_card: ask_card.AskCard | None = None
    ask_about_phrase: ask_phrase.AskPhrase | None = None
    fix_flagged_card: fix_card.FixCard | None = None
    sort_senses: wanikani_senses.SortSenses | None = None
    find_lesson_words: lesson_words.FindWords | None = None
    write_cram_themes: WriteThemes | None = None
    suggest_cram_words: cram_words.SuggestWords | None = None
    write_cram_phrases: cram_phrases.WritePhrases | None = None
    write_cram_say: cram_say.WriteSay | None = None
    write_rare_words: rare_words.WriteRareWords | None = None
    look_up_words: word_lookup.LookUpWords | None = None
    if key := settings.secrets.get("ANTHROPIC_API_KEY"):
        client = anthropic.AsyncAnthropic(api_key=key)
        mnemonics = claude_mnemonics(client)
        explain = claude_explain(client)
        explain_phrase = claude_explain_phrase(client)
        explain_form = claude_explain_form(client)
        check_natural = claude_check(client)
        check_attempt = production.claude_attempt(client)
        check_journal = journal.claude_check(client)
        check_retell = production.claude_retell(client)
        write_sentences = sentences.claude_sentences(client)
        play = situations.claude_play(client)
        give_feedback = situations.claude_feedback(client)
        write_drills = drills.claude_drills(client)
        write_topic = grammar_topics.claude_topics(client)
        write_grammar_lesson = grammar_lessons.claude_lessons(client)
        write_point = written_points.claude_points(client)
        write_translation = own_text.claude_translation(client)
        read_topic_image = topic_image.claude_topic_reader(client)
        write_vocab = vocab_check.claude_vocab(client)
        write_notes = note_queue.claude_notes(client)
        look_up_words = word_lookup.claude_word_lookup(client)
        write_meanings = meanings.claude_meanings(client)
        write_questions = comprehension.claude_questions(client)
        write_forms = forms.claude_forms(client)
        write_lesson = lesson_writer.claude_plan(client)
        write_given_lesson = lesson_writer.claude_given_plan(client)
        write_lesson_topics = lesson_topics.claude_topics(client)
        write_ipa = ai_ipa.claude_ipa(client)
        write_aspect = aspect.claude_aspect(client)
        ask_about_card = ask_card.claude_ask_card(client)
        ask_about_phrase = ask_phrase.claude_ask_phrase(client)
        fix_flagged_card = fix_card.claude_fix_card(client)
        sort_senses = wanikani_senses.claude_senses(client)
        find_lesson_words = lesson_words.claude_find_words(client)
        write_cram_themes = cram_themes.claude_themes(client)
        suggest_cram_words = cram_words.claude_suggest_words(client)
        write_cram_phrases = cram_phrases.claude_phrases(client)
        write_cram_say = cram_say.claude_say(client)
        write_rare_words = rare_words.claude_rare_words(client)

        def ask_for(
            entries: list[Entry], language: Code, model: TextModel = MODEL, effort: Effort = EFFORT
        ) -> Ask:
            return claude_ask(client, entries, language, model, effort)

    synthesize = None
    synthesize_parts = None
    transcribe: podcast.Transcribe | None = None
    speech: SpeechClient | None = None
    key, region = (
        settings.secrets.get("AZURE_SPEECH_KEY"),
        settings.secrets.get("AZURE_SPEECH_REGION"),
    )
    if key and region:
        speech = SpeechClient(
            key,
            region,
            settings.speech_endpoint,
            user_agent="franki-reader",
            voice_help=(
                "Check the voice names chosen in Read & Listen's settings in the app (Thai's"
                " defaults are AZURE_VOICE_MALE and AZURE_VOICE_FEMALE in server/.env)."
            ),
        )
        synthesize = azure_synthesize(speech)
        synthesize_parts = azure_synthesize_parts(speech)
        transcribe = azure_transcribe(speech)

    # Without the sync server's address and sign-in the lexicon is never refreshed, and the server
    # says it has no word list.
    secrets = settings.secrets
    endpoint, user, password = (
        secrets.get("ANKI_SYNC_ENDPOINT"),
        secrets.get("ANKI_USER"),
        secrets.get("ANKI_PASSWORD"),
    )
    anki = (
        AnkiDeck(settings.anki_dir, SyncSettings(endpoint, user, password))
        if endpoint and user and password
        else None
    )
    read_deck = with_timeout(anki.read) if anki else None
    wanikani_token = secrets.get("WANIKANI_TOKEN")
    engine = Engine(
        conn,
        ask_for,
        read_deck=read_deck,
        synthesize=synthesize,
        synthesize_parts=synthesize_parts,
        audio=AudioCache(settings.audio_dir),
        voices=settings.voices,
        rollover=lambda: anki.rollover if anki else DEFAULT_ROLLOVER,
        write_meanings=write_meanings,
        write_questions=write_questions,
        write_forms=write_forms,
        write_ipa=write_ipa,
        read_wanikani=wanikani_reader(wanikani_token) if wanikani_token else None,
        write_point=write_point,
        write_translation=write_translation,
    )
    engine.count_existing_audio()
    return create_app(
        engine,
        settings.secrets.get("APP_PASSPHRASE"),
        speech,
        mnemonics,
        explain,
        explain_phrase,
        explain_form,
        status_token=settings.secrets.get("STATUS_TOKEN"),
        read_due=due_with_timeout(anki.due) if anki else None,
        read_reviews=reviews_with_timeout(anki.reviews) if anki else None,
        write_drills=write_drills,
        write_vocab=write_vocab,
        write_notes=write_notes,
        check_natural=check_natural,
        check_attempt=check_attempt,
        check_journal=check_journal,
        check_retell=check_retell,
        write_sentences=write_sentences,
        play=play,
        give_feedback=give_feedback,
        write_topic=write_topic,
        read_topic_image=read_topic_image,
        # Beside the texts' audio: a text's folder is its id, so "situations" can't be one.
        clips=ClipCache(settings.audio_dir / "situations"),
        write_grammar_lesson=write_grammar_lesson,
        write_lesson=write_lesson,
        write_given_lesson=write_given_lesson,
        write_lesson_topics=write_lesson_topics,
        lessons_dir=settings.audio_dir / "lessons",
        # Native recordings ask Lingua Libre and Commons directly: no key, and the app's own
        # setting (off until turned on) decides whether anything is asked.
        commons=Commons(user_agent="franki-reader-native/1.0"),
        # Videos ask YouTube for a video's subtitles only when the learner adds one, and the app's
        # own setting (off until turned on) decides whether anything is asked (video.py).
        fetch_captions=video.youtube_captions(httpx.AsyncClient(), "franki-reader-videos/1.0"),
        # Podcasts ask Apple's directory and a show's feed only when the learner searches or opens a
        # show, and the app's own setting (off until turned on) decides whether anything is asked.
        podcasts=podcast.Podcasts(httpx.AsyncClient(), "franki-reader-podcasts/1.0"),
        # Transcribing an episode with no transcript goes to Azure, only when the learner taps
        # Transcribe and agrees to its price (podcast.py).
        transcribe=transcribe,
        native_dir=settings.audio_dir / "native",
        # A podcast line's clip is cut from the episode on the show's own site, only when the
        # learner adds a word from it or shadows it (routes/clips.py).
        clip_episode=podcast.episode_clipper(httpx.AsyncClient(), "franki-reader-podcasts/1.0"),
        clips_dir=settings.audio_dir / "clips",
        write_aspect=write_aspect,
        ask_about_card=ask_about_card,
        ask_about_phrase=ask_about_phrase,
        fix_flagged_card=fix_flagged_card,
        sort_senses=sort_senses,
        find_lesson_words=find_lesson_words,
        write_cram_themes=write_cram_themes,
        suggest_cram_words=suggest_cram_words,
        write_cram_phrases=write_cram_phrases,
        write_cram_say=write_cram_say,
        write_rare_words=write_rare_words,
        look_up_words=look_up_words,
    )
