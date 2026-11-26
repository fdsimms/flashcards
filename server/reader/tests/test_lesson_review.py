"""What a written lesson is checked for beyond what the code can prove: its craft (`craft_problems`,
asked for again, never refused) and a second model's reading of the wording (`apply_review`)."""

import asyncio
from typing import Any

from franki_reader import lesson, lesson_writer
from franki_reader.generator import Usage
from franki_reader.lesson_writer import REVIEW_KEY

USAGE = Usage(input_tokens=1000, output_tokens=500, model="claude-sonnet-5-5")


def phrase(text: str, english: str, *parts: str) -> dict[str, Any]:
    return {"text": text, "english": english, "parts": list(parts or [text])}


def raw_plan(**over: Any) -> dict[str, Any]:
    plan: dict[str, Any] = {
        "title": "Getting a coffee",
        "dialogue": [
            {"speaker": "A", "text": "Bonjour.", "english": "Hello."},
            {"speaker": "B", "text": "Vous désirez ?", "english": "What would you like?"},
            {"speaker": "A", "text": "Un café, s'il vous plaît.", "english": "A coffee, please."},
            {"speaker": "A", "text": "Oui, avec du lait.", "english": "Yes, with milk."},
            {"speaker": "A", "text": "Merci, au revoir.", "english": "Thank you, goodbye."},
        ],
        "phrases": [
            phrase("Bonjour.", "Hello."),
            phrase(
                "Un café, s'il vous plaît.", "A coffee, please.", "Un café,", "s'il vous plaît."
            ),
            phrase("Oui, avec du lait.", "Yes, with milk.", "Oui,", "avec du lait."),
            phrase("Merci, au revoir.", "Thank you, goodbye.", "Merci,", "au revoir."),
        ],
        "mixes": [
            {"text": "Un café avec du lait, merci.", "english": "A coffee with milk, thank you."},
            {"text": "Bonjour, au revoir.", "english": "Hello, goodbye."},
        ],
    }
    return plan | over


def cleaned(raw: dict[str, Any]) -> lesson.Plan:
    plan = lesson.clean_plan(raw, "ordering a coffee")
    assert plan is not None
    return plan


def test_a_plan_with_nothing_weak_has_no_craft_problems() -> None:
    assert lesson_writer.craft_problems(cleaned(raw_plan()), "fr") == []


def test_asks_for_more_phrases_than_the_minimum() -> None:
    raw = raw_plan(phrases=raw_plan()["phrases"][:3])
    (said,) = lesson_writer.craft_problems(cleaned(raw), "fr")
    assert "4 to 5 phrases, not 3" in said


def test_a_long_phrase_taught_in_one_piece_is_named() -> None:
    raw = raw_plan()
    raw["phrases"][1] = phrase("Un café, s'il vous plaît.", "A coffee, please.")
    (said,) = lesson_writer.craft_problems(cleaned(raw), "fr")
    assert "at least two parts" in said and "Un café, s'il vous plaît." in said


def test_a_phrase_the_dialogue_never_says_is_named() -> None:
    raw = raw_plan()
    raw["dialogue"] = raw["dialogue"][:3]
    said = " ".join(lesson_writer.craft_problems(cleaned(raw), "fr"))
    assert "Oui, avec du lait." in said and "Merci, au revoir." in said


def test_a_long_line_for_a_is_named_and_unspaced_languages_get_more_room() -> None:
    long = "Guten Tag ich habe Kopfschmerzen haben Sie etwas dagegen"
    raw = raw_plan()
    raw["dialogue"][0] = {"speaker": "A", "text": long, "english": "x"}
    said = " ".join(lesson_writer.craft_problems(cleaned(raw), "de"))
    assert "at most 8 words" in said and long in said
    assert not any("at most" in x for x in lesson_writer.craft_problems(cleaned(raw), "th"))


