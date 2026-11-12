"""The HTTP API the iOS app calls. Every /api route needs the passphrase as a bearer token
(docs/read-and-listen/architecture.md, Hosting); /health doesn't, so it shows whether the server is up. Caddy
serves all of it under /reader (../../Caddyfile), so the app's address ends in /reader.

    GET   /api/check                  204 if the passphrase is right
    GET   /api/status                 what's due in Anki now and whether a Read & Listen text is
                                      waiting, for another app (dundundun). Opens with the
                                      passphrase or STATUS_TOKEN, a key for this route alone:
                                      {reviews, learning, learning_later: [{at, count}],
                                      decks: [{name, reviews, learning}], day_ends_at,
                                      read_and_listen: {language, name, waiting, last_read_at}}
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
    GET   /api/shelf                  the current language's shelf: the texts written ahead (each
                                      with why it's there), the ongoing story and its next episode,
                                      what's being written, the liked themes, and each language's
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
    POST  /api/texts/{id}/reading     logs a session with a text and adjusts difficulty
    GET   /api/progress               finished texts, coverage and ratings over the last 14 days,
                                      and the difficulty the next text is written at
    GET   /api/costs?days=30          what Claude cost over the last `days` days, per language:
                                      texts read, waiting, dropped and skipped, attempts and dollars (every
                                      language, not just the current one; the MCP's
                                      read_and_listen_costs reads it), and `explanations`: what
                                      Explain's calls, lines and phrases, cost over the same days
    GET   /api/grammar                the current language's grammar points, each practice, avoid,
                                      normal ("Know it") or unset, with how often each came up in
                                      texts read; `least`, the known ones worked in next
    GET   /api/grammar/choices        {choices}: every language's choices by point id (practice,
                                      avoid or normal; a point not set isn't listed), for the
                                      app's Forms practice (docs/grammar.md)
    POST  /api/drills                 {points, count?} a grammar drill's questions (drills.py), each
                                      {kind: "which", point, line, words, english, title, choices}
                                      or {kind: "gap", id, point, before, answer, after, english,
                                      wrong, hint}; `missing` names points that got none. Writes
                                      more gap questions in the background when Claude is set up
    GET   /api/grammar/{id}           one point's page: {id, state, seen, choices (its language's,
                                      for the related points), examples: [{text_id, title, line,
                                      english, words}]}, lines from texts read, the latest first
    PUT   /api/grammar/{id}           {state}; at most 2 practiced at once; from the next text
    GET   /api/words                  words marked unknown and not cleared, newest first
    POST  /api/words/clear            {word} takes a word off that list until it's marked again
    GET   /api/texts/{id}/lines/{n}/audio   one line's MP3, made now if it isn't cached yet
    GET   /api/voices?language=th     Azure's voices in a language (any code: th, pl, es-MX), for
                                      the speakers here and for recording cards in the app
    POST  /api/speech                 {text, voice, rate?} the text spoken by an Azure voice, as MP3:
                                      the app records a card's audio with it and keeps the file, so
                                      each recording is asked for once
    POST  /api/texts/{id}/lines/{n}/explain   {simple?} the line's grammar and vocabulary explained in
                                      English by Claude: {points: [{phrase, note}]}. Asked on the
                                      owner's tap and kept per line (and per simple version).
                                      With `grammar`: the points the finders find in the line,
                                      each {id, name, note, state}, as the choices stand now
    POST  /api/texts/{id}/lines/{n}/phrase    {phrase, simple?} a phrase the owner selected in the
                                      line, as it appears there, explained by Claude:
                                      {meaning, points: [{phrase, note}]}. Kept per phrase, like
                                      the line's
    POST  /api/mnemonics              {language, entry, meaning, transliteration?, context?} three
                                      memory hints for a word the owner keeps forgetting: {hints: [...]}
"""

import hmac
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

import anthropic
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Query, Response
from fastapi.responses import FileResponse, JSONResponse
from franki_speech import SpeechClient, SpeechError, locale_of
from pydantic import BaseModel, Field

