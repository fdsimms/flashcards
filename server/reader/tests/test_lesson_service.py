import asyncio
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

from franki_reader import lesson, lesson_service, lesson_writer, store
from franki_reader.generator import Usage
from franki_reader.lesson import Step
from franki_reader.lesson_audio import LessonAudioFailed, Rendered, Speak
from franki_reader.lesson_writer import LessonFailed
from franki_reader.tts import TtsFailed

NOW = datetime(2026, 11, 15, 12, 0)
USAGE = Usage(input_tokens=1000, output_tokens=500, model="claude-sonnet-5-5")


def good_plan() -> dict[str, Any]:
    def phrase(text: str, english: str, *parts: str) -> dict[str, Any]:
        return {"text": text, "english": english, "parts": list(parts or [text])}

    return {
        "title": "At the café",
        "dialogue": [
            {
                "speaker": "A",
                "text": "Bonjour, vous désirez ?",
                "english": "Hello, what would you like?",
            },
            {"speaker": "B", "text": "Un café, s'il vous plaît.", "english": "A coffee, please."},
        ],
        "phrases": [
            phrase("Un café.", "A coffee."),
            phrase("S'il vous plaît.", "Please."),
            phrase(
                "L'addition, s'il vous plaît.",
                "The check, please.",
                "L'addition",
                "s'il vous plaît",
            ),
        ],
    }


VOICES = {
    "fr": {"male": "fr-FR-HenriNeural", "female": "fr-FR-DeniseNeural"},
    "en": {"male": "en-US-GuyNeural", "female": "en-US-JennyNeural"},
}


def voices(language: str) -> dict[str, str]:
    return VOICES[language]


class Fakes:
    def __init__(self) -> None:
        self.asked: list[tuple[str, str]] = []
        self.spoken: list[tuple[str, str, str]] = []

    async def write(self, language: str, scene: str, feedback: str) -> tuple[Any, Usage]:
        self.asked.append((scene, feedback))
        return good_plan(), USAGE

    async def synthesize(self, text: str, voice: str, locale: str) -> bytes:
        self.spoken.append((text, voice, locale))
        return text.encode()

    async def renderer(self, steps: list[Step], speak: Speak) -> Rendered:
        for clip in lesson.clips(steps):
            await speak(clip)
        return Rendered(b"MP3DATA", 123_000)


def run(conn: Any, fakes: Fakes, tmp_path: Path, **over: Any) -> int:
    lesson_id = store.add_lesson(conn, "fr", "ordering a coffee", NOW)
    args: dict[str, Any] = {
        "write": fakes.write,
        "synthesize": fakes.synthesize,
        "voices": voices,
        "lessons_dir": tmp_path,
        "now": lambda: NOW,
        "renderer": fakes.renderer,
    }
    args.update(over)
    asyncio.run(lesson_service.make_lesson(conn, lesson_id, "fr", "ordering a coffee", **args))
    return lesson_id


