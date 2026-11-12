"""The HTTP API the iOS app calls. Every /api route needs the passphrase as a bearer token
(docs/read-and-listen/architecture.md, Hosting); /health doesn't, so it shows whether the server is up. Caddy
serves all of it under /reader (../../Caddyfile), so the app's address ends in /reader.

    GET   /api/check                  204 if the passphrase is right
    GET   /api/topics                 topics with their state and ready count; tops up in the background
    POST  /api/topics                 {name, favorite?} adds a topic (or returns the existing one)
    PATCH /api/topics/{id}            {favorite}
    DELETE /api/topics/{id}           removes a topic from the list (adding it again brings it back)
    GET   /api/suggestions            topic ideas not yet added, the best fit for the deck first
    POST  /api/topics/{id}/next       the next text for a topic; 202 {"writing": true} while one is
                                      being written in the background, so ask again shortly. With
                                      {words: [...]}, a text written to practice those words
    GET   /api/settings               {stretch_words: "topic" | "any", lines: 6 | 8 | 12,
                                      form: "dialogue" | "story", language: "th" | "es" | ...,
                                      decks: {th: <deck>, es: <deck>, ...},
                                      common: {es: 10000, de: 3000, ...}} (every language but
                                      Thai: how many of its most common words count as known)

Topics are shared by every language. Everything else (ready texts, /next, progress, past texts,
marked words, ideas) is in the current language, the `language` setting.
    PATCH /api/settings               the same fields; takes effect from the next text written. A
                                      changed deck is read again at once
    GET   /api/texts                  texts read to the end, newest first, to read again
    GET   /api/texts/{id}             one text, in the same shape as /next; reading it again isn't logged
    POST  /api/texts/{id}/reading     logs a session with a text and adjusts difficulty
    GET   /api/progress               finished texts, coverage and ratings over the last 14 days,
                                      and the difficulty the next text is written at
    GET   /api/grammar                the current language's grammar points, each practice, avoid
                                      or normal
    PUT   /api/grammar/{id}           {state}; at most 2 practiced at once; from the next text
    GET   /api/words                  words marked unknown and not cleared, newest first
    POST  /api/words/clear            {word} takes a word off that list until it's marked again
    GET   /api/texts/{id}/lines/{n}/audio   one line's MP3, made now if it isn't cached yet
"""

import hmac
from collections.abc import Callable
from datetime import timedelta
from typing import Annotated, Any, Literal

import anthropic
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Response
from fastapi.responses import FileResponse, JSONResponse
from franki_speech import SpeechClient
from pydantic import BaseModel, Field

from franki_reader import config, grammar, store
from franki_reader.collection import AnkiDeck, SyncSettings
from franki_reader.engine import Engine, NotAvailable, NotFound
from franki_reader.gateway import with_timeout
from franki_reader.generator import Ask, Form, claude_ask
from franki_reader.languages import LANGUAGES, Code, CommonCount, with_deck
from franki_reader.lexicon import Entry
from franki_reader.reader import gloss_for, render
from franki_reader.store import Length, Reading, Settings, StoredText, StretchWords, Topic
from franki_reader.suggestions import suggest
from franki_reader.tts import AudioCache, azure_synthesize

# The window the progress summary covers: the Milestone 1 exit check's two weeks.
PROGRESS_DAYS = 14
# How many past texts the list shows.
PAST_TEXTS = 50


