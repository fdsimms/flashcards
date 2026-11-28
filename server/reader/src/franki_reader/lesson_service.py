"""Makes an audio lesson from start to finish (lesson.py): Claude writes the content, the code builds
the script, Azure speaks it, and the MP3 is kept on the volume. Run in the background for a lesson
asked for by a scene, so a request never waits on it; the lesson's row says how it went.

Only the dialogue is checked against the deck's known words (the lexicon passed in); nothing here
grades a card or writes a note.
"""

import logging
import os
import sqlite3
from collections.abc import Awaitable, Callable
from dataclasses import replace
from datetime import datetime
from pathlib import Path

from franki_speech import is_voice_name

from franki_reader import lesson, lesson_audio, lesson_writer, store
from franki_reader.coverage import Checker
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lesson_audio import LessonAudioFailed, Rendered, Speak
from franki_reader.lesson_writer import LessonFailed, WriteGiven, WritePlan
from franki_reader.register import DEFAULT, Register
from franki_reader.tts import TtsFailed, billed_chars

log = logging.getLogger(__name__)

# The languages a lesson can be made in. French first, as an experiment, then Thai and the other
# languages written with spaces between words, which need only their voices, then Japanese
# (`lesson.tokens` cuts it with Sudachi). Not English: the narrator speaks it.
LESSON_LANGUAGES: tuple[Code, ...] = ("fr", "th", "es", "de", "ru", "el", "pl", "nb", "ja")

# What a voice in a lesson is, for each language: the narrator is an English voice, and the native
# voices are the language's male and female ones (Engine.voices_for).
Voices = Callable[[Code], dict[str, str]]
# Speaks text in a voice and a locale at a rate (1.0 is normal speed), as an MP3 (Engine.synthesize,
# without the word timings).
Synthesize = Callable[[str, str, str, float], Awaitable[bytes]]
Renderer = Callable[..., Awaitable[Rendered]]


def is_narrator_voice(voice: str) -> bool:
    """Whether `voice` is an English Azure voice by its name (en-US-GuyNeural), which is as far as
    it can be checked here: Azure refuses a name it doesn't know, and the lesson fails with that.
    The name check is `franki_speech`'s, so a voice form it learns (a Dragon HD colon) reaches here."""
    return voice.startswith("en-") and is_voice_name(voice)


def audio_path(lessons_dir: Path, lesson_id: int) -> Path:
    """`<lessons dir>/<id>.mp3`. The folder is beside the texts' audio, whose folders are numbers."""
    return lessons_dir / f"{lesson_id}.mp3"


def speaker(
    language: Code, voices: Voices, synthesize: Synthesize, narrator: str | None = None
) -> Speak:
    """Speaks a clip: the narrator in English (`narrator`, an English voice chosen for the lesson, or
    the English male voice from the settings), a native voice in the language's locale."""
    native, narrator_voice = voices(language), narrator or voices("en")["male"]
    locale, narrator_locale = LANGUAGES[language].locale, LANGUAGES["en"].locale

    async def speak(clip: lesson.Say) -> bytes:
        if clip.recording:
            # A text's line as it was recorded for the text (Lines from your reading).
            try:
                return Path(clip.recording).read_bytes()
            except OSError as e:
                raise TtsFailed(f"A line's recording is missing ({e.strerror or e}).") from e
        if clip.voice == "narrator":
            return await synthesize(clip.text, narrator_voice, narrator_locale, 1.0)
        rate = lesson.TEACH_RATE if clip.slow else 1.0
        return await synthesize(clip.text, native[clip.voice], locale, rate)

    return speak