def test_makes_a_lesson_and_keeps_it(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    fakes = Fakes()
    lesson_id = run(conn, fakes, tmp_path)
    kept = store.get_lesson(conn, lesson_id)
    assert kept is not None
    assert (kept.state, kept.title, kept.error, kept.duration_ms) == (
        "ready",
        "At the café",
        "",
        123_000,
    )
    assert [p["english"] for p in kept.plan["phrases"]] == [
        "A coffee.",
        "Please.",
        "The check, please.",
    ]
    assert lesson_service.audio_path(tmp_path, lesson_id).read_bytes() == b"MP3DATA"
    assert not lesson_service.audio_path(tmp_path, lesson_id).with_suffix(".part").exists()


def test_speaks_the_narrator_in_english_and_the_rest_in_the_language(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    fakes = Fakes()
    run(conn, fakes, tmp_path)
    by_text = {text: (voice, locale) for text, voice, locale in fakes.spoken}
    assert by_text["Listen."] == ("en-US-GuyNeural", "en-US")
    assert by_text["Un café."] == ("fr-FR-HenriNeural", "fr-FR")
    assert by_text["Un café, s'il vous plaît."] == ("fr-FR-DeniseNeural", "fr-FR")  # B, the woman


def test_records_what_claude_and_azure_charged(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    run(conn, Fakes(), tmp_path)
    spending, chars = store.lesson_spending(conn, datetime(2026, 11, 1))
    assert spending["fr"][0] == 1
    assert spending["fr"][1] == pytest.approx(USAGE.cost_usd())
    assert chars > 0


def test_a_lesson_claude_cannot_write_fails_with_its_reason(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    fakes = Fakes()

    async def write(language: str, scene: str, feedback: str) -> tuple[Any, Usage]:
        raise LessonFailed("Claude didn't answer. Try again in a moment.", USAGE)

    lesson_id = run(conn, fakes, tmp_path, write=write)
    kept = store.get_lesson(conn, lesson_id)
    assert kept is not None
    assert (kept.state, kept.error) == ("failed", "Claude didn't answer. Try again in a moment.")
    assert not lesson_service.audio_path(tmp_path, lesson_id).exists()
    # Claude answered, so the failed call is still paid for.
    assert store.lesson_spending(conn, datetime(2026, 11, 1))[0]["fr"][0] == 1


def test_a_failure_to_speak_fails_the_lesson_and_keeps_no_file(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    fakes = Fakes()

    async def renderer(steps: list[Step], speak: Speak) -> Rendered:
        raise TtsFailed("Azure answered 429")

    lesson_id = run(conn, fakes, tmp_path, renderer=renderer)
    kept = store.get_lesson(conn, lesson_id)
    assert kept is not None
    assert kept.state == "failed"
    assert "Azure couldn't speak the lesson (Azure answered 429)" in kept.error
    assert not lesson_service.audio_path(tmp_path, lesson_id).exists()


def test_a_failure_in_ffmpeg_says_so(tmp_path: Path) -> None:
    conn = store.connect(":memory:")

    async def renderer(steps: list[Step], speak: Speak) -> Rendered:
        raise LessonAudioFailed("ffmpeg isn't installed on the server, so a lesson can't be made.")

    lesson_id = run(conn, Fakes(), tmp_path, renderer=renderer)
    kept = store.get_lesson(conn, lesson_id)
    assert kept is not None
    assert kept.error == "ffmpeg isn't installed on the server, so a lesson can't be made."


def test_asks_claude_again_once_when_the_first_plan_is_unusable(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    fakes = Fakes()
    answers = [{"title": "x", "dialogue": [], "phrases": []}, good_plan()]

    async def write(language: str, scene: str, feedback: str) -> tuple[Any, Usage]:
        fakes.asked.append((scene, feedback))
        return answers.pop(0), USAGE

    lesson_id = run(conn, fakes, tmp_path, write=write)
    kept = store.get_lesson(conn, lesson_id)
    assert kept is not None and kept.state == "ready"
    assert fakes.asked[0][1] == ""
    assert "fewer than 3 usable phrases" in fakes.asked[1][1]
    # Both calls were paid for.
    assert store.lesson_spending(conn, datetime(2026, 11, 1))[0]["fr"][1] == pytest.approx(
        2 * USAGE.cost_usd()
    )


def test_gives_up_after_two_unusable_plans(tmp_path: Path) -> None:
    conn = store.connect(":memory:")

    async def write(language: str, scene: str, feedback: str) -> tuple[Any, Usage]:
        return {"title": "x", "dialogue": [], "phrases": []}, USAGE

    lesson_id = run(conn, Fakes(), tmp_path, write=write)
    kept = store.get_lesson(conn, lesson_id)
    assert kept is not None
    assert (kept.state, kept.error) == ("failed", "Claude didn't write a usable lesson. Try again.")


def test_the_request_names_the_language_and_scene() -> None:
    message = lesson_writer.request_message("fr", "ordering a coffee")
    assert "French" in message and "ordering a coffee" in message


def test_only_french_for_now() -> None:
    assert lesson_service.LESSON_LANGUAGES == ("fr",)


class TestStore:
    def test_lessons_are_listed_newest_first_by_language(self) -> None:
        conn = store.connect(":memory:")
        a = store.add_lesson(conn, "fr", "one", NOW)
        b = store.add_lesson(conn, "fr", "two", NOW)
        store.add_lesson(conn, "es", "three", NOW)
        assert [x.id for x in store.lessons(conn, "fr")] == [b, a]
        assert len(store.lessons(conn)) == 3

    def test_a_new_lesson_is_making(self) -> None:
        conn = store.connect(":memory:")
        lesson_id = store.add_lesson(conn, "fr", "one", NOW)
        kept = store.get_lesson(conn, lesson_id)
        assert kept is not None and kept.state == "making" and kept.plan == {}

    def test_one_cut_off_by_a_restart_is_failed(self) -> None:
        conn = store.connect(":memory:")
        lesson_id = store.add_lesson(conn, "fr", "one", NOW)
        store.fail_interrupted_lessons(conn)
        kept = store.get_lesson(conn, lesson_id)
        assert kept is not None and (kept.state, kept.error) == ("failed", store.INTERRUPTED)

    def test_deleting_says_whether_there_was_one(self) -> None:
        conn = store.connect(":memory:")
        lesson_id = store.add_lesson(conn, "fr", "one", NOW)
        assert store.delete_lesson(conn, lesson_id) is True
        assert store.delete_lesson(conn, lesson_id) is False
        assert store.get_lesson(conn, lesson_id) is None