from franki_reader import config, drills, exposure, grammar, store
from franki_reader.collection import AnkiDeck, SyncSettings
from franki_reader.coverage import parse_line
from franki_reader.engine import Engine, NotAvailable, NotFound
from franki_reader.explain import (
    Explain,
    ExplainFailed,
    ExplainPhrase,
    ExplainRequest,
    PhraseRequest,
    claude_explain,
    claude_explain_phrase,
)
from franki_reader.gateway import AnkiUnavailable, ReadDue, due_with_timeout, with_timeout
from franki_reader.generator import Ask, Form, claude_ask
from franki_reader.languages import LANGUAGES, Code, CommonCount, VoiceSlot, with_deck
from franki_reader.lexicon import Entry
from franki_reader.mnemonics import (
    MakeMnemonics,
    MnemonicRequest,
    MnemonicsFailed,
    claude_mnemonics,
)
from franki_reader.reader import gloss_for, render
from franki_reader.store import Length, Reading, Settings, StoredText, StretchWords, Topic
from franki_reader.suggestions import suggest
from franki_reader.tts import AudioCache, Speech, azure_synthesize

# The window the progress summary covers: the Milestone 1 exit check's two weeks.
PROGRESS_DAYS = 14
# How many past texts the list shows.
PAST_TEXTS = 50
# The longest text /api/speech speaks: a card's word or sentence, never a whole text.
MAX_SPEECH_CHARS = 500


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
    # An Azure voice for each of a language's voice slots; an empty name goes back to the default.
    voices: dict[Code, dict[VoiceSlot, Annotated[str, Field(max_length=100)]]] | None = None


class SpeechIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_SPEECH_CHARS)
    voice: str = Field(min_length=1, max_length=100)
    rate: float = Field(default=1.0, ge=0.5, le=2.0)


class MnemonicIn(BaseModel):
    language: Code
    entry: str = Field(min_length=1, max_length=200)
    meaning: str = Field(min_length=1, max_length=300)
    transliteration: str = Field(default="", max_length=200)
    context: str = Field(default="", max_length=500)


class DrillsIn(BaseModel):
    points: list[str]
    count: int = Field(default=10, ge=1, le=drills.MAX_DRILL)


class ExplainIn(BaseModel):
    # A second, plainer explanation of a line already explained.
    simple: bool = False


class PhraseIn(BaseModel):
    # As it appears in the line: the words the owner selected and what's between them.
    phrase: str = Field(min_length=1, max_length=300)
    simple: bool = False


class WriteIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    form: Form = "dialogue"


class StoryIn(BaseModel):
    # What the story is about; empty lets the model choose.
    about: str = Field(default="", max_length=200)


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


def _check_voice(name: str, code: Code) -> None:
    """Refuses a voice that isn't Azure's shape or doesn't speak the language it's chosen for."""
    try:
        locale = locale_of(name)
    except SpeechError as e:
        raise HTTPException(400, str(e)) from e
    if locale.split("-")[0].lower() != code:
        raise HTTPException(
            400,
            f"{name} speaks {locale}, not {LANGUAGES[code].name}. Choose a {LANGUAGES[code].name} voice.",
        )


async def _check_voice_gender(speech: Speech | None, name: str, slot: VoiceSlot) -> None:
    """Refuses a voice of the other gender than its slot's, where Azure's list says what it is."""
    if speech is None:
        return
    want = "male" if slot.startswith("male") else "female"
    try:
        found = await speech.voices()
    except SpeechError:
        return  # can't tell, and the voice's language was already checked
    for v in found:
        if v.get("voice") == name:
            have = str(v.get("gender") or "").lower()
            if have in ("male", "female") and have != want:
                raise HTTPException(
                    400,
                    f"{v.get('name') or name} is a {have} voice. Choose a {want} voice for this one.",
                )
            return


def _spent(s: store.Spending) -> dict[str, Any]:
    """/api/costs's figures for one language or the total. Per read text divides everything spent
    (dropped and unread texts too) by the texts actually read: what each one really cost."""
    return {
        "texts": s.texts,
        "read": s.read,
        "waiting": s.waiting,
        "dropped": s.dropped,
        "skipped": s.skipped,
        "attempts_per_text": round(s.attempts / s.texts, 2) if s.texts else None,
        "cost_usd": round(s.cost_usd, 4),
        "per_text_usd": round(s.cost_usd / s.texts, 4) if s.texts else None,
        "per_read_text_usd": round(s.cost_usd / s.read, 4) if s.read else None,
    }


