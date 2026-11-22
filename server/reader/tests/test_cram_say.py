from typing import Any

from franki_reader.cram_say import (
    MAX_LINES,
    MAX_QUESTION,
    MAX_SUMMARY,
    Turn,
    ask_message,
    clean_lines,
    clean_question,
    lines_message,
    lines_system,
)
from franki_reader.cram_themes import Candidate, PoolWord, Seeds
from franki_reader.lexicon import deck_lexicon

POOL = (PoolWord("n1", "le café", "the coffee", "cram"),)
DECK = (Candidate("le café", "the coffee"), Candidate("le pain", "bread"))


def seeds(**kwargs: object) -> Seeds:
    base: dict[str, object] = {
        "pool": POOL,
        "candidates": (),
        "weak_spots": (),
        "avoid": (),
        "stretch": False,
        "deck": DECK,
        "facts": "I had a coffee",
    }
    return Seeds(**{**base, **kwargs})  # type: ignore[arg-type]


def line(text: str = "J'ai pris le café.", english: str = "I had a coffee.", **kw: Any) -> Any:
    return {"text": text, "english": english, "new_words": [], **kw}


def checker() -> Any:
    return deck_lexicon("fr", ["café", "pris", "le", "j'ai"])


def test_the_question_is_one_short_line_without_quotes() -> None:
    assert clean_question('  "What was   the hill like?"\n') == "What was the hill like?"
    assert clean_question("   ") == ""
    assert clean_question("x" * (MAX_QUESTION + 1)) == ""


def test_the_chat_so_far_is_what_the_next_question_is_asked_from() -> None:
    assert "Open with the first question" in ask_message("The 5k", ())
    text = ask_message("The 5k", (Turn("claude", "How did it go?"), Turn("you", "Well.")))
    assert "Friend: How did it go?" in text and "Learner: Well." in text
    assert "What the lesson is for: The 5k" in text


def test_lines_are_asked_from_what_was_said_and_the_numbered_words() -> None:
    text = lines_message(seeds(topic="The 5k"))
    assert "I had a coffee" in text and "[0] le café (the coffee)" in text
    assert "The 5k" in text


def test_a_line_keeps_its_words_and_names_what_the_learner_lacks() -> None:
    raw = {
        "summary": " I had   a coffee. ",
        "lines": [line(new_words=[{"word": "croissant", "english": "croissant"}])],
    }
    summary, lines = clean_lines(raw, seeds(), "fr", None, {})
    assert summary == "I had a coffee."
    assert [(s.english, s.text) for s in lines] == [("I had a coffee.", "J'ai pris le café.")]
    assert [(m.text, m.english) for m in lines[0].missing] == [("croissant", "croissant")]


def test_the_check_adds_the_unknown_words_claude_did_not_name_and_counts_the_known() -> None:
    raw = {"summary": "", "lines": [line("J'ai pris le chocolat.")]}
    _, lines = clean_lines(raw, seeds(), "fr", checker(), {"chocolat": "chocolate"})
    assert lines[0].known >= 2
    assert [(m.text, m.english) for m in lines[0].missing] == [("chocolat", "chocolate")]


def test_a_word_already_in_the_deck_is_never_offered_as_new() -> None:
    raw = {"summary": "", "lines": [line(new_words=[{"word": "le pain", "english": "bread"}])]}
    _, lines = clean_lines(raw, seeds(), "fr", None, {})
    assert lines[0].missing == ()


def test_unusable_lines_are_dropped_not_repaired() -> None:
    raw = {
        "summary": "x" * (MAX_SUMMARY + 50),
        "lines": [
            line(),
            line(),  # the same line again
            line("", "empty"),
            line("日本語です", "Not in the language."),
            line(english=""),
            "not a line",
        ],
    }
    summary, lines = clean_lines(raw, seeds(), "fr", None, {})
    assert len(summary) == MAX_SUMMARY
    assert len(lines) == 1


def test_at_most_the_most_lines_are_kept() -> None:
    raw = {
        "summary": "",
        "lines": [line(f"Je vais {n} fois.", f"I go {n} times.") for n in range(MAX_LINES + 4)],
    }
    assert len(clean_lines(raw, seeds(), "fr", None, {})[1]) == MAX_LINES


def test_a_thai_line_must_be_in_the_learners_gender() -> None:
    man = {
        "summary": "",
        "lines": [
            line("ผมกินกาแฟครับ", "I drink coffee."),
            line("ดิฉันกินกาแฟค่ะ", "I drink coffee, as a woman."),
        ],
    }
    _, lines = clean_lines(man, seeds(), "th", None, {})
    assert [s.text for s in lines] == ["ผมกินกาแฟครับ"]
    _, lines = clean_lines(man, seeds(learner="female"), "th", None, {})
    assert [s.text for s in lines] == ["ดิฉันกินกาแฟค่ะ"]


def test_the_system_prompt_carries_the_register_and_thai_gender() -> None:
    assert "ผม" in lines_system("th", "everyday", "male")
    assert "ดิฉัน" in lines_system("th", "everyday", "female")
    assert "ผม" not in lines_system("fr", "everyday", "male")
