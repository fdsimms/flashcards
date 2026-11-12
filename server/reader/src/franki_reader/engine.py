"""What the API does, apart from HTTP: serve a ready text, write one in the background when none is
ready, keep the shelf and the ongoing story topped up, and log readings
(docs/read-and-listen/architecture.md, Hosting, Shelf and Stories).

The shelf is a few texts written ahead in the language being read (`SHELF_SIZE`), each for a
reason: around words due today, on a theme the owner likes, or an idea not tried before, with
dialogues and stories mixed. It's filled only for the current language, only after a request from
the app, and a text left unread stays on it rather than being written again.

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
from franki_reader.gender import full_voices, voice_for
from franki_reader.generator import (
    Ask,
    Form,
    GenerationFailed,
    StoryContext,
    TextRequest,
    generate,
)
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lexicon import Entry, ReadDeck, clean, lexicon_from
from franki_reader.store import Reading, Reason, StoredText, Story, Topic
from franki_reader.stretch import pick_stretch
from franki_reader.suggestions import suggest
from franki_reader.tts import DEFAULT_VOICES, AudioCache, Synthesize, TtsFailed

# Texts kept written ahead on a language's shelf, not counting ones typed in or story episodes.
SHELF_SIZE = 3
# The kinds of text the shelf keeps one of each, in the order they're written.
SHELF_KINDS: tuple[Reason, ...] = ("due", "liked", "new")
# A new idea is picked from this many of the best-fitting ones, so the shelf isn't predictable.
IDEA_CHOICES = 5
# How many due or young words the model chooses its stretch words from, when it's choosing.
STRETCH_CHOICES = 15
FAILURE_COOLDOWN = timedelta(minutes=30)
# Every attempt was under 85% known words (coverage.MINIMUM), too far off to show.
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


@dataclass(frozen=True)
class Job:
    """One text to write. Only the topic, language and focus tell two writes apart (`key`); the
    rest is how this one is written."""

    topic_id: int
    language: Code
    focus: str = ""
    reason: Reason = ""
    form: Form | None = None  # None: the `form` setting
    # Hand the model due words to use, rather than letting it choose ones that fit (shelf "due").
    any_words: bool = False
    story_id: int | None = None

    @property
    def key(self) -> _Key:
        return (self.topic_id, self.language, self.focus)


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
        self._jobs: dict[_Key, Job] = {}  # what's being written now, for the shelf to show
        # When a shelf text last failed, by language: the shelf isn't filled again until the
        # cooldown passes, or every refresh would try another idea and keep spending.
        self._shelf_failed: dict[Code, datetime] = {}
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
        self._start(Job(topic_id, language, focus))
        return None

    def _check_setup(self, language: Code) -> None:
        if self.ask_for is None:
            raise NotAvailable("The server has no Claude API key yet.")
        if not store.load_snapshot(self.conn, language)[0]:
            name = LANGUAGES[language].name
            raise NotAvailable(f"The server has no {name} word list from Anki yet.")

    def _start(self, job: Job) -> None:
        # Before the task runs, so a second request sees it.
        self._writing.add(job.key)
        self._jobs[job.key] = job
        task = asyncio.create_task(self._write(job))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _write(self, job: Job) -> None:
        """Writes one text and records how it went. Never raises: this runs unattended."""
        key, topic_id, language = job.key, job.topic_id, job.language
        self._writing.add(key)
        self._jobs[key] = job
        try:
            if await self.make_text(topic_id, language, job.focus, job) is None:
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
            self._jobs.pop(key, None)

    def _fail(self, key: _Key, message: str) -> None:
        self._failures[key] = _Failure(self.clock(), message)

    def failure(self, topic_id: int, language: Code) -> str | None:
        """Why the last write for a topic failed, while it's cooling down; else None."""
        key = (topic_id, language, "")
        return self._failures[key].message if self._cooling_down(key) else None

    def _cooling_down(self, key: _Key) -> bool:
        failure = self._failures.get(key)
        return failure is not None and self.clock() - failure.at < FAILURE_COOLDOWN

    # ==== Writing ====

    async def make_text(
        self,
        topic_id: int,
        language: Code | None = None,
        focus: str = "",
        job: Job | None = None,
    ) -> StoredText | None:
        """Generates and stores one text, or returns None when every attempt was too far under
        the floor to show. One generation per topic and language at a time; a caller that waited
        on the lock gets the text the one before it just wrote instead of writing another. `job`
        says why it's written and how (the shelf, a story episode)."""
        language = language or self.language()
        job = job or Job(topic_id, language, focus)
        lock = self._topic_locks.setdefault((topic_id, language), asyncio.Lock())
        async with lock:
            ready = store.next_ready_text(self.conn, topic_id, language, focus)
            if ready is not None:
                return ready
            story = store.get_story(self.conn, job.story_id) if job.story_id else None
            # A story's topic and the shelf's own ideas are hidden, so they aren't in the list.
            topic = store.get_topic(self.conn, topic_id, language, include_removed=True)
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
            context = self._story_context(story) if story else None
            request = self._request(
                (story.about or "an ongoing story") if story else topic.name,
                entries,
                difficulty,
                language,
                focus,
                form="story" if story else job.form,
                any_words=job.any_words,
                story=context,
            )
            result = await generate(self.ask_for(entries, language), lexicon, request)
            extra = {
                "reason": job.reason,
                "story_id": story.id if story else None,
                "episode": context.episode if context else 0,
            }
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
                    **extra,  # type: ignore[arg-type]
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
                **extra,  # type: ignore[arg-type]
            )
            if story and context and context.episode == 1:
                store.name_story(self.conn, story.id, result.series, result.cast)
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
        form: Form | None = None,
        any_words: bool = False,
        story: StoryContext | None = None,
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
                ceiling=difficulty.ceiling,
                choose=choose,
                form=form or settings.form,
                language=language,
                common=settings.common_for(language) if LANGUAGES[language].spaced else 0,
                practice=practice,
                avoid=avoid,
                story=story,
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
        if any_words or settings.stretch_words == "any":
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
        """The language's voice for each slot (languages.VOICE_SLOTS): the one chosen in the app,
        else the default (Thai's man and woman can be set from the environment, config.py; the
        rest are in languages.py), and a second voice there isn't one for is the first."""
        base = {**LANGUAGES[language].voices, **(self.voices if language == "th" else {})}
        return full_voices({**base, **store.load_settings(self.conn).voices.get(language, {})})

    async def rerecord(self, language: Code) -> None:
        """Speaks the texts waiting to be read again, after their language's voices changed. A text
        already read keeps its audio until it's opened again with none (`line_audio`)."""
        if self.audio is None:
            return
        for text in store.ready_texts(self.conn, language):
            self.audio.drop(text.id)
            await self.make_audio(text)

    async def line_audio(self, text: StoredText, line: int) -> Path | None:
        """The cached MP3 for one line, made now if it's missing and text to speech is set up."""
        if self.audio is None or not 0 <= line < len(text.lines):
            return None
        if self.audio.has(text.id, line):
            return self.audio.path(text.id, line)
        if self.synthesize is None:
            return None
        spoken, _ = parse_line(text.lines[line].text, LANGUAGES[text.language].spaced)
        voice = voice_for(text.lines[line].speaker, text.genders, self.voices_for(text.language))
        try:
            mp3 = await self.synthesize(spoken, voice)
        except TtsFailed as e:
            log.warning("No audio for text %d line %d: %s", text.id, line, e)
            return None
        self.audio.write(text.id, line, mp3)
        return self.audio.path(text.id, line)

    # ==== Top-up and readings ====

    async def top_up(self) -> None:
        """Refreshes the current language's lexicon if it's a day old, then writes the story's next
        episode if it has none waiting, and fills the shelf to `SHELF_SIZE`. Only the current
        language, so having several doesn't multiply the spending. Runs after a response is sent; a
        second call while one is running does nothing. A topic that failed recently is skipped, and
        a failed shelf text ends the pass and pauses the shelf for `FAILURE_COOLDOWN`; a missing
        key or word list stops it quietly."""
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
            story = store.active_story(self.conn, language)
            if story is not None:
                episode = Job(story.topic_id, language, reason="story", story_id=story.id)
                if self._idle(episode) and not self._episode_waiting(story):
                    await self._write(episode)
            failed = self._shelf_failed.get(language)
            if failed is not None and self.clock() - failed < FAILURE_COOLDOWN:
                return
            while (job := self._next_shelf_job(language)) is not None:
                await self._write(job)
                if self._cooling_down(job.key):
                    self._shelf_failed[language] = self.clock()
                    break

    def _idle(self, job: Job) -> bool:
        return job.key not in self._writing and not self._cooling_down(job.key)

    def _episode_waiting(self, story: Story) -> bool:
        return store.waiting_episode(self.conn, story.id, pending=True) is not None

    def writing(self, language: Code) -> list[Job]:
        """The shelf texts and story episodes being written in a language now."""
        return [j for j in self._jobs.values() if j.language == language and not j.focus]

    def _next_shelf_job(self, language: Code) -> Job | None:
        """The next text the shelf needs, or None when it has `SHELF_SIZE`. Each kind in
        `SHELF_KINDS` the shelf lacks comes first; dialogues and stories alternate."""
        on_shelf = [t for t in store.shelf_texts(self.conn, language) if t.reason != "asked"]
        writing = [j for j in self.writing(language) if j.story_id is None and j.reason != "asked"]
        if len(on_shelf) + len(writing) >= SHELF_SIZE:
            return None
        forms = [t.form for t in on_shelf] + [j.form or "dialogue" for j in writing]
        form: Form = "story" if forms.count("dialogue") > forms.count("story") else "dialogue"
        have = {t.reason for t in on_shelf} | {j.reason for j in writing}
        wanted = [k for k in SHELF_KINDS if k not in have] + ["new", "liked"]
        for kind in wanted:
            job = self._shelf_job(kind, language, form)
            if job is not None:
                return job
        return None

    def _shelf_job(self, kind: Reason, language: Code, form: Form) -> Job | None:
        # A liked theme with nothing waiting and nothing being written for it.
        free = [
            t
            for t in store.liked_topics(self.conn)
            if self._idle(Job(t.id, language))
            and store.next_ready_text(self.conn, t.id, language) is None
        ]
        if kind == "liked":
            if not free:
                return None
            return Job(self.rng.choice(free).id, language, reason="liked", form=form)
        if kind == "due":
            topic = self.rng.choice(free) if free else self._new_topic(language)
            if topic is None:
                return None
            return Job(topic.id, language, reason="due", form=form, any_words=True)
        topic = self._new_topic(language)
        return Job(topic.id, language, reason="new", form=form) if topic else None

    def _new_topic(self, language: Code) -> Topic | None:
        """An idea not tried before, added as a hidden topic, so it isn't listed or offered again."""
        _, lexicon = self.snapshot(language)
        ideas = suggest(lexicon, store.topic_names(self.conn), language)[:IDEA_CHOICES]
        if not ideas:
            return None
        name = self.rng.choice(ideas).name
        return store.add_topic(self.conn, name, False, self.clock(), hidden=True)

    # ==== Asked for ====

    def write_about(self, name: str, form: Form) -> Topic:
        """Starts writing a text on a topic typed in (it joins the shelf when it's ready, beyond
        `SHELF_SIZE`). Raises ValueError for an empty name, NotAvailable when nothing can be
        written yet."""
        language = self.language()
        self._check_setup(language)
        topic = store.add_topic(self.conn, name, False, self.clock())
        job = Job(topic.id, language, reason="asked", form=form)
        if job.key not in self._writing:
            self._failures.pop(job.key, None)
            self._start(job)
        return topic

    def start_story(self, about: str) -> Story:
        """Starts a new story in the current language (retiring the one before it) and writes its
        first episode in the background."""
        language = self.language()
        self._check_setup(language)
        story = store.start_story(self.conn, language, about, self.clock())
        self._start(Job(story.topic_id, language, reason="story", story_id=story.id))
        return story

    def _story_context(self, story: Story) -> StoryContext:
        told = store.episodes(self.conn, story.id)
        return StoryContext(
            episode=max((t.episode for t in told), default=0) + 1,
            about=story.about,
            title=story.title,
            cast=story.cast,
            recaps=tuple(t.recap for t in told if t.recap),
        )

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