async def make_lesson(
    conn: sqlite3.Connection,
    lesson_id: int,
    language: Code,
    scene: str,
    *,
    write: WritePlan,
    synthesize: Synthesize,
    voices: Voices,
    lessons_dir: Path,
    now: Callable[[], datetime],
    narrator: str | None = None,
    learner: lesson.Learner = "male",
    register: Register = DEFAULT,
    renderer: Renderer = lesson_audio.render,
    lexicon: Checker | None = None,
    given: tuple[lesson.Phrase, ...] = (),
    write_given: WriteGiven | None = None,
) -> None:
    """Writes, speaks and keeps lesson `lesson_id`, and says in its row how it went. Never raises:
    a failure is the lesson's `error`, shown as it is. With `given` (the learner's own words and
    phrases, a cram's) and `write_given`, the lesson teaches those rather than phrases Claude picks."""
    try:
        if given and write_given is not None:
            plan, used = await lesson_writer.write_given_plan(
                write_given, language, scene, given, learner, lexicon, register
            )
        else:
            plan, used = await lesson_writer.write_plan(
                write, language, scene, learner, lexicon, register
            )
    except LessonFailed as e:
        _keep_cost(conn, language, e.usage.cost_usd(), 0, now)
        store.fail_lesson(conn, lesson_id, str(e))
        return
    # Phrases of lessons played to the end come back at the start (lesson.earlier_phrases).
    plan = replace(
        plan,
        earlier=lesson.earlier_phrases(
            store.heard_lesson_phrases(conn, language, lesson_id), {p.text for p in plan.phrases}
        ),
    )
    await _speak_and_keep(
        conn,
        lesson_id,
        language,
        plan,
        lesson.build_script(plan, learner),
        synthesize=synthesize,
        voices=voices,
        lessons_dir=lessons_dir,
        now=now,
        narrator=narrator,
        renderer=renderer,
        claude_usd=used.cost_usd(),
    )


