import pytest

from franki_reader import lesson_writer, situations
from franki_reader.generator import TextRequest, request_message
from franki_reader.register import DEFAULT, LEVELS, instruction
from franki_reader.situations import Conversation, feedback_system, play_intro


def test_every_level_has_its_own_instruction() -> None:
    assert DEFAULT == "everyday"
    assert len({instruction(level) for level in LEVELS}) == len(LEVELS)


def test_a_lesson_asks_for_its_register_in_its_rules() -> None:
    for level in LEVELS:
        assert instruction(level) in lesson_writer.request_message("fr", "A cafe", register=level)
    given = (lesson_writer.lesson.Phrase("un café", "a coffee", ("un café",)),)  # type: ignore[attr-defined]
    text = lesson_writer.given_request_message("fr", "A cafe", given, register="formal")
    assert instruction("formal") in text


def test_a_casual_japanese_lesson_teaches_the_plain_form() -> None:
    assert "です/ます form" in lesson_writer.request_message("ja", "A station")
    assert "です/ます form" in lesson_writer.request_message(
        "ja", "An interview", register="formal"
    )
    casual = lesson_writer.request_message("ja", "Dinner with Aiko", register="casual")
    assert "not です/ます" in casual and "polite です/ます form" not in casual


def test_a_text_is_only_told_a_register_that_isnt_the_default() -> None:
    assert "Register:" not in request_message(TextRequest("food"))
    assert "Register:" in request_message(TextRequest("food", register="formal"))
    assert instruction("formal") in request_message(TextRequest("food", register="formal"))


def test_a_scene_adds_its_register_to_the_other_persons_lines_and_the_feedback() -> None:
    # Not Thai: a Thai scene adds the learner's gender to the feedback prompt (`_THAI_LEARNER`).
    plain = Conversation("pl", "A cafe", None, ())
    casual = Conversation("th", "A cafe", None, (), register="casual")
    assert "Register for your lines" not in play_intro(plain)
    assert instruction("casual") in play_intro(casual)
    assert feedback_system(plain) == situations.FEEDBACK_SYSTEM
    assert "casual register" in feedback_system(casual)


@pytest.mark.parametrize("level", LEVELS)
def test_an_instruction_never_uses_an_em_dash(level: str) -> None:
    assert "—" not in instruction(level)  # type: ignore[arg-type]