def create_app(
    engine: Engine,
    passphrase: str | None,
    speech: Speech | None = None,
    mnemonics: MakeMnemonics | None = None,
    explain: Explain | None = None,
    explain_phrase: ExplainPhrase | None = None,
    status_token: str | None = None,
    read_due: ReadDue | None = None,
    write_drills: drills.WriteDrills | None = None,
) -> FastAPI:
    app = FastAPI(title="franki-reader")
    # Points whose drill questions are being written, shared by every request (drills.top_up).
    drills_writing: set[str] = set()

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

    authed = [Depends(require_passphrase)]

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/check", status_code=204, dependencies=authed)
    async def check() -> Response:
        return Response(status_code=204)

    @app.get("/api/status", dependencies=[Depends(require_status_key)])
    async def status() -> dict[str, Any]:
        if read_due is None:
            raise HTTPException(
                503,
                "The server can't read Anki: ANKI_SYNC_ENDPOINT, ANKI_USER and ANKI_PASSWORD "
                "aren't all set.",
            )
        try:
            due = await read_due()
        except AnkiUnavailable as e:
            raise HTTPException(503, f"Couldn't read Anki. {e}") from e
        language = engine.language()
        last_read = store.last_finished_reading(engine.conn, language)
        return {
            "reviews": due.reviews,
            "learning": due.learning,
            "learning_later": [{"at": instant(x.at), "count": x.count} for x in due.learning_later],
            "decks": [
                {"name": d.name, "reviews": d.reviews, "learning": d.learning} for d in due.decks
            ],
            "day_ends_at": instant(due.day_ends_at),
            "read_and_listen": {
                "language": language,
                "name": LANGUAGES[language].name,
                "waiting": store.ready_counts(engine.conn).get(language, 0),
                "last_read_at": instant(last_read) if last_read else None,
            },
        }

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

    @app.get("/api/shelf", dependencies=authed)
    async def shelf(background: BackgroundTasks) -> dict[str, Any]:
        background.add_task(engine.top_up)
        return _shelf(engine)

    @app.post("/api/shelf/write", status_code=202, dependencies=authed)
    async def write(body: WriteIn) -> dict[str, Any]:
        try:
            topic = engine.write_about(body.name, body.form)
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        except NotAvailable as e:
            raise HTTPException(503, str(e)) from e
        return {"writing": True, "topic": topic.name}

    @app.post("/api/story", status_code=202, dependencies=authed)
    async def start_story(body: StoryIn) -> dict[str, Any]:
        try:
            story = engine.start_story(body.about)
        except NotAvailable as e:
            raise HTTPException(503, str(e)) from e
        return {"writing": True, "id": story.id}

    @app.post("/api/texts/{text_id}/skip", status_code=204, dependencies=authed)
    async def skip(text_id: int, background: BackgroundTasks) -> Response:
        if not store.skip_text(engine.conn, text_id):
            raise HTTPException(404, "That text isn't on the shelf any more.")
        background.add_task(engine.top_up)
        return Response(status_code=204)

    @app.get("/api/texts", dependencies=authed)
    async def past_texts(story: int | None = None) -> list[dict[str, Any]]:
        return [
            {
                "id": t.id,
                "topic": t.topic,
                "title": t.title,
                "rating": t.rating,
                "read_at": instant(t.read_at),
                "coverage": t.coverage,
                "form": t.form,
                "episode": t.episode,
            }
            for t in store.past_texts(engine.conn, PAST_TEXTS, engine.language(), story)
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

    def line_grammar(text: StoredText, line: int) -> list[dict[str, str]]:
        # Found by the finders, not asked of Claude, and read with the choices as they stand now,
        # so every explanation, kept or new, shows them (docs/grammar.md, step 3).
        _, lexicon = engine.snapshot(text.language)
        choices = store.load_grammar(engine.conn)
        return [
            {"id": p.id, "name": p.name, "note": p.note, "state": choices.get(p.id, "unset")}
            for p in grammar.points_in(text.lines[line].text, lexicon, text.language)
        ]

    @app.post("/api/texts/{text_id}/lines/{line}/explain", dependencies=authed)
    async def explain_line(text_id: int, line: int, body: ExplainIn) -> dict[str, Any]:
        text = store.get_text(engine.conn, text_id)
        if text is None or not 0 <= line < len(text.lines):
            raise HTTPException(404, "No such line.")
        if (kept := store.get_explanation(engine.conn, text_id, line, body.simple)) is not None:
            return {"points": kept, "grammar": line_grammar(text, line)}
        if explain is None:
            raise HTTPException(
                503,
                "Claude isn't set up on the server, so it can't explain lines"
                " (ANTHROPIC_API_KEY in server/.env turns explanations on).",
            )
        spaced = LANGUAGES[text.language].spaced
        plain = [parse_line(ln.text, spaced)[0] for ln in text.lines]
        try:
            points, used = await explain(
                ExplainRequest(
                    text.language,
                    plain[line],
                    text.lines[line].english,
                    tuple(plain[max(0, line - 3) : line] + plain[line + 1 : line + 3]),
                    body.simple,
                )
            )
        except ExplainFailed as e:
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        store.save_explanation(
            engine.conn, text_id, line, body.simple, points, engine.clock(), used.cost_usd()
        )
        return {"points": points, "grammar": line_grammar(text, line)}

    @app.post("/api/texts/{text_id}/lines/{line}/phrase", dependencies=authed)
    async def explain_phrase_in_line(text_id: int, line: int, body: PhraseIn) -> dict[str, Any]:
        text = store.get_text(engine.conn, text_id)
        if text is None or not 0 <= line < len(text.lines):
            raise HTTPException(404, "No such line.")
        spaced = LANGUAGES[text.language].spaced
        plain = [parse_line(ln.text, spaced)[0] for ln in text.lines]
        phrase = body.phrase.strip()
        # The app joins the pieces the server split the line into, so the phrase is part of the
        # line as written; spaces are ignored in case the split and the line disagree on them.
        if not phrase or "".join(phrase.split()) not in "".join(plain[line].split()):
            raise HTTPException(400, "That phrase isn't in this line. Select it again.")
        kept = store.get_phrase_explanation(engine.conn, text_id, line, phrase, body.simple)
        if kept is not None:
            return kept
        if explain_phrase is None:
            raise HTTPException(
                503,
                "Claude isn't set up on the server, so it can't explain phrases"
                " (ANTHROPIC_API_KEY in server/.env turns explanations on).",
            )
        try:
            answer, used = await explain_phrase(
                PhraseRequest(
                    text.language,
                    phrase,
                    plain[line],
                    text.lines[line].english,
                    tuple(plain[max(0, line - 3) : line] + plain[line + 1 : line + 3]),
                    body.simple,
                )
            )
        except ExplainFailed as e:
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        store.save_phrase_explanation(
            engine.conn, text_id, line, phrase, body.simple, answer, engine.clock(), used.cost_usd()
        )
        return answer

    def settings_out(current: Settings) -> dict[str, Any]:
        # Every language's deck and voices, the default where none was chosen, so the app shows
        # what's used.
        decks = {code: with_deck(code, current.decks.get(code)).deck for code in LANGUAGES}
        common = {code: current.common_for(code) for code, info in LANGUAGES.items() if info.spaced}
        voices = {code: engine.voices_for(code) for code in LANGUAGES}
        return {**current.__dict__, "decks": decks, "voices": voices, "common": common}

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
        voices = {code: dict(v) for code, v in current.voices.items()}
        voices_before = {code: engine.voices_for(code) for code in body.voices or {}}
        for code, chosen in (body.voices or {}).items():
            mine = voices.setdefault(code, {})
            for speaker, name in chosen.items():
                name = name.strip()
                if name:
                    _check_voice(name, code)
                    await _check_voice_gender(speech, name, speaker)
                    mine[speaker] = name
                else:
                    mine.pop(speaker, None)
            if not mine:
                voices.pop(code)
        updated = Settings(
            stretch_words=body.stretch_words or current.stretch_words,
            lines=body.lines or current.lines,
            form=body.form or current.form,
            language=body.language or current.language,
            decks=decks,
            voices=voices,
            common=common,
        )
        store.save_settings(engine.conn, updated)
        for code in changed_decks:
            # The old deck's words mustn't be written with: read the new deck now.
            store.clear_snapshot(engine.conn, code)
            background.add_task(engine.refresh_lexicon, code)
        for code, then in voices_before.items():
            if engine.voices_for(code) != then:
                # The texts waiting to be read get the new voices too.
                background.add_task(engine.rerecord, code)
        return settings_out(updated)

    def need_speech() -> Speech:
        if speech is None:
            raise HTTPException(
                503,
                "Read & Listen's server has no Azure key. Set AZURE_SPEECH_KEY and"
                " AZURE_SPEECH_REGION in server/.env.",
            )
        return speech

    @app.get("/api/voices", dependencies=authed)
    async def voices(
        language: Annotated[str, Query(min_length=2, max_length=20)],
    ) -> dict[str, Any]:
        want = language.replace("_", "-").lower()
        try:
            found = await need_speech().voices()
        except SpeechError as e:
            raise HTTPException(503, str(e)) from e
        matching = [
            v
            for v in found
            if (loc := (v.get("locale") or "").lower()) == want or loc.startswith(want + "-")
        ]
        matching.sort(key=lambda v: (v.get("locale") or "", v.get("name") or ""))
        return {"voices": matching}

    @app.post("/api/speech", dependencies=authed)
    async def speak(body: SpeechIn) -> Response:
        try:
            locale_of(body.voice)
        except SpeechError as e:
            raise HTTPException(400, str(e)) from e
        try:
            mp3 = await need_speech().synthesize(body.text.strip(), body.voice, body.rate)
        except SpeechError as e:
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        return Response(mp3, media_type="audio/mpeg")

    @app.post("/api/mnemonics", dependencies=authed)
    async def make_mnemonics(body: MnemonicIn) -> dict[str, list[str]]:
        if mnemonics is None:
            raise HTTPException(
                503,
                "Claude isn't set up on the server, so it can't suggest hints. Write your own"
                " (ANTHROPIC_API_KEY in server/.env turns suggestions on).",
            )
        try:
            hints = await mnemonics(
                MnemonicRequest(
                    body.language,
                    body.entry.strip(),
                    body.meaning.strip(),
                    body.transliteration.strip(),
                    body.context.strip(),
                )
            )
        except MnemonicsFailed as e:
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        return {"hints": hints}

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

    @app.get("/api/costs", dependencies=authed)
    async def costs(days: Annotated[int, Query(ge=1, le=3650)] = 30) -> dict[str, Any]:
        since = engine.clock() - timedelta(days=days)
        by_language = store.spending(engine.conn, since)
        explained = store.explanation_spending(engine.conn, since)
        drilled = store.drill_spending(engine.conn, since)
        rows = by_language.values()
        total = store.Spending(
            sum(r.read for r in rows),
            sum(r.waiting for r in rows),
            sum(r.dropped for r in rows),
            sum(r.attempts for r in rows),
            sum(r.cost_usd for r in rows),
            sum(r.skipped for r in rows),
        )
        return {
            "days": days,
            "since": instant(since),
            "languages": [
                {"language": code, "name": LANGUAGES[code].name, **_spent(r)}
                for code, r in by_language.items()
            ],
            "total": _spent(total),
            # Explain's calls (lines and phrases), apart from the texts above (they aren't in per_text_usd).
            "explanations": {
                "asked": sum(n for n, _ in explained.values()),
                "cost_usd": round(sum(c for _, c in explained.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "asked": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in explained.items()
                ],
            },
            # Grammar drills' questions, written a batch at a time (drills.py).
            "drills": {
                "batches": sum(n for n, _ in drilled.values()),
                "cost_usd": round(sum(c for _, c in drilled.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "batches": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in drilled.items()
                ],
            },
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
                "last_marked": instant(w.last_marked),
            }
            for w in store.marked_words(engine.conn, language)
        ]

    def grammar_points() -> dict[str, Any]:
        language = engine.language()
        choices = store.load_grammar(engine.conn)
        seen = engine.grammar_exposure(language)
        return {
            "max_practice": grammar.MAX_PRACTICE,
            # The known points the next texts are asked to work in, least seen first.
            "least": list(engine.review_points(language)),
            "points": [
                {
                    "id": p.id,
                    "name": p.name,
                    "note": p.note,
                    "state": choices.get(p.id, "unset"),
                    "seen": _seen(seen[p.id]),
                }
                for p in grammar.points_for(language)
            ],
        }

    @app.get("/api/grammar", dependencies=authed)
    async def get_grammar() -> dict[str, Any]:
        return grammar_points()

    @app.get("/api/grammar/choices", dependencies=authed)
    async def get_grammar_choices() -> dict[str, Any]:
        # Every language's, not just the one being read: Forms practice asks for the deck's.
        choices = store.load_grammar(engine.conn)
        return {"choices": {pid: state for pid, state in choices.items() if pid in grammar.POINTS}}

    async def top_up_drills(point_ids: tuple[str, ...]) -> None:
        if write_drills is not None:
            await drills.top_up(
                engine.conn, engine.snapshot, write_drills, point_ids, engine.clock, drills_writing
            )

    @app.post("/api/drills", dependencies=authed)
    async def drill(body: DrillsIn, background: BackgroundTasks) -> dict[str, Any]:
        points = tuple(dict.fromkeys(body.points))
        questions = drills.serve(
            engine.conn, engine.snapshot, points, body.count, engine.clock(), engine.rng
        )
        background.add_task(top_up_drills, points)
        asked = {q["point"] for q in questions}
        return {
            "questions": questions,
            # Points that got no question: not in this server's catalog, or nothing read and no
            # questions written yet (being written now when Claude is set up).
            "missing": [p for p in points if p not in asked],
            "writing": write_drills is not None,
        }

    @app.get("/api/grammar/{point_id}", dependencies=authed)
    async def get_grammar_point(point_id: str) -> dict[str, Any]:
        # After /api/grammar/choices, so "choices" isn't taken for a point's id.
        point = grammar.POINTS.get(point_id)
        if point is None:
            raise HTTPException(404, "No such grammar point.")
        choices = store.load_grammar(engine.conn)
        _, lexicon = engine.snapshot(point.language)
        return {
            "id": point.id,
            "state": choices.get(point.id, "unset"),
            "seen": _seen(engine.grammar_exposure(point.language)[point.id]),
            "choices": {
                p.id: choices.get(p.id, "unset") for p in grammar.points_for(point.language)
            },
            "examples": [
                {
                    "text_id": e.text_id,
                    "title": e.title,
                    "line": e.line,
                    "english": e.english,
                    "words": list(e.words),
                }
                for e in exposure.examples(engine.conn, lexicon, point.id)
            ],
        }

    @app.put("/api/grammar/{point_id}", dependencies=authed)
    async def choose_grammar(
        point_id: str, body: GrammarChoice, background: BackgroundTasks
    ) -> dict[str, Any]:
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
                f"Practice at most {grammar.MAX_PRACTICE} at a time. Set one to Know it first.",
            )
        store.set_grammar(engine.conn, point_id, body.state)
        if body.state in ("practice", "normal"):
            # Drilled from now on (docs/grammar.md, step 5): its questions are written ahead.
            background.add_task(top_up_drills, (point_id,))
        return grammar_points()

    @app.post("/api/words/clear", status_code=204, dependencies=authed)
    async def clear_word(body: ClearWord) -> Response:
        store.clear_word(engine.conn, body.word, engine.clock())
        return Response(status_code=204)

    return app


def instant(at: datetime) -> str:
    """A time the app reads, with its UTC offset. The server's clock and its stored times are naive
    UTC (`engine.utc_now`, whatever `TZ` says); without the offset the app read them as the phone's
    local time, hours off, so "today" and a date could land on the wrong day. An aware time keeps
    its own offset. Every time in a response goes through this."""
    return (at if at.tzinfo else at.replace(tzinfo=UTC)).isoformat()


def _seen(e: exposure.Exposure) -> dict[str, Any]:
    last = instant(e.last_seen) if e.last_seen is not None else None
    return {"texts": e.texts, "uses": e.uses, "last": last}


def _rendered(text: StoredText, engine: Engine) -> dict[str, Any]:
    entries, lexicon = engine.snapshot(text.language)
    out = render(
        text,
        lexicon,
        {e.text: e.meaning for e in entries},
        {e.text: e.translit for e in entries if e.translit},
        # Not set as the owner's choices stand now, so a point marked since isn't still explained
        # as unmarked.
        unset=exposure.unset_points(store.load_grammar(engine.conn), text.language),
    )
    speaks = engine.audio is not None and engine.synthesize is not None
    for i, line in enumerate(out["lines"]):
        line["audio"] = speaks or engine.has_audio(text.id, i)
    topic = store.get_topic(engine.conn, text.topic_id, text.language, include_removed=True)
    story = store.get_story(engine.conn, text.story_id) if text.story_id else None
    # What the reader shows under the title, and whether More like this is already on.
    out["topic"] = (story.title or "Your story") if story else (topic.name if topic else "")
    out["liked"] = bool(topic and topic.favorite)
    out["reason"] = text.reason
    out["episode"] = text.episode
    return out


def _shelf_text(text: StoredText, engine: Engine) -> dict[str, Any]:
    """A text on the shelf as a card shows it, without its words (they come with /api/texts/{id})."""
    topic = store.get_topic(engine.conn, text.topic_id, text.language, include_removed=True)
    return {
        "id": text.id,
        "title": text.title,
        "topic": topic.name if topic else "",
        "topic_id": text.topic_id,
        "liked": bool(topic and topic.favorite),
        "form": text.form,
        "lines": len(text.lines),
        "stretch": list(text.stretch),
        "reason": text.reason,
        "coverage": text.coverage,
        "episode": text.episode,
    }


def _shelf(engine: Engine) -> dict[str, Any]:
    language = engine.language()
    writing = engine.writing(language)
    story = store.active_story(engine.conn, language)
    story_out = None
    if story is not None:
        told = store.episodes(engine.conn, story.id)
        read = [t for t in told if store.text_status(engine.conn, t.id) == "read"]
        waiting = store.waiting_episode(engine.conn, story.id)
        story_out = {
            "id": story.id,
            "title": story.title,
            "about": story.about,
            "read": len(read),
            "last_recap": read[-1].recap if read else "",
            "next": _shelf_text(waiting, engine) if waiting else None,
            "writing": any(j.story_id == story.id for j in writing),
            "failed": engine.failure(story.topic_id, language),
        }
    counts = store.ready_counts(engine.conn)
    return {
        "language": language,
        "languages": [
            {"code": code, "name": info.name, "ready": counts.get(code, 0)}
            for code, info in LANGUAGES.items()
        ],
        "texts": [_shelf_text(t, engine) for t in store.shelf_texts(engine.conn, language)],
        "writing": [
            {
                "topic": store.topic_name(engine.conn, j.topic_id),
                "reason": j.reason,
                "form": j.form or "dialogue",
            }
            for j in writing
            if j.story_id is None
        ],
        "story": story_out,
        "themes": [{"id": t.id, "name": t.name} for t in store.liked_topics(engine.conn)],
    }


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
    mnemonics: MakeMnemonics | None = None
    explain: Explain | None = None
    explain_phrase: ExplainPhrase | None = None
    write_drills: drills.WriteDrills | None = None
    if key := settings.secrets.get("ANTHROPIC_API_KEY"):
        client = anthropic.AsyncAnthropic(api_key=key)
        mnemonics = claude_mnemonics(client)
        explain = claude_explain(client)
        explain_phrase = claude_explain_phrase(client)
        write_drills = drills.claude_drills(client)

        def ask_for(entries: list[Entry], language: Code) -> Ask:
            return claude_ask(client, entries, language)

    synthesize = None
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
    engine = Engine(
        conn,
        ask_for,
        read_deck=read_deck,
        synthesize=synthesize,
        audio=AudioCache(settings.audio_dir),
        voices=settings.voices,
    )
    return create_app(
        engine,
        settings.secrets.get("APP_PASSPHRASE"),
        speech,
        mnemonics,
        explain,
        explain_phrase,
        status_token=settings.secrets.get("STATUS_TOKEN"),
        read_due=due_with_timeout(anki.due) if anki else None,
        write_drills=write_drills,
    )
