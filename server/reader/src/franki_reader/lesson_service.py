"""Makes an audio lesson from start to finish (lesson.py): Claude writes the content, the code builds
the script, Azure speaks it, and the MP3 is kept on the volume. Run in the background for a lesson
asked for by a scene, so a request never waits on it; the lesson's row says how it went.

Nothing here reads the deck, grades a card or writes a note.
"""

import logging
import os
import re
import sqlite3
from collections.abc import Awaitable, Callable
from datetime import datetime
from pathlib import Path

from franki_reader import lesson, lesson_audio, lesson_writer, store
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lesson_audio import LessonAudioFailed, Rendered, Speak
from franki_reader.lesson_writer import LessonFailed, WritePlan
from franki_reader.tts import TtsFailed, billed_chars

log = logging.getLogger(__name__)

# The languages a lesson can be made in. French first, as an experiment; a language written with
# spaces between words needs only its voices to join it.
LESSON_LANGUAGES: tuple[Code, ...] = ("fr",)

# What a voice in a lesson is, for each language: the narrator is an English voice, and the native
# voices are the language's male and female ones (Engine.voices_for).
Voices = Callable[[Code], dict[str, str]]
# Speaks text in a voice and a locale, as an MP3 (Engine.synthesize, without the word timings).
Synthesize = Callable[[str, str, str], Awaitable[bytes]]
Renderer = Callable[[list[lesson.Step], Speak], Awaitable[Rendered]]


_NARRATOR = re.compile(r"en-[A-Za-z]{2,4}-[A-Za-z0-9]+")


def is_narrator_voice(voice: str) -> bool:
    """Whether `voice` is an English Azure voice by its name (en-US-GuyNeural), which is as far as
    it can be checked here: Azure refuses a name it doesn't know, and the lesson fails with that."""
    return _NARRATOR.fullmatch(voice) is not None


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
        if clip.voice == "narrator":
            return await synthesize(clip.text, narrator_voice, narrator_locale)
        return await synthesize(clip.text, native[clip.voice], locale)

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
    renderer: Renderer = lesson_audio.render,
) -> None:
    """Writes, speaks and keeps lesson `lesson_id`, and says in its row how it went. Never raises:
    a failure is the lesson's `error`, shown as it is."""
    try:
        plan, used = await lesson_writer.write_plan(write, language, scene)
    except LessonFailed as e:
        _keep_cost(conn, language, e.usage.cost_usd(), 0, now)
        store.fail_lesson(conn, lesson_id, str(e))
        return
    steps = lesson.build_script(plan)
    chars = 0
    try:
        rendered = await renderer(steps, speaker(language, voices, synthesize, narrator))
        # Azure billed each distinct clip once, though not if it failed part way.
        chars = sum(billed_chars(c.text) for c in lesson.clips(steps))
        path = audio_path(lessons_dir, lesson_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        tmp.write_bytes(rendered.audio)
        os.replace(tmp, path)
    except (LessonAudioFailed, TtsFailed) as e:
        _keep_cost(conn, language, used.cost_usd(), 0, now)
        store.fail_lesson(conn, lesson_id, _spoken_error(e))
        return
    except OSError as e:
        log.exception("Couldn't keep lesson %s", lesson_id)
        _keep_cost(conn, language, used.cost_usd(), chars, now)
        store.fail_lesson(conn, lesson_id, f"Couldn't save the lesson ({e.strerror or e}).")
        return
    _keep_cost(conn, language, used.cost_usd(), chars, now)
    store.finish_lesson(conn, lesson_id, plan.title, lesson.describe(plan), rendered.duration_ms)


def _spoken_error(e: Exception) -> str:
    if isinstance(e, TtsFailed):
        return f"Azure couldn't speak the lesson ({e}). Try again in a moment."
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
