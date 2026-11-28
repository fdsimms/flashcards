import asyncio
import json
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

from franki_reader import lesson, lesson_service, lesson_writer, store
from franki_reader.generator import Usage
from franki_reader.lesson import Step
from franki_reader.lesson_audio import LessonAudioFailed, Rendered, Speak
from franki_reader.lesson_writer import LessonFailed
from franki_reader.lexicon import Entry, lexicon_from
from franki_reader.tts import TtsFailed

NOW = datetime(2026, 11, 15, 12, 0)
USAGE = Usage(input_tokens=1000, output_tokens=500, model="claude-sonnet-5-5")


def good_plan() -> dict[str, Any]:
    def phrase(text: str, english: str, *parts: str) -> dict[str, Any]:
        return {"text": text, "english": english, "parts": list(parts or [text])}

    return {
        "title": "Getting a coffee",
        "dialogue": [
            {
                "speaker": "A",
                "text": "Bonjour, vous désirez ?",
                "english": "Hello, what would you like?",
            },
            {"speaker": "B", "text": "Un café, s'il vous plaît.", "english": "A coffee, please."},
            {"speaker": "A", "text": "S'il vous plaît.", "english": "Please."},
            {
                "speaker": "A",
                "text": "L'addition, s'il vous plaît.",
                "english": "The check, please.",
            },
            {"speaker": "A", "text": "Merci, au revoir.", "english": "Thank you, goodbye."},
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
            phrase("Merci, au revoir.", "Thank you, goodbye.", "Merci", "au revoir"),
        ],
        "mixes": [],
        "roleplay": [
            {
                "speaker": "B",
                "text": "Bonjour, vous désirez ?",
                "english": "Hello, what would you like?",
            },
            {"speaker": "A", "text": "Un café, merci.", "english": "A coffee, thank you."},
            {"speaker": "B", "text": "Voilà.", "english": "Here you go."},
            {"speaker": "A", "text": "L'addition, merci.", "english": "The check, thank you."},
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
        self.rates: list[float] = []

    async def write(
        self,
        language: str,
        scene: str,
        feedback: str,
        learner: str = "male",
        register: str = "everyday",
    ) -> tuple[Any, Usage]:
        self.asked.append((scene, feedback))
        return good_plan(), USAGE

    async def synthesize(self, text: str, voice: str, locale: str, rate: float = 1.0) -> bytes:
        self.spoken.append((text, voice, locale))
        self.rates.append(rate)
        return text.encode()

    async def renderer(
        self, steps: list[Step], speak: Speak, on_joining: Callable[[], None] | None = None
    ) -> Rendered:
        for clip in lesson.clips(steps):
            await speak(clip)
        if on_joining is not None:
            on_joining()
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


def test_a_lesson_opens_with_a_phrase_of_a_lesson_played_to_the_end(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    first = run(conn, Fakes(), tmp_path)
    # Made but never played: nothing of it is asked for.
    fakes = Fakes()
    run(conn, fakes, tmp_path)
    assert "First, some phrases from earlier lessons." not in [t for t, _, _ in fakes.spoken]
    with conn:
        conn.execute(
            "UPDATE lessons SET plan = ? WHERE id = ?",
            ('{"phrases": [{"text": "Merci.", "english": "Thank you."}]}', first),
        )
    assert store.mark_lesson_heard(conn, first, NOW)
    assert not store.mark_lesson_heard(conn, 999, NOW)
    fakes = Fakes()
    run(conn, fakes, tmp_path)
    spoken = [t for t, _, _ in fakes.spoken]
    assert spoken[:3] == [
        "First, some phrases from earlier lessons.",
        "How do you say: Thank you.",
        "Merci.",
    ]
    assert store.heard_lesson_phrases(conn, "fr", 0) == [[("Merci.", "Thank you.")]]
    assert store.heard_lesson_phrases(conn, "th", 0) == []


def test_makes_a_lesson_and_keeps_it(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    fakes = Fakes()
    lesson_id = run(conn, fakes, tmp_path)
    kept = store.get_lesson(conn, lesson_id)
    assert kept is not None
    assert (kept.state, kept.title, kept.error, kept.duration_ms) == (
        "ready",
        "Getting a coffee",
        "",
        123_000,
    )
    assert [p["english"] for p in kept.plan["phrases"]] == [
        "A coffee.",
        "Please.",
        "The check, please.",
        "Thank you, goodbye.",
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


def test_teaching_clips_are_spoken_slower_and_the_rest_at_normal_speed(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    fakes = Fakes()
    run(conn, fakes, tmp_path)
    rates = list(zip((t for t, _, _ in fakes.spoken), fakes.rates, strict=True))
    assert any(rate == lesson.TEACH_RATE for _, rate in rates)
    assert all(
        rate == 1.0 for text, rate in rates if text in ("Listen.", "That's the end of the lesson.")
    )
    assert {rate for _, rate in rates} == {1.0, lesson.TEACH_RATE}


def test_a_narrator_chosen_for_the_lesson_speaks_only_the_narration(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    fakes = Fakes()
    run(conn, fakes, tmp_path, narrator="en-GB-RyanNeural")
    by_text = {text: (voice, locale) for text, voice, locale in fakes.spoken}
    assert by_text["Listen."] == ("en-GB-RyanNeural", "en-US")
    assert by_text["Un café."] == ("fr-FR-HenriNeural", "fr-FR")


# The same names the app's parseNarrator is tested with (tests/reader/lessons.test.ts).
_VOICES = json.loads(
    (Path(__file__).parents[2] / "speech" / "tests" / "voice-names.json").read_text()
)


@pytest.mark.parametrize(
    ("voice", "english"),
    [(v, True) for v in _VOICES["narrators"]]
    + [(v, False) for v in _VOICES["other_voices"] + _VOICES["not_voices"]],
)
def test_only_an_english_voice_can_narrate(voice: str, english: bool) -> None:
    assert lesson_service.is_narrator_voice(voice) is english


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

    async def write(
        language: str, scene: str, feedback: str, learner: str = "male", register: str = "everyday"
    ) -> tuple[Any, Usage]:
        raise LessonFailed("Claude didn't answer. Try again in a moment.", USAGE)

    lesson_id = run(conn, fakes, tmp_path, write=write)
    kept = store.get_lesson(conn, lesson_id)
    assert kept is not None
    assert (kept.state, kept.error) == ("failed", "Claude didn't answer. Try again in a moment.")
    assert not lesson_service.audio_path(tmp_path, lesson_id).exists()
    # Claude answered, so the failed call is still paid for.
    assert store.lesson_spending(conn, datetime(2026, 11, 1))[0]["fr"][0] == 1


def test_the_stage_follows_the_lesson_from_writing_to_joining(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    seen: list[str] = []

    async def write(
        language: str, scene: str, feedback: str, learner: str = "male", register: str = "everyday"
    ) -> tuple[Any, Usage]:
        seen.append(_stage(conn))
        return good_plan(), USAGE

    fakes = Fakes()

    async def renderer(steps: list[Step], speak: Speak, on_joining: Any = None) -> Rendered:
        seen.append(_stage(conn))

        def joining() -> None:
            on_joining()
            seen.append(_stage(conn))

        return await fakes.renderer(steps, speak, joining)

    run(conn, fakes, tmp_path, write=write, renderer=renderer)
    assert seen == ["writing", "recording", "joining"]


def _stage(conn: Any) -> str:
    return store.lessons(conn)[0].stage


def test_a_stage_is_not_set_on_a_lesson_that_has_finished(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    lesson_id = store.add_lesson(conn, "fr", "one", NOW)
    store.fail_lesson(conn, lesson_id, "x")
    store.set_lesson_stage(conn, lesson_id, "joining")
    kept = store.get_lesson(conn, lesson_id)
    assert kept is not None and kept.stage == "writing"


def test_a_failure_to_speak_fails_the_lesson_and_keeps_no_file(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    fakes = Fakes()

    async def renderer(steps: list[Step], speak: Speak, on_joining: Any = None) -> Rendered:
        raise TtsFailed("Azure answered 429")

    lesson_id = run(conn, fakes, tmp_path, renderer=renderer)
    kept = store.get_lesson(conn, lesson_id)
    assert kept is not None
    assert kept.state == "failed"
    assert "Azure couldn't speak the lesson. Azure answered 429." in kept.error
    assert not lesson_service.audio_path(tmp_path, lesson_id).exists()


def test_a_failure_in_ffmpeg_says_so(tmp_path: Path) -> None:
    conn = store.connect(":memory:")

    async def renderer(steps: list[Step], speak: Speak, on_joining: Any = None) -> Rendered:
        raise LessonAudioFailed("ffmpeg isn't installed on the server, so a lesson can't be made.")

    lesson_id = run(conn, Fakes(), tmp_path, renderer=renderer)
    kept = store.get_lesson(conn, lesson_id)
    assert kept is not None
    assert kept.error == "ffmpeg isn't installed on the server, so a lesson can't be made."


def test_asks_claude_again_once_when_the_first_plan_is_unusable(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    fakes = Fakes()
    answers = [{"title": "x", "dialogue": [], "phrases": []}, good_plan()]

    async def write(
        language: str, scene: str, feedback: str, learner: str = "male", register: str = "everyday"
    ) -> tuple[Any, Usage]:
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

    async def write(
        language: str, scene: str, feedback: str, learner: str = "male", register: str = "everyday"
    ) -> tuple[Any, Usage]:
        return {"title": "x", "dialogue": [], "phrases": []}, USAGE

    lesson_id = run(conn, Fakes(), tmp_path, write=write)
    kept = store.get_lesson(conn, lesson_id)
    assert kept is not None
    assert (kept.state, kept.error) == ("failed", "Claude didn't write a usable lesson. Try again.")


def deck(*words: str) -> Any:
    entries = [Entry(i, w, "x", "mature") for i, w in enumerate(words)]
    return lexicon_from(entries, "fr", 0)


STRANGE = good_plan() | {
    "dialogue": [
        {"speaker": "A", "text": "Bonjour, quelle boulangerie magnifique !", "english": "x"},
        *good_plan()["dialogue"][1:],
    ]
}


def test_asks_again_naming_the_dialogue_words_the_learner_doesnt_know(tmp_path: Path) -> None:
    conn = store.connect(":memory:")
    fakes = Fakes()
    answers = [STRANGE, good_plan()]

    async def write(
        language: str, scene: str, feedback: str, learner: str, register: str = "everyday"
    ) -> tuple[Any, Usage]:
        fakes.asked.append((scene, feedback))
        return answers.pop(0), USAGE

    lexicon = deck("bonjour", "vous", "désirez")
    lesson_id = run(conn, fakes, tmp_path, write=write, lexicon=lexicon)
    kept = store.get_lesson(conn, lesson_id)
    assert kept is not None and kept.state == "ready"
    assert fakes.asked[0][1] == ""
    assert "quelle, boulangerie, magnifique" in fakes.asked[1][1]


def test_keeps_the_closest_dialogue_when_every_try_has_unknown_words(tmp_path: Path) -> None:
    conn = store.connect(":memory:")

    async def write(
        language: str, scene: str, feedback: str, learner: str, register: str = "everyday"
    ) -> tuple[Any, Usage]:
        return STRANGE, USAGE

    lesson_id = run(conn, Fakes(), tmp_path, write=write, lexicon=deck("bonjour"))
    kept = store.get_lesson(conn, lesson_id)
    assert kept is not None and kept.state == "ready"


def test_a_dialogue_of_taught_and_known_words_is_asked_for_once(tmp_path: Path) -> None:
    fakes = Fakes()
    lesson_id = run(
        store.connect(":memory:"),
        fakes,
        tmp_path,
        lexicon=deck("bonjour", "vous", "désirez"),
    )
    assert lesson_id and len(fakes.asked) == 1


def test_the_request_names_the_language_and_scene() -> None:
    message = lesson_writer.request_message("fr", "ordering a coffee")
    assert "French" in message and "ordering a coffee" in message


def test_a_japanese_request_asks_for_kana_and_kanji_and_polite_forms() -> None:
    message = lesson_writer.request_message("ja", "buying a train ticket")
    assert "Japanese" in message and "never romaji" in message and "です/ます" in message
    assert "never romaji" not in lesson_writer.request_message("fr", "ordering a coffee")


def test_every_language_but_english() -> None:
    assert lesson_service.LESSON_LANGUAGES == ("fr", "th", "es", "de", "ru", "el", "pl", "nb", "ja")


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


THAI_VOICES = {
    "th": {"male": "th-TH-NiwatNeural", "female": "th-TH-PremwadeeNeural"},
    "en": VOICES["en"],
}


def thai_plan(*, particle: str = "ครับ", first_person: str = "ผม") -> dict[str, Any]:
    def phrase(text: str, english: str, *parts: str) -> dict[str, Any]:
        return {"text": text, "english": english, "parts": list(parts or [text])}

    coffee = f"{first_person}อยากได้กาแฟ{particle}"
    other = "ค่ะ" if particle == "ครับ" else "ครับ"
    return {
        "title": "Getting a coffee",
        "dialogue": [
            {"speaker": "A", "text": f"สวัสดี{particle}", "english": "Hello."},
            {"speaker": "B", "text": f"ได้{other}", "english": "Sure."},
            {"speaker": "A", "text": coffee, "english": "I'd like a coffee."},
            {"speaker": "A", "text": f"ขอบคุณ{particle}", "english": "Thank you."},
            {"speaker": "A", "text": f"ไม่เป็นไร{particle}", "english": "No problem."},
        ],
        "phrases": [
            phrase(f"สวัสดี{particle}", "Hello."),
            phrase(f"ขอบคุณ{particle}", "Thank you."),
            phrase(f"ไม่เป็นไร{particle}", "No problem."),
            phrase(coffee, "I'd like a coffee.", f"{first_person}อยากได้", f"กาแฟ{particle}"),
        ],
        "roleplay": [
            {
                "speaker": "A",
                "text": f"สวัสดี{particle} ขอบคุณ{particle}",
                "english": "Hello, thank you.",
            },
            {"speaker": "B", "text": f"ได้{other}", "english": "Sure."},
            {
                "speaker": "A",
                "text": f"ขอบคุณ{particle} ไม่เป็นไร{particle}",
                "english": "Thanks, no problem.",
            },
        ],
    }


def thai_write(answers: list[dict[str, Any]], asked: list[tuple[str, str]]) -> Any:
    async def write(
        language: str, scene: str, feedback: str, learner: str = "male", register: str = "everyday"
    ) -> tuple[Any, Usage]:
        asked.append((learner, feedback))
        return answers.pop(0), USAGE

    return write


def make_thai(
    tmp_path: Path, answers: list[dict[str, Any]], learner: str
) -> tuple[Fakes, list[tuple[str, str]], Any]:
    conn = store.connect(":memory:")
    fakes = Fakes()
    asked: list[tuple[str, str]] = []
    lesson_id = store.add_lesson(conn, "th", "a coffee", NOW)
    asyncio.run(
        lesson_service.make_lesson(
            conn,
            lesson_id,
            "th",
            "a coffee",
            write=thai_write(answers, asked),
            synthesize=fakes.synthesize,
            voices=lambda lang: THAI_VOICES[lang],
            lessons_dir=tmp_path,
            now=lambda: NOW,
            renderer=fakes.renderer,
            learner=learner,  # type: ignore[arg-type]
        )
    )
    return fakes, asked, store.get_lesson(conn, lesson_id)


def test_a_thai_lesson_for_a_man_has_khrap_in_the_male_voice(tmp_path: Path) -> None:
    fakes, asked, kept = make_thai(tmp_path, [thai_plan()], "male")
    assert kept is not None and kept.state == "ready"
    assert asked == [("male", "")]
    by_text = {text: voice for text, voice, _ in fakes.spoken}
    assert by_text["สวัสดีครับ"] == "th-TH-NiwatNeural"
    assert by_text["ได้ค่ะ"] == "th-TH-PremwadeeNeural"


def test_a_thai_lesson_for_a_woman_has_kha_in_the_female_voice(tmp_path: Path) -> None:
    fakes, asked, kept = make_thai(
        tmp_path, [thai_plan(particle="ค่ะ", first_person="ดิฉัน")], "female"
    )
    assert kept is not None and kept.state == "ready"
    assert asked == [("female", "")]
    by_text = {text: voice for text, voice, _ in fakes.spoken}
    assert by_text["สวัสดีค่ะ"] == "th-TH-PremwadeeNeural"
    assert by_text["ได้ครับ"] == "th-TH-NiwatNeural"


def test_a_thai_phrase_without_the_particle_is_asked_for_again(tmp_path: Path) -> None:
    missing = thai_plan()
    missing["phrases"][0] = {"text": "สวัสดี", "english": "Hello.", "parts": ["สวัสดี"]}
    _, asked, kept = make_thai(tmp_path, [missing, thai_plan()], "male")
    assert kept is not None and kept.state == "ready"
    assert "ครับ" in asked[1][1] and "สวัสดี" in asked[1][1]


def test_a_man_saying_chan_is_asked_for_again(tmp_path: Path) -> None:
    _, asked, kept = make_thai(tmp_path, [thai_plan(first_person="ฉัน"), thai_plan()], "male")
    assert kept is not None and kept.state == "ready"
    assert "ฉัน" in asked[1][1]


def test_a_thai_lesson_still_missing_the_particle_is_not_made(tmp_path: Path) -> None:
    bare = thai_plan(particle="")
    _, _, kept = make_thai(tmp_path, [bare, bare], "male")
    assert kept is not None and kept.state == "failed"


def test_the_thai_request_names_the_learners_particle() -> None:
    man = lesson_writer.request_message("th", "a coffee", "male")
    woman = lesson_writer.request_message("th", "a coffee", "female")
    assert "A (a man)" in man and "ครับ for a man" in man
    assert "A (a woman)" in woman and "ค่ะ for a woman" in woman


def given_write(answers: list[dict[str, Any]], asked: list[tuple[str, str]]) -> Any:
    async def write(
        language: str,
        scene: str,
        given: tuple[lesson.Phrase, ...],
        feedback: str,
        learner: str = "male",
        register: str = "everyday",
    ) -> tuple[Any, Usage]:
        asked.append((", ".join(p.text for p in given), feedback))
        return answers.pop(0), USAGE

    return write


def make_given(
    tmp_path: Path, answers: list[dict[str, Any]], language: str, given: tuple[lesson.Phrase, ...]
) -> tuple[Fakes, list[tuple[str, str]], Any]:
    conn = store.connect(":memory:")
    fakes = Fakes()
    asked: list[tuple[str, str]] = []
    lesson_id = store.add_lesson(conn, language, "Thai lesson", NOW)  # type: ignore[arg-type]
    asyncio.run(
        lesson_service.make_lesson(
            conn,
            lesson_id,
            language,  # type: ignore[arg-type]
            "Thai lesson",
            write=fakes.write,
            synthesize=fakes.synthesize,
            voices=lambda lang: {**VOICES, **THAI_VOICES}[lang],
            lessons_dir=tmp_path,
            now=lambda: NOW,
            renderer=fakes.renderer,
            given=given,
            write_given=given_write(answers, asked),
        )
    )
    return fakes, asked, store.get_lesson(conn, lesson_id)


def test_a_lesson_from_given_phrases_teaches_them_and_not_claudes(tmp_path: Path) -> None:
    given = lesson.given_phrases([("Un café.", "a coffee"), ("presque", "almost")])
    fakes, asked, kept = make_given(tmp_path, [good_plan()], "fr", given)
    assert kept is not None and kept.state == "ready", kept
    # Asked with the learner's phrases; the scene writer isn't used.
    assert asked == [("Un café., presque", "")]
    assert fakes.asked == []
    assert [p["text"] for p in kept.plan["phrases"]] == ["Un café.", "presque"]
    assert [p["english"] for p in kept.plan["phrases"]] == ["a coffee", "almost"]


def test_a_thai_lesson_from_given_words_does_not_ask_for_a_particle_on_them(
    tmp_path: Path,
) -> None:
    # The learner's own word has no ครับ, and that's not sent back; the speakers' lines still are.
    given = lesson.given_phrases([("เกือบ", "almost")])
    _, asked, kept = make_given(tmp_path, [thai_plan()], "th", given)
    assert kept is not None and kept.state == "ready", kept
    assert len(asked) == 1
    _, asked, kept = make_given(tmp_path, [thai_plan(first_person="ฉัน"), thai_plan()], "th", given)
    assert kept is not None and kept.state == "ready"
    assert "ฉัน" in asked[1][1]


def test_the_given_request_lists_the_phrases_and_asks_for_them_unchanged() -> None:
    given = lesson.given_phrases([("เกือบ", "almost"), ("พูดช้าๆ หน่อย", "speak a bit slower")])
    request = lesson_writer.given_request_message("th", "Thai lesson", given, "male")
    assert "- เกือบ (almost)" in request and "- พูดช้าๆ หน่อย (speak a bit slower)" in request
    assert "letter for letter" in request
    assert "Thai lesson" in request
    assert "end every phrase taught with ครับ" not in request


def test_a_given_lesson_may_use_the_words_its_situation_names() -> None:
    given = lesson.given_phrases([("พูดอีกครั้งได้ไหม", "Can you say that again?")])
    request = lesson_writer.given_request_message(
        "th", "My violin recital last night", given, "male"
    )
    assert "up to three words the situation itself names" in request
    assert "Put those in B's lines, at most two in a line" in request