class NewTopic(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    favorite: bool = True


class TopicUpdate(BaseModel):
    favorite: bool


class GrammarChoice(BaseModel):
    state: Literal["practice", "avoid", "normal"]


class ClearWord(BaseModel):
    word: str = Field(min_length=1, max_length=100)


class SettingsUpdate(BaseModel):
    stretch_words: StretchWords | None = None
    lines: Length | None = None
    form: Form | None = None
    language: Code | None = None
    # A language's deck by its full Anki name; an empty name goes back to the default.
    decks: dict[Code, Annotated[str, Field(max_length=500)]] | None = None
    # How many of a language's most common words count as known. Not Thai's: only its deck counts.
    common: dict[Code, CommonCount] | None = None


class NextIn(BaseModel):
    # The cards just studied, to write a text that practices them (the app's "Read a text with
    # these words"). Each is a note's Entry, as the deck has it.
    words: list[Annotated[str, Field(max_length=200)]] = Field(default_factory=list, max_length=500)


class ReadingIn(BaseModel):
    rating: Literal["too_easy", "about_right", "too_hard"] | None = None
    finished: bool = False
    words_glossed: list[str] = []
    words_flagged: list[str] = []
    audio_speed: float | None = Field(default=None, ge=0.5, le=1.5)
    listen_only: bool = False
    seconds: int = Field(default=0, ge=0)


def create_app(engine: Engine, passphrase: str | None) -> FastAPI:
    app = FastAPI(title="franki-reader")

    def require_passphrase(authorization: Annotated[str | None, Header()] = None) -> None:
        if not passphrase:
            raise HTTPException(503, "The server has no passphrase set.")
        given = (authorization or "").removeprefix("Bearer ").strip()
        # Header values arrive decoded as latin-1, so turn them back into the bytes that were sent
        # before comparing with the passphrase's UTF-8 bytes; otherwise "pässword" never matches.
        if not hmac.compare_digest(given.encode("latin-1"), passphrase.encode()):
            raise HTTPException(401, "Wrong passphrase.")

    authed = [Depends(require_passphrase)]

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/check", status_code=204, dependencies=authed)
    async def check() -> Response:
        return Response(status_code=204)

    @app.get("/api/topics", dependencies=authed)
    async def topics(background: BackgroundTasks) -> list[dict[str, Any]]:
        background.add_task(engine.top_up)
        language = engine.language()
        return [_topic(t, engine, language) for t in store.list_topics(engine.conn, language)]

    @app.post("/api/topics", dependencies=authed)
    async def add_topic(body: NewTopic, background: BackgroundTasks) -> dict[str, Any]:
        try:
            topic = store.add_topic(engine.conn, body.name, body.favorite, engine.clock())
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        background.add_task(engine.top_up)
        return _topic(topic, engine, engine.language())

    @app.patch("/api/topics/{topic_id}", dependencies=authed)
    async def update_topic(topic_id: int, body: TopicUpdate) -> dict[str, Any]:
        topic = store.set_favorite(engine.conn, topic_id, body.favorite)
        if topic is None:
            raise HTTPException(404, "No such topic.")
        return _topic(topic, engine, engine.language())

    @app.delete("/api/topics/{topic_id}", status_code=204, dependencies=authed)
    async def remove_topic(topic_id: int) -> Response:
        if not store.remove_topic(engine.conn, topic_id):
            raise HTTPException(404, "No such topic.")
        return Response(status_code=204)

    @app.get("/api/suggestions", dependencies=authed)
    async def suggestions() -> list[dict[str, Any]]:
        language = engine.language()
        _, lexicon = engine.snapshot(language)
        taken = store.topic_names(engine.conn)
        return [{"name": s.name, "fit": s.fit} for s in suggest(lexicon, taken, language)]

    @app.post("/api/topics/{topic_id}/next", dependencies=authed)
    async def next_text(
        topic_id: int, background: BackgroundTasks, body: NextIn | None = None
    ) -> Any:
        try:
            text = await engine.next_text(topic_id, body.words if body else ())
        except NotFound as e:
            raise HTTPException(404, "No such topic.") from e
        except NotAvailable as e:
            raise HTTPException(503, str(e)) from e
        if text is None:
            return JSONResponse({"writing": True}, status_code=202)
        background.add_task(engine.top_up)
        return _rendered(text, engine)

    @app.get("/api/texts", dependencies=authed)
    async def past_texts() -> list[dict[str, Any]]:
        return [
            {
                "id": t.id,
                "topic": t.topic,
                "title": t.title,
                "rating": t.rating,
                "read_at": t.read_at.isoformat(),
                "coverage": t.coverage,
                "form": t.form,
            }
            for t in store.past_texts(engine.conn, PAST_TEXTS, engine.language())
        ]

    @app.get("/api/texts/{text_id}", dependencies=authed)
    async def get_text(text_id: int) -> dict[str, Any]:
        text = store.get_text(engine.conn, text_id)
        if text is None or store.text_status(engine.conn, text_id) == "dropped":
            raise HTTPException(404, "No such text.")
        return _rendered(text, engine)

    @app.get("/api/texts/{text_id}/lines/{line}/audio", dependencies=authed)
    async def line_audio(text_id: int, line: int) -> FileResponse:
        text = store.get_text(engine.conn, text_id)
        if text is None:
            raise HTTPException(404, "No such text.")
        path = await engine.line_audio(text, line)
        if path is None:
            raise HTTPException(404, "No audio for this line.")
        return FileResponse(path, media_type="audio/mpeg")

    def settings_out(current: Settings) -> dict[str, Any]:
        # Every language's deck, the default where none was chosen, so the app shows what's used.
        decks = {code: with_deck(code, current.decks.get(code)).deck for code in LANGUAGES}
        common = {code: current.common_for(code) for code, info in LANGUAGES.items() if info.spaced}
        return {**current.__dict__, "decks": decks, "common": common}

    @app.get("/api/settings", dependencies=authed)
    async def settings() -> dict[str, Any]:
        return settings_out(store.load_settings(engine.conn))

    @app.patch("/api/settings", dependencies=authed)
    async def update_settings(body: SettingsUpdate, background: BackgroundTasks) -> dict[str, Any]:
        current = store.load_settings(engine.conn)
        if body.common and any(not LANGUAGES[code].spaced for code in body.common):
            raise HTTPException(422, "Thai counts only the words in its deck.")
        common = dict(current.common)
        for code, count in (body.common or {}).items():
            if count == LANGUAGES[code].common:
                common.pop(code, None)
            else:
                common[code] = count
        decks = dict(current.decks)
        changed_decks: list[Code] = []
        for code, name in (body.decks or {}).items():
            name = name.strip()
            before = with_deck(code, decks.get(code)).deck
            if name and name != LANGUAGES[code].deck:
                decks[code] = name
            else:
                decks.pop(code, None)
            if with_deck(code, decks.get(code)).deck != before:
                changed_decks.append(code)
        updated = Settings(
            stretch_words=body.stretch_words or current.stretch_words,
            lines=body.lines or current.lines,
            form=body.form or current.form,
            language=body.language or current.language,
            decks=decks,
            common=common,
        )
        store.save_settings(engine.conn, updated)
        for code in changed_decks:
            # The old deck's words mustn't be written with: read the new deck now.
            store.clear_snapshot(engine.conn, code)
            background.add_task(engine.refresh_lexicon, code)
        return settings_out(updated)

    @app.post("/api/texts/{text_id}/reading", status_code=204, dependencies=authed)
    async def reading(text_id: int, body: ReadingIn, background: BackgroundTasks) -> Response:
        try:
            engine.record_reading(
                text_id,
                Reading(
                    rating=body.rating,
                    finished=body.finished,
                    words_glossed=tuple(body.words_glossed),
                    words_flagged=tuple(body.words_flagged),
                    audio_speed=body.audio_speed,
                    listen_only=body.listen_only,
                    seconds=body.seconds,
                ),
            )
        except NotFound as e:
            raise HTTPException(404, "No such text.") from e
        background.add_task(engine.top_up)
        return Response(status_code=204)

    @app.get("/api/progress", dependencies=authed)
    async def progress() -> dict[str, Any]:
        language = engine.language()
        since = engine.clock() - timedelta(days=PROGRESS_DAYS)
        done = store.progress(engine.conn, since, language)
        difficulty = store.load_difficulty(engine.conn, language)
        return {
            "days": PROGRESS_DAYS,
            "finished": done.finished,
            "median_coverage": done.median_coverage,
            "ratings": done.ratings,
            "next": {"floor": difficulty.floor, "stretch": difficulty.stretch},
        }

    @app.get("/api/words", dependencies=authed)
    async def words() -> list[dict[str, Any]]:
        language = engine.language()
        entries, lexicon = engine.snapshot(language)
        meanings = {e.text: e.meaning for e in entries}
        return [
            {
                "word": w.word,
                "gloss": gloss_for(w.word, w.glosses, lexicon, meanings),
                "status": lexicon.status(w.word),
                "deck": lexicon.entry_of(w.word) is not None,
                "times": w.times,
                "last_marked": w.last_marked.isoformat(),
            }
            for w in store.marked_words(engine.conn, language)
        ]

    def grammar_points() -> dict[str, Any]:
        choices = store.load_grammar(engine.conn)
        return {
            "max_practice": grammar.MAX_PRACTICE,
            "points": [
                {"id": p.id, "name": p.name, "note": p.note, "state": choices.get(p.id, "normal")}
                for p in grammar.points_for(engine.language())
            ],
        }

    @app.get("/api/grammar", dependencies=authed)
    async def get_grammar() -> dict[str, Any]:
        return grammar_points()

    @app.put("/api/grammar/{point_id}", dependencies=authed)
    async def choose_grammar(point_id: str, body: GrammarChoice) -> dict[str, Any]:
        point = grammar.POINTS.get(point_id)
        if point is None:
            raise HTTPException(404, "No such grammar point.")
        choices = store.load_grammar(engine.conn)
        practiced = [
            pid
            for pid, state in choices.items()
            if state == "practice"
            and pid != point_id
            and pid in grammar.POINTS
            and grammar.POINTS[pid].language == point.language
        ]
        if body.state == "practice" and len(practiced) >= grammar.MAX_PRACTICE:
            raise HTTPException(
                422,
                f"Practice at most {grammar.MAX_PRACTICE} at a time. Set one back to Normal first.",
            )
        store.set_grammar(engine.conn, point_id, body.state)
        return grammar_points()

    @app.post("/api/words/clear", status_code=204, dependencies=authed)
    async def clear_word(body: ClearWord) -> Response:
        store.clear_word(engine.conn, body.word, engine.clock())
        return Response(status_code=204)

    return app


def _rendered(text: StoredText, engine: Engine) -> dict[str, Any]:
    entries, lexicon = engine.snapshot(text.language)
    out = render(text, lexicon, {e.text: e.meaning for e in entries})
    speaks = engine.audio is not None and engine.synthesize is not None
    for i, line in enumerate(out["lines"]):
        line["audio"] = speaks or engine.has_audio(text.id, i)
    return out


def _topic(t: Topic, engine: Engine, language: Code) -> dict[str, Any]:
    # A topic's ready count is per language, so it's read again for the one being shown.
    t = store.get_topic(engine.conn, t.id, language) or t
    return {
        "id": t.id,
        "name": t.name,
        "favorite": t.favorite,
        "ready": t.ready,
        "state": engine.topic_state(t, language),
    }


def production_app() -> FastAPI:
    """Built on startup by `uvicorn --factory franki_reader.app:production_app`, so importing this module
    (as the tests do) opens no database and reads no secrets."""
    settings = config.load()
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = store.connect(settings.db_path)
    ask_for: Callable[[list[Entry], Code], Ask] | None = None
    if key := settings.secrets.get("ANTHROPIC_API_KEY"):
        client = anthropic.AsyncAnthropic(api_key=key)

        def ask_for(entries: list[Entry], language: Code) -> Ask:
            return claude_ask(client, entries, language)

    synthesize = None
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
                "Check the voice names: Thai's are AZURE_VOICE_A and AZURE_VOICE_B in server/.env,"
                " the other languages' are in server/reader/src/franki_reader/languages.py."
            ),
        )
        synthesize = azure_synthesize(speech)

    # Without the sync server's address and sign-in the lexicon is never refreshed, and the server
    # says it has no word list.
    secrets = settings.secrets
    endpoint, user, password = (
        secrets.get("ANKI_SYNC_ENDPOINT"),
        secrets.get("ANKI_USER"),
        secrets.get("ANKI_PASSWORD"),
    )
    read_deck = (
        with_timeout(AnkiDeck(settings.anki_dir, SyncSettings(endpoint, user, password)).read)
        if endpoint and user and password
        else None
    )
    engine = Engine(
        conn,
        ask_for,
        read_deck=read_deck,
        synthesize=synthesize,
        audio=AudioCache(settings.audio_dir),
        voices=settings.voices,
    )
    return create_app(engine, settings.secrets.get("APP_PASSPHRASE"))