async def _speak_and_keep(
    conn: sqlite3.Connection,
    lesson_id: int,
    language: Code,
    plan: lesson.Plan,
    steps: list[lesson.Step],
    *,
    synthesize: Synthesize,
    voices: Voices,
    lessons_dir: Path,
    now: Callable[[], datetime],
    narrator: str | None,
    renderer: Renderer,
    claude_usd: float,
) -> bool:
    """Speaks a lesson's script, keeps its MP3 and finishes its row (with its pauses and script), or
    fails the row with the reason. Whether it was kept."""
    chars = 0
    store.set_lesson_stage(conn, lesson_id, "recording")
    try:
        rendered = await renderer(
            steps,
            speaker(language, voices, synthesize, narrator),
            on_joining=lambda: store.set_lesson_stage(conn, lesson_id, "joining"),
        )
        # Azure billed each distinct clip once, though not if it failed part way.
        chars = sum(billed_chars(c.text) for c in lesson.clips(steps) if not c.recording)
        path = audio_path(lessons_dir, lesson_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        tmp.write_bytes(rendered.audio)
        os.replace(tmp, path)
    except (LessonAudioFailed, TtsFailed) as e:
        _keep_cost(conn, language, claude_usd, 0, now)
        store.fail_lesson(conn, lesson_id, _spoken_error(e))
        return False
    except OSError as e:
        log.exception("Couldn't keep lesson %s", lesson_id)
        _keep_cost(conn, language, claude_usd, chars, now)
        store.fail_lesson(conn, lesson_id, f"Couldn't save the lesson ({e.strerror or e}).")
        return False
    _keep_cost(conn, language, claude_usd, chars, now)
    store.finish_lesson(
        conn,
        lesson_id,
        plan.title,
        lesson.describe(plan),
        rendered.duration_ms,
        rendered.pauses,
        lesson.script_of(plan, list(rendered.placed)),
    )
    return True


async def make_review(
    conn: sqlite3.Connection,
    lesson_id: int,
    language: Code,
    phrases: tuple[lesson.Phrase, ...],
    *,
    synthesize: Synthesize,
    voices: Voices,
    lessons_dir: Path,
    now: Callable[[], datetime],
    narrator: str | None = None,
    learner: lesson.Learner = "male",
    renderer: Renderer = lesson_audio.render,
) -> None:
    """Speaks and keeps review lesson `lesson_id`: `phrases` from earlier lessons, asked again
    (lesson.build_review). No Claude call: the phrases and their meanings are the lessons' own. If
    it can't be made, its phrases are let go, to be offered in the next review."""
    plan = lesson.review_plan(phrases)
    kept = await _speak_and_keep(
        conn,
        lesson_id,
        language,
        plan,
        lesson.build_review(plan, learner),
        synthesize=synthesize,
        voices=voices,
        lessons_dir=lessons_dir,
        now=now,
        narrator=narrator,
        renderer=renderer,
        claude_usd=0.0,
    )
    if not kept:
        store.release_lesson_marks(conn, lesson_id)


async def make_lines(
    conn: sqlite3.Connection,
    lesson_id: int,
    language: Code,
    phrases: tuple[lesson.Phrase, ...],
    recordings: tuple[str, ...],
    *,
    slow: bool = False,
    synthesize: Synthesize,
    voices: Voices,
    lessons_dir: Path,
    now: Callable[[], datetime],
    narrator: str | None = None,
    learner: lesson.Learner = "male",
    renderer: Renderer = lesson_audio.render,
) -> None:
    """Speaks and keeps lesson `lesson_id`, Lines from your reading (line_drill.py): `phrases` from
    texts already read, each answered by its own recording (`recordings`, the slow ones when `slow`).
    No Claude call, and only the narrator's English is recorded new."""
    plan = lesson.lines_plan(phrases, slow)
    await _speak_and_keep(
        conn,
        lesson_id,
        language,
        plan,
        lesson.build_lines(plan, recordings, learner),
        synthesize=synthesize,
        voices=voices,
        lessons_dir=lessons_dir,
        now=now,
        narrator=narrator,
        renderer=renderer,
        claude_usd=0.0,
    )


async def make_words(
    conn: sqlite3.Connection,
    lesson_id: int,
    language: Code,
    phrases: tuple[lesson.Phrase, ...],
    examples: tuple[lesson.Example | None, ...],
    *,
    meaning_first: bool = False,
    synthesize: Synthesize,
    voices: Voices,
    lessons_dir: Path,
    now: Callable[[], datetime],
    narrator: str | None = None,
    learner: lesson.Learner = "male",
    renderer: Renderer = lesson_audio.render,
) -> None:
    """Speaks and keeps lesson `lesson_id`, Your words (lesson.build_words): words the app picked
    from the deck, with their meanings and examples. No Claude call; never grades a card."""
    plan = lesson.words_plan(phrases)
    await _speak_and_keep(
        conn,
        lesson_id,
        language,
        plan,
        lesson.build_words(plan, examples, meaning_first, learner),
        synthesize=synthesize,
        voices=voices,
        lessons_dir=lessons_dir,
        now=now,
        narrator=narrator,
        renderer=renderer,
        claude_usd=0.0,
    )


async def find_old_pauses(
    conn: sqlite3.Connection,
    lesson_id: int,
    lessons_dir: Path,
    find: Callable[[bytes], Awaitable[tuple[lesson_audio.Pause, ...]]] = lesson_audio.find_pauses,
) -> None:
    """Listens for the answer silences of a lesson made before they were kept, and keeps them, so
    it can wait for the learner too. Never raises: a lesson whose audio can't be read is left as it
    was, playing straight through, and is tried again the next time the list is read."""
    try:
        found = await find(audio_path(lessons_dir, lesson_id).read_bytes())
    except (OSError, LessonAudioFailed) as e:
        log.warning("Couldn't find the pauses in lesson %s: %s", lesson_id, e)
        return
    store.set_lesson_pauses(conn, lesson_id, found)


def _spoken_error(e: Exception) -> str:
    if isinstance(e, TtsFailed):
        # Azure's own sentence says what to do (wait, or choose another voice), so none is added here.
        reason = str(e).strip()
        return f"Azure couldn't speak the lesson. {reason}{'' if reason[-1:] in '.!?' else '.'}"
    return str(e)


def _keep_cost(
    conn: sqlite3.Connection,
    language: Code,
    cost_usd: float,
    chars: int,
    now: Callable[[], datetime],
) -> None:
    if cost_usd or chars:
        store.save_call_cost(conn, "lessons", language, now(), cost_usd, chars)
