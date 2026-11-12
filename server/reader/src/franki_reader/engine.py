"""What the API does, apart from HTTP: serve a ready text, write one in the background when none is
ready, keep each favorite topic's queue topped up, and log readings (docs/read-and-listen/architecture.md, Hosting
and Topics).

Writing a text takes up to a minute or more (three attempts, then audio), longer than an iPhone
waits on one request, so `/next` never waits for it: `next_text` returns a ready text or starts a
background write and returns None, and the app asks again. A write that fails is reported to the
next request for that topic, once, and keeps the background top-up off that topic for
`FAILURE_COOLDOWN`, so a topic that keeps missing the floor doesn't keep spending.

Everything outside the process is injected: the model (`ask_for`), Anki (`read_deck`), text to
speech, the clock and the random source. Any of them can be missing, and the engine says which.
"""

import asyncio
import logging
import random
import sqlite3
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Literal

from franki_reader import grammar, store
from franki_reader.coverage import Checker, parse_line
from franki_reader.difficulty import Difficulty, adapt
from franki_reader.generator import Ask, GenerationFailed, TextRequest, generate
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lexicon import Entry, ReadDeck, clean, lexicon_from
from franki_reader.store import Reading, StoredText, Topic
from franki_reader.stretch import pick_stretch
from franki_reader.tts import DEFAULT_VOICES, AudioCache, Synthesize, TtsFailed

READY_PER_FAVORITE = 1
# How many due or young words the model chooses its stretch words from, when it's choosing.
STRETCH_CHOICES = 15
FAILURE_COOLDOWN = timedelta(minutes=30)
# Every attempt was under 90% known words (coverage.MINIMUM), too far off to show.
MISSED_FLOOR = (
    "Couldn't write a text that fits your words this time. Try again or pick another topic."
)

TopicState = Literal["ready", "writing", "failed", "idle"]

log = logging.getLogger(__name__)


class NotAvailable(Exception):
    """Something the request needs isn't set up yet, or the last write for this topic failed. The
    message says what, for the app to show."""


class NotFound(Exception):
    """No topic or text with that id."""


@dataclass
class _Failure:
    at: datetime
    message: str
    reported: bool = False


# A topic, a language, and the words a text was asked to practice ("" for the queue's own texts).
_Key = tuple[int, Code, str]


def focus_of(words: Iterable[str]) -> str:
    """The words a text is asked to practice, as one key: cleaned, without repeats, sorted."""
    return "\n".join(sorted({w for w in (clean(x) for x in words) if w}))


def _grammar_record(request: TextRequest) -> dict[str, list[str]]:
    return {"practice": list(request.practice), "avoid": list(request.avoid)}