def test_the_learners_own_phrases_are_only_checked_for_a_lines() -> None:
    raw = raw_plan(phrases=raw_plan()["phrases"][:3])
    assert lesson_writer.craft_problems(cleaned(raw), "fr", phrases=False) == []


def test_a_flagged_mix_is_dropped_and_the_rest_kept() -> None:
    raw = raw_plan()
    found = [{"kind": "mix", "index": 2, "problem": "Means nothing."}]
    lesson_writer.apply_review(raw, cleaned(raw), found, phrases=True)
    assert [m["text"] for m in raw["mixes"]] == ["Un café avec du lait, merci."]
    assert REVIEW_KEY not in raw


def test_a_flagged_phrase_or_line_is_asked_for_again() -> None:
    raw = raw_plan()
    found = [
        {"kind": "phrase", "index": 3, "problem": "Misleading alone."},
        {"kind": "dialogue", "index": 2, "problem": "Stiff."},
    ]
    lesson_writer.apply_review(raw, cleaned(raw), found, phrases=True)
    assert lesson_writer.reviewed(raw) == [
        "Phrase 3 (Oui, avec du lait.): Misleading alone.",
        "Dialogue line 2 (Vous désirez ?): Stiff.",
    ]


def test_the_learners_own_phrases_are_never_flagged() -> None:
    raw = raw_plan()
    found = [{"kind": "phrase", "index": 1, "problem": "Odd."}]
    lesson_writer.apply_review(raw, cleaned(raw), found, phrases=False)
    assert lesson_writer.reviewed(raw) == []


def test_a_malformed_finding_is_ignored() -> None:
    raw = raw_plan()
    before = [dict(m) for m in raw["mixes"]]
    found = [
        "text",
        {"kind": "mix", "index": 9, "problem": "x"},
        {"kind": "mix", "index": "1", "problem": "x"},
        {"kind": "mix", "index": 1, "problem": " "},
        {"kind": "other", "index": 1, "problem": "x"},
    ]
    lesson_writer.apply_review(raw, cleaned(raw), found, phrases=True)
    assert raw["mixes"] == before and lesson_writer.reviewed(raw) == []
    lesson_writer.apply_review(raw, cleaned(raw), "nonsense", phrases=True)
    assert raw["mixes"] == before


def test_the_review_names_the_language_and_numbers_what_it_shows() -> None:
    said = lesson_writer.review_message("fr", "male", cleaned(raw_plan()))
    assert "native French speaker" in said
    assert "2. A coffee" not in said and "2. Un café, s'il vous plaît. (A coffee, please.)" in said
    assert "1. Un café avec du lait, merci." in said


def test_thai_review_says_who_speaks() -> None:
    said = lesson_writer.review_message("th", "female", cleaned(raw_plan()))
    assert "A is a woman, B is a man." in said


def asked_with(plans: list[dict[str, Any]], asked: list[str]) -> Any:
    async def write(
        language: str, scene: str, feedback: str, learner: str = "male", register: str = "everyday"
    ) -> tuple[Any, Usage]:
        asked.append(feedback)
        return plans.pop(0), USAGE

    return write


def test_what_the_reviewer_found_goes_back_in_the_next_request() -> None:
    flagged = raw_plan() | {REVIEW_KEY: ["Phrase 3 (Oui, avec du lait.): Misleading alone."]}
    asked: list[str] = []
    plan, _ = asyncio.run(
        lesson_writer.write_plan(asked_with([flagged, raw_plan()], asked), "fr", "a coffee")
    )
    assert asked[0] == "" and "Misleading alone." in asked[1]
    assert len(plan.mixes) == 2


def test_a_lesson_still_flagged_after_asking_again_is_kept_not_refused() -> None:
    thin = raw_plan(phrases=raw_plan()["phrases"][:3])
    asked: list[str] = []
    plan, used = asyncio.run(
        lesson_writer.write_plan(asked_with([thin, dict(thin)], asked), "fr", "a coffee")
    )
    assert len(asked) == 2 and len(plan.phrases) == 3
    assert used.input_tokens == 2000
