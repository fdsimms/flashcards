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
                                      study_days: [{starts_at, cards, answer_seconds,
                                      reading_seconds}] (the last 7 study days, today last),
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
                                      with why it's there), the ongoing story and its next episode,
                                      what's being written, and each language's
                                      count of texts waiting; tops up in the background
    POST  /api/shelf/write            {name, form} writes a text on a topic typed in; it joins the
                                      shelf when it's ready (202)
    POST  /api/story                  {about?} starts a new story in the current language, retiring
                                      the one before it, and writes its first episode (202)
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
    GET   /api/progress               finished texts, coverage and ratings over the last 14 days,
                                      the check after reading's answers over them, how well the
                                      known words were recognized (recognition.py), and the
                                      difficulty the next text is written at
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
                                      Claude to fill in; 503 without a Claude key
    POST  /api/note-queue/{id}/retry  a failed word waiting to be filled again
    DELETE /api/note-queue/{id}       takes a word off the queue (after the app saves it, or on remove)
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
                                      created_at, phrases, dialogue}]}, newest first
    GET   /api/lessons/{id}/audio     the lesson's MP3, once it's ready
    DELETE /api/lessons/{id}          forgets the lesson and its audio
    POST  /api/mnemonics              {language, entry, meaning, transliteration?, context?} three
                                      memory hints for a word the owner keeps forgetting: {hints: [...]}
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
from collections.abc import Callable
from pathlib import Path
from typing import Annotated

import anthropic
from fastapi import Depends, FastAPI, Header, HTTPException
from franki_speech import SpeechClient

from franki_reader import (
    ai_ipa,
    aspect,
    comprehension,
    config,
    drills,
    forms,
    grammar_topics,
    lesson_writer,
    meanings,
    note_queue,
    production,
    sentences,
    situations,
    store,
    vocab_check,
)
from franki_reader.collection import AnkiDeck, SyncSettings
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
from franki_reader.lesson_writer import WritePlan
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
)
from franki_reader.wanikani import wanikani_reader


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
    check_retell: production.CheckRetell | None = None,
    write_sentences: sentences.WriteSentences | None = None,
    play: situations.Play | None = None,
    give_feedback: situations.GiveFeedback | None = None,
    write_topic: grammar_topics.WriteTopic | None = None,
    clips: ClipCache | None = None,
    write_lesson: WritePlan | None = None,
    lessons_dir: Path | None = None,
    write_aspect: aspect.WriteAspect | None = None,
) -> FastAPI:
    app = FastAPI(title="franki-reader")

    def given_key(authorization: str | None) -> bytes:
        # Header values arrive decoded as latin-1, so turn them back into the bytes that were sent
        # before comparing with the passphrase's UTF-8 bytes; otherwise "pässword" never matches.
        return (authorization or "").removeprefix("Bearer ").strip().encode("latin-1")

    def require_passphrase(authorization: Annotated[str | None, Header()] = None) -> None:
        if not passphrase:
            raise HTTPException(503, "The server has no passphrase set.")
        if not hmac.compare_digest(given_key(authorization), passphrase.encode()):
            raise HTTPException(401, "Wrong passphrase.")

    def require_status_key(authorization: Annotated[str | None, Header()] = None) -> None:
        keys = [k for k in (passphrase, status_token) if k]
        if not keys:
            raise HTTPException(503, "The server has no passphrase set.")
        given = given_key(authorization)
        # Both compared every time, so the answer's timing doesn't say which one was close.
        matches = [hmac.compare_digest(given, k.encode()) for k in keys]
        if not any(matches):
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
        check_retell=check_retell,
        write_sentences=write_sentences,
        play=play,
        give_feedback=give_feedback,
        write_topic=write_topic,
        clips=clips,
        write_lesson=write_lesson,
        lessons_dir=lessons_dir,
        write_aspect=write_aspect,
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
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = store.connect(settings.db_path)
    store.fail_interrupted_lessons(conn)
    ask_for: Callable[..., Ask] | None = None
    mnemonics: MakeMnemonics | None = None
    explain: Explain | None = None
    explain_phrase: ExplainPhrase | None = None
    explain_form: ExplainForm | None = None
    check_natural: CheckNatural | None = None
    check_attempt: production.CheckAttempt | None = None
    check_retell: production.CheckRetell | None = None
    write_sentences: sentences.WriteSentences | None = None
    play: situations.Play | None = None
    give_feedback: situations.GiveFeedback | None = None
    write_drills: drills.WriteDrills | None = None
    write_topic: grammar_topics.WriteTopic | None = None
    write_vocab: vocab_check.WriteVocab | None = None
    write_notes: note_queue.WriteNotes | None = None
    write_meanings: meanings.WriteMeanings | None = None
    write_questions: comprehension.WriteQuestions | None = None
    write_forms: forms.WriteForms | None = None
    write_lesson: WritePlan | None = None
    write_ipa: ai_ipa.WriteIpa | None = None
    write_aspect: aspect.WriteAspect | None = None
    if key := settings.secrets.get("ANTHROPIC_API_KEY"):
        client = anthropic.AsyncAnthropic(api_key=key)
        mnemonics = claude_mnemonics(client)
        explain = claude_explain(client)
        explain_phrase = claude_explain_phrase(client)
        explain_form = claude_explain_form(client)
        check_natural = claude_check(client)
        check_attempt = production.claude_attempt(client)
        check_retell = production.claude_retell(client)
        write_sentences = sentences.claude_sentences(client)
        play = situations.claude_play(client)
        give_feedback = situations.claude_feedback(client)
        write_drills = drills.claude_drills(client)
        write_topic = grammar_topics.claude_topics(client)
        write_vocab = vocab_check.claude_vocab(client)
        write_notes = note_queue.claude_notes(client)
        write_meanings = meanings.claude_meanings(client)
        write_questions = comprehension.claude_questions(client)
        write_forms = forms.claude_forms(client)
        write_lesson = lesson_writer.claude_plan(client)
        write_ipa = ai_ipa.claude_ipa(client)
        write_aspect = aspect.claude_aspect(client)

        def ask_for(
            entries: list[Entry], language: Code, model: TextModel = MODEL, effort: Effort = EFFORT
        ) -> Ask:
            return claude_ask(client, entries, language, model, effort)

    synthesize = None
    synthesize_parts = None
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
        check_retell=check_retell,
        write_sentences=write_sentences,
        play=play,
        give_feedback=give_feedback,
        write_topic=write_topic,
        # Beside the texts' audio: a text's folder is its id, so "situations" can't be one.
        clips=ClipCache(settings.audio_dir / "situations"),
        write_lesson=write_lesson,
        lessons_dir=settings.audio_dir / "lessons",
        write_aspect=write_aspect,
    )