class Engine:
    def __init__(
        self,
        conn: sqlite3.Connection,
        ask_for: Callable[[list[Entry], Code], Ask] | None,
        read_deck: ReadDeck | None,
        clock: Callable[[], datetime] = datetime.now,
        rng: random.Random | None = None,
        synthesize: Synthesize | None = None,
        audio: AudioCache | None = None,
        voices: dict[str, str] | None = None,
    ) -> None:
        self.conn = conn
        self.ask_for = ask_for
        self.read_deck = read_deck
        self.clock = clock
        self.rng = rng or random.Random()
        self.synthesize = synthesize
        self.audio = audio
        self.voices = voices or DEFAULT_VOICES
        # All by topic and language: a topic can be writing in one language and failed in another.
        self._topic_locks: dict[tuple[int, Code], asyncio.Lock] = {}
        self._topping_up = asyncio.Lock()
        self._writing: set[_Key] = set()
        self._failures: dict[_Key, _Failure] = {}
        self._tasks: set[asyncio.Task[None]] = set()

    # ==== Lexicon ====

    def language(self) -> Code:
        """The language new texts are written and served in (a setting)."""
        return store.load_settings(self.conn).language

    def snapshot(self, language: Code | None = None) -> tuple[list[Entry], Checker]:
        """A language's entries and its checker (cached by `lexicon_from`)."""
        language = language or self.language()
        entries = store.load_snapshot(self.conn, language)[0]
        common = store.load_settings(self.conn).common_for(language)
        return entries, lexicon_from(entries, language, common)

    def entries(self, language: Code | None = None) -> list[Entry]:
        return self.snapshot(language)[0]

    async def refresh_lexicon(self, language: Code | None = None, force: bool = False) -> None:
        if self.read_deck is not None:
            language = language or self.language()
            await store.refresh_if_stale(self.conn, self.read_deck, self.clock(), language, force)

    # ==== Serving ====

    def topic_state(self, topic: Topic, language: Code | None = None) -> TopicState:
        """`topic` is as listed for this language, so its ready count is this language's."""
        key = (topic.id, language or self.language(), "")
        if topic.ready > 0:
            return "ready"
        if key in self._writing:
            return "writing"
        if self._cooling_down(key):
            return "failed"
        return "idle"

    async def next_text(self, topic_id: int, words: Iterable[str] = ()) -> StoredText | None:
        """A ready text in the current language, or None while one is being written in the
        background (started here if nothing is writing). A failed write is raised once as
        NotAvailable; asking again after that is a deliberate retry and starts a new write.

        With `words` (the cards just studied, from the app's "Read a text with these words"), the
        text is one written to practice them, never one from the queue."""
        language = self.language()
        focus = focus_of(words)
        key = (topic_id, language, focus)
        if store.get_topic(self.conn, topic_id, language) is None:
            raise NotFound(topic_id)
        ready = store.next_ready_text(self.conn, topic_id, language, focus)
        if ready is not None:
            return ready
        if key in self._writing:
            return None
        failure = self._failures.get(key)
        if failure is not None and not failure.reported:
            failure.reported = True
            raise NotAvailable(failure.message)
        self._check_setup(language)
        self._failures.pop(key, None)
        self._start(key)
        return None

    def _check_setup(self, language: Code) -> None:
        if self.ask_for is None:
            raise NotAvailable("The server has no Claude API key yet.")
        if not store.load_snapshot(self.conn, language)[0]:
            name = LANGUAGES[language].name
            raise NotAvailable(f"The server has no {name} word list from Anki yet.")

    def _start(self, key: _Key) -> None:
        self._writing.add(key)  # before the task runs, so a second request sees it
        task = asyncio.create_task(self._write(key))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _write(self, key: _Key) -> None:
        """Writes one text and records how it went. Never raises: this runs unattended."""
        topic_id, language, focus = key
        self._writing.add(key)
        try:
            if await self.make_text(topic_id, language, focus) is None:
                self._fail(key, MISSED_FLOOR)
        except NotAvailable as e:
            self._fail(key, str(e))
        except GenerationFailed as e:
            self._fail(key, f"Couldn't write a text: {e}")
        except Exception:
            log.exception("Writing a %s text for topic %d failed", language, topic_id)
            self._fail(key, "Something went wrong writing a text. Try again.")
        finally:
            self._writing.discard(key)

    def _fail(self, key: _Key, message: str) -> None:
        self._failures[key] = _Failure(self.clock(), message)

    def _cooling_down(self, key: _Key) -> bool:
        failure = self._failures.get(key)
        return failure is not None and self.clock() - failure.at < FAILURE_COOLDOWN

    # ==== Writing ====

    async def make_text(
        self, topic_id: int, language: Code | None = None, focus: str = ""
    ) -> StoredText | None:
        """Generates and stores one text, or returns None when every attempt was too far under
        the floor to show. One generation per topic and language at a time; a caller that waited
        on the lock gets the text the one before it just wrote instead of writing another."""
        language = language or self.language()
        lock = self._topic_locks.setdefault((topic_id, language), asyncio.Lock())
        async with lock:
            ready = store.next_ready_text(self.conn, topic_id, language, focus)
            if ready is not None:
                return ready
            topic = store.get_topic(self.conn, topic_id, language)
            if topic is None:
                raise NotFound(topic_id)
            if focus:
                # The words were just studied: read the deck now, so a card first learned today
                # counts as known rather than waiting for tomorrow's snapshot.
                await self.refresh_lexicon(language, force=True)
            self._check_setup(language)
            assert self.ask_for is not None
            entries, lexicon = self.snapshot(language)
            difficulty = store.load_difficulty(self.conn, language)
            request = self._request(topic.name, entries, difficulty, language, focus)
            result = await generate(self.ask_for(entries, language), lexicon, request)
            words = list(result.stretch)
            if not result.passed:
                # Stored as dropped, never served, so its cost is still on record.
                store.save_text(
                    self.conn,
                    topic_id,
                    result,
                    words,
                    difficulty.floor,
                    self.clock(),
                    "dropped",
                    request.form,
                    language,
                    _grammar_record(request),
                    focus,
                )
                log.warning(
                    "Dropped a %s %r text at %.1f%% after %d attempts ($%.4f)",
                    language,
                    topic.name,
                    result.coverage.ratio * 100,
                    result.attempts,
                    result.usage.cost_usd(),
                )
                return None
            if not result.floor_met:
                log.info(
                    "Kept a %s %r text under the floor at %.1f%%, the closest of %d attempts",
                    language,
                    topic.name,
                    result.coverage.ratio * 100,
                    result.attempts,
                )
            # Pending until its audio is made, so a text is never served half-spoken.
            text_id = store.save_text(
                self.conn,
                topic_id,
                result,
                words,
                difficulty.floor,
                self.clock(),
                "pending",
                request.form,
                language,
                _grammar_record(request),
                focus,
            )
            text = store.get_text(self.conn, text_id)
            assert text is not None
            await self.make_audio(text)
            store.mark_ready(self.conn, text_id)
            return text

    def _request(
        self,
        topic: str,
        entries: list[Entry],
        difficulty: Difficulty,
        language: Code | None = None,
        focus: str = "",
    ) -> TextRequest:
        language = language or self.language()
        settings = store.load_settings(self.conn)
        start_of_today = self.clock().replace(hour=0, minute=0, second=0, microsecond=0)
        practiced = store.practiced_days(self.conn, start_of_today, language)
        chosen = store.load_grammar(self.conn)
        mine = [p.id for p in grammar.points_for(language)]
        practice = tuple(p for p in mine if chosen.get(p) == "practice")
        avoid = tuple(p for p in mine if chosen.get(p) == "avoid")

        def request(stretch: list[Entry], choose: int | None = None) -> TextRequest:
            return TextRequest(
                topic,
                tuple(stretch),
                lines=settings.lines,
                floor=difficulty.floor,
                choose=choose,
                form=settings.form,
                language=language,
                common=settings.common_for(language) if LANGUAGES[language].spaced else 0,
                practice=practice,
                avoid=avoid,
            )

        if focus:
            # Words just studied: the model uses as many of them as fit the topic, up to the usual
            # count. Only words the deck has studied can be practiced; the rest are left out.
            wanted = set(focus.split("\n"))
            studied = [e for e in entries if e.text in wanted and e.tier != "unreviewed"]
            if not studied:
                name = LANGUAGES[language].name
                raise NotAvailable(
                    f"None of those words are in the {name} word list yet. Sync Franki, then try again."
                )
            self.rng.shuffle(studied)
            picked = studied[:STRETCH_CHOICES]
            return request(picked, min(difficulty.stretch, len(picked)))
        if settings.stretch_words == "any":
            return request(pick_stretch(entries, difficulty.stretch, self.rng, practiced))
        choices = pick_stretch(entries, STRETCH_CHOICES, self.rng, practiced)
        return request(choices, difficulty.stretch) if choices else request([])

    # ==== Audio ====

    def has_audio(self, text_id: int, line: int) -> bool:
        return self.audio is not None and self.audio.has(text_id, line)

    async def make_audio(self, text: StoredText) -> None:
        """Speaks every line that has no audio yet. A failure leaves that line silent and is
        logged; it never keeps the text from being served."""
        for i in range(len(text.lines)):
            await self.line_audio(text, i)

    def voices_for(self, language: Code) -> dict[str, str]:
        # Thai's can be overridden from the environment (config.py); the rest use their defaults.
        return self.voices if language == "th" else LANGUAGES[language].voices

    async def line_audio(self, text: StoredText, line: int) -> Path | None:
        """The cached MP3 for one line, made now if it's missing and text to speech is set up."""
        if self.audio is None or not 0 <= line < len(text.lines):
            return None
        if self.audio.has(text.id, line):
            return self.audio.path(text.id, line)
        if self.synthesize is None:
            return None
        spoken, _ = parse_line(text.lines[line].text, LANGUAGES[text.language].spaced)
        voices = self.voices_for(text.language)
        voice = voices.get(text.lines[line].speaker, voices["A"])
        try:
            mp3 = await self.synthesize(spoken, voice)
        except TtsFailed as e:
            log.warning("No audio for text %d line %d: %s", text.id, line, e)
            return None
        self.audio.write(text.id, line, mp3)
        return self.audio.path(text.id, line)

    # ==== Top-up and readings ====

    async def top_up(self) -> None:
        """Refreshes the current language's lexicon if it's a day old, then makes sure each
        favorite topic has a ready text in that language. Only the current language is topped up,
        so having two doesn't double the spending. Runs after a response is sent; a second call
        while one is running does nothing. A topic that failed recently is skipped; a missing key
        or word list stops the whole pass."""
        if self._topping_up.locked():
            return
        async with self._topping_up:
            language = self.language()
            await self.refresh_lexicon(language)
            try:
                self._check_setup(language)
            except NotAvailable as e:
                log.info("Not topping up: %s", e)
                return
            for topic in store.list_topics(self.conn, language):
                key = (topic.id, language, "")
                if not topic.favorite or topic.ready >= READY_PER_FAVORITE:
                    continue
                if key in self._writing or self._cooling_down(key):
                    continue
                await self._write(key)

    def record_reading(self, text_id: int, reading: Reading) -> None:
        """Logs a session and adjusts the difficulty of the text's language. A second reading of a
        text that's already been read is ignored, so a retried request can't log twice or move
        difficulty twice."""
        status = store.text_status(self.conn, text_id)
        if status is None:
            raise NotFound(text_id)
        if status == "read":
            return
        store.log_reading(self.conn, text_id, reading, self.clock())
        text = store.get_text(self.conn, text_id)
        if reading.rating is not None and text is not None:
            current = store.load_difficulty(self.conn, text.language)
            store.save_difficulty(self.conn, adapt(current, reading.rating), text.language)
