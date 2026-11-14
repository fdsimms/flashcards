"""What the API does, apart from HTTP: serve a ready text, write one in the background when none is
ready, keep the shelf and the ongoing story topped up, and log readings
(docs/read-and-listen/architecture.md, Hosting, Shelf and Stories).

The shelf is the texts written and not yet read in the language being read. Nothing fills it on its
own: a text is written only when asked for (a typed topic, "Surprise me", a practice text), and the
ongoing story's next episode is written once the last one is read.

Writing a text takes up to a minute or more (three attempts, then audio), longer than an iPhone
waits on one request, so `/next` never waits for it: `next_text` returns a ready text or starts a
background write and returns None, and the app asks again. A write that fails is reported to the
next request for that topic, once, and keeps the background top-up off that topic for
`FAILURE_COOLDOWN`, so a topic that keeps missing the floor doesn't keep spending.

Everything outside the process is injected: the model (`ask_for`), Anki (`read_deck`), WaniKani
(`read_wanikani`), text to speech, the clock and the random source. Any of them can be missing, and the engine says which.
"""

import asyncio
import logging
import random
import sqlite3
from collections.abc import Callable, Iterable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta, tzinfo
from pathlib import Path
from typing import Literal

from franki_reader import comprehension, exposure, form_primers, forms, grammar, meanings, store
from franki_reader.coverage import Checker, Coverage, parse_line
from franki_reader.difficulty import Difficulty, after_reading
from franki_reader.gender import full_voices, voice_for
from franki_reader.generator import (
    Ask,
    Form,
    Generated,
    GenerationFailed,
    StoryContext,
    TextRequest,
    Usage,
    generate,
)
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lexicon import Entry, ReadDeck, clean, lexicon_from
from franki_reader.meanings import Wanted
from franki_reader.store import Reading, Reason, StoredText, Story, Topic
from franki_reader.stretch import pick_stretch, waiting
from franki_reader.study_day import DEFAULT_ROLLOVER, study_day, study_day_start
from franki_reader.tts import DEFAULT_VOICES, AudioCache, Synthesize, TtsFailed, billed_chars
from franki_reader.wanikani import ReadWaniKani, as_entries

# How many reviewed or young words the model chooses its stretch words from, when it's choosing.
STRETCH_CHOICES = 15
FAILURE_COOLDOWN = timedelta(minutes=30)
BACKFILL_TEXTS = 30  # how many recent texts a pass looks through for words with no meaning
BACKFILL_FORMS = 3  # how many of them a pass picks word forms for (one Claude call each)
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
    # Hand the model words reviewed today to use, rather than letting it choose ones that fit
    # (shelf "due").
    any_words: bool = False
    story_id: int | None = None

    @property
    def key(self) -> _Key:
        return (self.topic_id, self.language, self.focus)


def focus_of(words: Iterable[str]) -> str:
    """The words a text is asked to practice, as one key: cleaned, without repeats, sorted."""
    return "\n".join(sorted({w for w in (clean(x) for x in words) if w}))


def _grammar_record(request: TextRequest) -> dict[str, list[str]]:
    return {
        "practice": list(request.practice),
        "avoid": list(request.avoid),
        "review": list(request.review),
    }


def utc_now() -> datetime:
    """The engine's clock: naive, in UTC, whatever the process's time zone. Every time the reader
    stores is in this form, as it was when the container ran in UTC. `TZ` (server/.env) is there for
    Anki, which decides the study day from the process's zone, and must not shift these."""
    return datetime.now(UTC).replace(tzinfo=None)


class Engine:
    def __init__(
        self,
        conn: sqlite3.Connection,
        ask_for: Callable[[list[Entry], Code], Ask] | None,
        read_deck: ReadDeck | None,
        clock: Callable[[], datetime] = utc_now,
        rng: random.Random | None = None,
        synthesize: Synthesize | None = None,
        audio: AudioCache | None = None,
        voices: dict[str, str] | None = None,
        rollover: Callable[[], int] = lambda: DEFAULT_ROLLOVER,
        zone: tzinfo | None = None,
        write_meanings: meanings.WriteMeanings | None = None,
        read_wanikani: ReadWaniKani | None = None,
        write_questions: comprehension.WriteQuestions | None = None,
        write_forms: forms.WriteForms | None = None,
    ) -> None:
        self.conn = conn
        self.ask_for = ask_for
        self.read_deck = read_deck
        self.read_wanikani = read_wanikani  # Japanese's words learned in WaniKani (wanikani.py)
        self.clock = clock
        self.rng = rng or random.Random()
        self.grammar_cache: exposure.Cache = {}
        self.synthesize = synthesize
        self.audio = audio
        self.voices = voices or DEFAULT_VOICES
        # Which study day it is (study_day.py): the collection's "Next day starts at" as last read,
        # in `zone`, the process's own (TZ) when None.
        self.rollover = rollover
        self.zone = zone
        self.write_meanings = write_meanings
        # When Claude last failed to write word meanings, by language, so a pass that keeps failing
        # doesn't keep asking.
        self._meanings_failed: dict[Code, datetime] = {}
        self._meanings_lock = asyncio.Lock()
        self.write_questions = write_questions
        self.write_forms = write_forms
        # When Claude last failed to pick word forms, by language, as for meanings.
        self._forms_failed: dict[Code, datetime] = {}
        self._forms_lock = asyncio.Lock()
        # All by topic and language: a topic can be writing in one language and failed in another.
        self._topic_locks: dict[tuple[int, Code], asyncio.Lock] = {}
        self._topping_up = asyncio.Lock()
        # Per language: which voice change the running re-record belongs to, and its lock.
        self._rerecord_gen: dict[Code, int] = {}
        self._rerecord_locks: dict[Code, asyncio.Lock] = {}
        self._writing: set[_Key] = set()
        self._jobs: dict[_Key, Job] = {}  # what's being written now, for the shelf to show
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
        extra = [e.text for e in self.wanikani_entries(language)]
        return entries, lexicon_from(entries, language, common, extra)

    def entries(self, language: Code | None = None) -> list[Entry]:
        return self.snapshot(language)[0]

    def writing_lexicon(
        self, language: Code, keep: Iterable[Entry] = ()
    ) -> tuple[list[Entry], Checker]:
        """The entries and checker a new text is written with: `snapshot`'s, less the words with a
        card due today and not answered today (`stretch.waiting`: on the snapshot's day, or by due
        date on a later one). Seen in a text, its gloss a tap away, before its review, a word's
        review becomes short-term recall and FSRS lengthens an interval the learner didn't earn
        (brief, principle 9). Such a word isn't in the model's list and counts as unknown in any
        form, so a draft that uses it goes back naming it. `keep` is the text's practice words,
        never withheld: the ones picked are never waiting, and those of "Read a text with these
        words" were just reviewed in Franki, whatever a snapshot read before its sync says.
        Reading a text, its glosses and its marks still use `snapshot`'s."""
        entries = self.entries(language)
        days = self.snapshot_days(language)
        kept = {e.text for e in keep}
        held = {
            e.text
            for e in entries
            if e.tier != "unreviewed" and waiting(e, days) and e.text not in kept
        }
        common = store.load_settings(self.conn).common_for(language)
        extra = [e.text for e in self.wanikani_entries(language)]
        writing = [e for e in entries if e.text not in held]
        return writing, lexicon_from(entries, language, common, extra, held)

    def wanikani_entries(self, language: Code) -> list[Entry]:
        """Japanese's words learned in WaniKani, as the model's word list shows them; none for
        another language. They aren't deck words, so they're kept out of `snapshot`'s entries."""
        return as_entries(store.load_wanikani(self.conn)) if language == "ja" else []

    async def refresh_lexicon(
        self,
        language: Code | None = None,
        force: bool = False,
        max_age: timedelta = store.SNAPSHOT_MAX_AGE,
    ) -> None:
        language = language or self.language()
        if self.read_deck is not None:
            await store.refresh_if_stale(
                self.conn, self.read_deck, self.clock(), language, force, max_age
            )
        if language == "ja" and self.read_wanikani is not None:
            await store.refresh_wanikani_if_stale(
                self.conn, self.read_wanikani, self.clock(), force
            )

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
            entries = self.entries(language)
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
            # Words due today and not reviewed yet are left out of the list and counted as unknown,
            # so the text doesn't show them before their review (`writing_lexicon`).
            writing, lexicon = self.writing_lexicon(language, keep=request.stretch)
            known = writing + self.wanikani_entries(language)
            extra = {
                "reason": job.reason,
                "story_id": story.id if story else None,
                "episode": context.episode if context else 0,
            }
            try:
                result = await generate(self.ask_for(known, language), lexicon, request)
            except GenerationFailed as e:
                if e.usage != Usage():
                    # The first attempt got an answer but nothing usable (a refusal, a cut-off,
                    # invalid JSON): stored as dropped with no text, never served, so what it
                    # cost is still on record. A call that got no answer cost nothing.
                    empty = Generated("", (), {}, Coverage((), ()), 1, False, (), usage=e.usage)
                    store.save_text(
                        self.conn,
                        topic_id,
                        empty,
                        [],
                        difficulty.floor,
                        self.clock(),
                        "dropped",
                        request.form,
                        language,
                        _grammar_record(request),
                        focus,
                        stretch_count=difficulty.stretch,
                        **extra,  # type: ignore[arg-type]
                    )
                raise
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
                    stretch_count=difficulty.stretch,
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
                stretch_count=difficulty.stretch,
                **extra,  # type: ignore[arg-type]
            )
            if story and context and context.episode == 1:
                store.name_story(self.conn, story.id, result.series, result.cast)
            text = store.get_text(self.conn, text_id)
            assert text is not None
            await self.fill_meanings([text], language)
            await self.fill_forms([text])
            await self.fill_questions(text)
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
        rollover = self.rollover()
        start_of_today = study_day_start(self.clock(), rollover, self.zone)
        practiced = store.practiced_days(self.conn, start_of_today, language, rollover, self.zone)
        chosen = store.load_grammar(self.conn)
        mine = [p.id for p in grammar.points_for(language)]
        practice = tuple(p for p in mine if chosen.get(p) == "practice")
        avoid = tuple(p for p in mine if chosen.get(p) == "avoid")
        review = self.review_points(language)
        unset = exposure.unset_points(chosen, language)

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
                common=settings.common_for(language) if LANGUAGES[language].counts_common else 0,
                practice=practice,
                avoid=avoid,
                review=review,
                unset=unset,
                unset_uses=difficulty.unset_uses,
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
        days = self.snapshot_days(language)
        if any_words:
            # The shelf's "due" text: only words already reviewed today (stretch.py).
            picked = pick_stretch(entries, difficulty.stretch, self.rng, practiced, days, True)
            return request(picked)
        if settings.stretch_words == "any":
            return request(pick_stretch(entries, difficulty.stretch, self.rng, practiced, days))
        choices = pick_stretch(entries, STRETCH_CHOICES, self.rng, practiced, days)
        return request(choices, difficulty.stretch) if choices else request([])

    def snapshot_days(self, language: Code) -> int:
        """How many study days ago the language's snapshot was read (0: today), so what it says is
        due and reviewed is read for the right day (stretch.py)."""
        taken_at = store.load_snapshot(self.conn, language)[1]
        if taken_at is None:
            return 0
        rollover = self.rollover()
        today = study_day(self.clock(), rollover, self.zone)
        return max(0, (today - study_day(taken_at, rollover, self.zone)).days)

    # ==== Word meanings ====

    def deck_meanings(self, language: Code) -> dict[str, str]:
        """The meanings the deck teaches: WaniKani's (Japanese), then the deck's own, which win."""
        entries, _ = self.snapshot(language)
        return {
            **{e.text: e.meaning for e in self.wanikani_entries(language)},
            **{e.text: e.meaning for e in entries},
        }

    def meanings(self, language: Code) -> dict[str, str]:
        """What a word's gloss falls back on after a text's own: the deck's meanings, else the first
        meaning the language kept for the word (meanings.py), for a text with none of its own."""
        return {**store.word_meanings(self.conn, language), **self.deck_meanings(language)}

    async def fill_meanings(self, texts: list[StoredText], language: Code) -> None:
        """Glosses the words in `texts` that have no gloss of the text's own or the deck's, in the
        sense of their line in that text (meanings.py). A failure is logged and waits
        `FAILURE_COOLDOWN`; it never keeps a text from being served."""
        if texts:
            await self._fill_words(
                language,
                lambda lexicon: meanings.missing(
                    # Read again here: a text the pass before this one filled has its meanings now.
                    [t for t in (store.get_text(self.conn, x.id) for x in texts) if t],
                    lexicon,
                    self.deck_meanings(language),
                ),
            )

    async def fill_sentence_meanings(
        self, sentences: list[tuple[str, str]], language: Code
    ) -> None:
        """`fill_meanings` for cards' example sentences, as (sentence, its English), so a word in
        one that nothing glosses has a meaning the next time the card's words are asked for."""
        if sentences:
            await self._fill_words(
                language,
                lambda lexicon: meanings.missing_in_sentences(
                    sentences, lexicon, self.meanings(language)
                ),
            )

    async def _fill_words(self, language: Code, find: Callable[[Checker], list[Wanted]]) -> None:
        if self.write_meanings is None:
            return
        # One pass at a time, so two passes started together don't pay for the same words.
        async with self._meanings_lock:
            failed = self._meanings_failed.get(language)
            if failed is not None and self.clock() - failed < FAILURE_COOLDOWN:
                return
            _, lexicon = self.snapshot(language)
            try:
                await meanings.fill_words(
                    self.conn,
                    self.write_meanings,
                    language,
                    find(lexicon),
                    self.clock,
                )
            except meanings.MeaningsFailed as e:
                log.warning("Couldn't write %s word meanings: %s", language, e)
                self._meanings_failed[language] = self.clock()

    async def fill_questions(self, text: StoredText) -> None:
        """Writes the questions for the check after reading (comprehension.py) and keeps them on the
        text, with what the call cost. A failure is logged and leaves the text without them; it
        never keeps a text from being served."""
        if self.write_questions is None or text.questions:
            return
        _, lexicon = self.snapshot(text.language)
        try:
            raw, used = await self.write_questions(text.language, text.lines)
        except comprehension.QuestionsFailed as e:
            log.warning("Couldn't write questions for %s text %d: %s", text.language, text.id, e)
            if e.usage != Usage():
                store.save_call_cost(
                    self.conn, "questions", text.language, self.clock(), e.usage.cost_usd()
                )
            return
        kept = comprehension.keep(raw, text.lines, lexicon)
        store.save_questions(self.conn, text.id, kept)
        store.save_call_cost(self.conn, "questions", text.language, self.clock(), used.cost_usd())

    async def fill_forms(self, texts: list[StoredText]) -> None:
        """Has Claude pick the grammatical form of the inflected words in `texts` that haven't been
        asked about (forms.py), one call a text, and keeps them on the text with what each cost. A
        failure is logged and waits `FAILURE_COOLDOWN`; it never keeps a text from being served."""
        if self.write_forms is None:
            return
        # One pass at a time, so two passes started together don't pay for the same text.
        async with self._forms_lock:
            for text in texts:
                language = text.language
                if not form_primers.primers(language):
                    continue
                failed = self._forms_failed.get(language)
                if failed is not None and self.clock() - failed < FAILURE_COOLDOWN:
                    continue
                # Read again under the lock: the pass that just finished may have kept it.
                current = store.get_text(self.conn, text.id)
                if current is None or current.forms is not None:
                    continue
                _, lexicon = self.snapshot(language)
                rows = forms.candidates(current, lexicon)
                if not rows:
                    store.save_forms(self.conn, text.id, {})
                    continue
                try:
                    raw, used = await self.write_forms(language, rows)
                except forms.FormsFailed as e:
                    log.warning("Couldn't pick forms for %s text %d: %s", language, text.id, e)
                    if e.usage != Usage():
                        store.save_call_cost(
                            self.conn, "forms", language, self.clock(), e.usage.cost_usd()
                        )
                    self._forms_failed[language] = self.clock()
                    continue
                store.save_forms(self.conn, text.id, forms.keep(language, raw, rows))
                store.save_call_cost(self.conn, "forms", language, self.clock(), used.cost_usd())

    # ==== Grammar ====

    def grammar_exposure(self, language: Code | None = None) -> dict[str, exposure.Exposure]:
        language = language or self.language()
        return exposure.exposure(
            self.conn, self.snapshot(language)[1], language, self.grammar_cache
        )

    def review_points(self, language: Code | None = None) -> tuple[str, ...]:
        """The known grammar points the next text is asked to work in (exposure.py)."""
        language = language or self.language()
        return exposure.review_points(
            store.load_grammar(self.conn),
            self.grammar_exposure(language),
            store.grammar_offered(self.conn, language),
            language,
        )

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
        # One run per language: a newer voice change supersedes an older run, which stops at its
        # next text, so choosing voices in a row doesn't pile up requests on Azure's rate limit.
        gen = self._rerecord_gen[language] = self._rerecord_gen.get(language, 0) + 1
        async with self._rerecord_locks.setdefault(language, asyncio.Lock()):
            if self._rerecord_gen[language] != gen:
                return
            for text in store.ready_texts(self.conn, language):
                if self._rerecord_gen[language] != gen:
                    return
                self.audio.drop(text.id)
                await self.make_audio(text)

    async def time_waiting_texts(self) -> None:
        """Once: re-records the texts waiting to be read whose audio was made before word timings
        (tts.py), so they light up as they're spoken too; a text already read keeps its audio. The
        flag is set when a pass finishes, so one cut short by a restart picks up where it left off
        (a text it re-recorded has its timings and is skipped), and a pass where Azure gave no
        timings (the SDK unusable here) still ends it, rather than re-recording every time."""
        if self.audio is None or self.synthesize is None or store.waiting_texts_timed(self.conn):
            return
        audio = self.audio
        for language in LANGUAGES:
            async with self._rerecord_locks.setdefault(language, asyncio.Lock()):
                for text in store.ready_texts(self.conn, language):
                    lines = range(len(text.lines))
                    if any(
                        audio.has(text.id, i) and not audio.has_marks(text.id, i) for i in lines
                    ):
                        audio.drop(text.id)
                        await self.make_audio(text)
        store.mark_waiting_texts_timed(self.conn)

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
            # The text's language goes too, for a Multilingual voice, which would otherwise guess it.
            recorded = await self.synthesize(spoken, voice, LANGUAGES[text.language].locale)
        except TtsFailed as e:
            log.warning("No audio for text %d line %d: %s", text.id, line, e)
            return None
        # Only a recording Azure made is counted (a cached line never gets here), and a failed one
        # isn't billed, so this is what the audio cost.
        store.add_audio_chars(self.conn, text.id, billed_chars(spoken))
        self.audio.write(text.id, line, recorded)
        return self.audio.path(text.id, line)

    def count_existing_audio(self) -> None:
        """Once: estimates what the audio recorded before characters were counted cost, as the
        characters of every line that has audio on the volume. It leaves out lines recorded and
        replaced since, so those texts read a little low."""
        if self.audio is None:
            return
        texts = store.texts_missing_audio_chars(self.conn)
        if texts is None:
            return
        for text in texts:
            spaced = LANGUAGES[text.language].spaced
            chars = sum(
                billed_chars(parse_line(ln.text, spaced)[0])
                for i, ln in enumerate(text.lines)
                if self.audio.has(text.id, i)
            )
            if chars:
                store.add_audio_chars(self.conn, text.id, chars)
        store.mark_audio_chars_counted(self.conn)

    # ==== Top-up and readings ====

    async def top_up(self) -> None:
        """Refreshes the current language's lexicon if it's a day old and writes the story's next
        episode if it has none waiting. Nothing else is written unasked: the shelf holds only
        texts the owner asked for. Only the current language, so having several doesn't multiply
        the spending. Runs after a response is sent; a second call while one is running does
        nothing. The first pass also re-records the texts waiting to be read with word timings
        (`time_waiting_texts`). A missing key or word list stops it quietly."""
        if self._topping_up.locked():
            return
        async with self._topping_up:
            await self.time_waiting_texts()
            language = self.language()
            await self.refresh_lexicon(language)
            # Texts written before their common words were glossed, newest first, a batch a pass.
            recent = store.recent_texts(self.conn, language, BACKFILL_TEXTS)
            await self.fill_meanings(recent, language)
            # Texts written before word forms were picked, newest first, a few a pass.
            await self.fill_forms([t for t in recent if t.forms is None][:BACKFILL_FORMS])
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

    def _idle(self, job: Job) -> bool:
        return job.key not in self._writing and not self._cooling_down(job.key)

    def _episode_waiting(self, story: Story) -> bool:
        return store.waiting_episode(self.conn, story.id, pending=True) is not None

    def writing(self, language: Code) -> list[Job]:
        """The shelf texts and story episodes being written in a language now."""
        return [j for j in self._jobs.values() if j.language == language and not j.focus]

    # ==== Asked for ====

    def write_about(self, name: str, form: Form) -> Topic:
        """Starts writing a text on a topic typed in (it joins the shelf when it's ready).
        Raises ValueError for an empty name, NotAvailable when nothing can be
        written yet."""
        language = self.language()
        self._check_setup(language)
        topic = store.add_topic(self.conn, name, self.clock())
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
        chosen = ""
        if told and told[-1].chosen is not None and told[-1].chosen < len(told[-1].choices):
            chosen = told[-1].choices[told[-1].chosen].english
        return StoryContext(
            episode=max((t.episode for t in told), default=0) + 1,
            about=story.about,
            title=story.title,
            cast=story.cast,
            recaps=tuple(t.recap for t in told if t.recap),
            chosen=chosen,
        )

    def record_reading(self, text_id: int, reading: Reading) -> None:
        """Logs a session and adjusts the difficulty of the text's language, stepping from the level
        the text was written at (difficulty.after_reading). A second reading of a text that's
        already been read is ignored, so a retried request can't log twice or move difficulty
        twice."""
        status = store.text_status(self.conn, text_id)
        if status is None:
            raise NotFound(text_id)
        if status == "read":
            return
        store.log_reading(self.conn, text_id, reading, self.clock())
        text = store.get_text(self.conn, text_id)
        written = store.written_at(self.conn, text_id)
        if text is not None and written is not None:
            current = store.load_difficulty(self.conn, text.language)
            floor, stretch = written
            after = after_reading(
                current,
                replace(
                    current, floor=floor, stretch=current.stretch if stretch is None else stretch
                ),
                reading.rating,
                reading.check_right,
                reading.check_asked,
            )
            if after != current:
                store.save_difficulty(self.conn, after, text.language)
