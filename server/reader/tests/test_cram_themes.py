from typing import Any

from franki_reader.cram_themes import (
    COUNT,
    MAX_NEW,
    MAX_QUESTIONS,
    MIN_QUESTIONS,
    Candidate,
    PoolWord,
    Seeds,
    clean_themes,
    request_message,
    system_message,
)

POOL = (
    PoolWord("n1", "un café", "a coffee", "carried"),
    PoolWord("n2", "la carte", "the menu", "missed"),
    PoolWord("n3", "l'addition", "the check", "fresh"),
)
CANDIDATES = (Candidate("commander", "to order"), Candidate("l'allergie", ""))


def seeds(**kwargs: object) -> Seeds:
    base: dict[str, object] = {
        "pool": POOL,
        "candidates": CANDIDATES,
        "weak_spots": (),
        "avoid": (),
        "stretch": False,
    }
    return Seeds(**{**base, **kwargs})  # type: ignore[arg-type]


def question(n: int = 1) -> dict[str, str]:
    return {"text": f"Vous aimez le café {n} ?", "english": f"Do you like coffee {n}?"}


def theme(**kwargs: object) -> dict[str, object]:
    base: dict[str, object] = {
        "title": "Ordering at a restaurant",
        "why": "Uses words you haven't used yet.",
        "words": [0, 1],
        "new_words": [{"index": 0, "english": "to order"}],
        "questions": [question(1), question(2)],
        "story": {"text": "Hier, j'ai pris un café.", "english": "Yesterday I had a coffee."},
    }
    return {**base, **kwargs}


def test_keeps_a_theme_and_turns_numbers_into_the_apps_ids() -> None:
    got = clean_themes({"themes": [theme()]}, seeds(), "fr")
    assert len(got) == 1
    t = got[0]
    assert t.title == "Ordering at a restaurant"
    assert t.word_ids == ("n1", "n2")
    assert t.new_words == (Candidate("commander", "to order"),)
    assert [q.english for q in t.questions] == ["Do you like coffee 1?", "Do you like coffee 2?"]
    assert t.story is not None and t.story.english == "Yesterday I had a coffee."


def test_drops_numbers_outside_the_lists_and_repeats() -> None:
    raw = {
        "themes": [
            theme(words=[0, 0, 7, -1, True, "1", 2], new_words=[{"index": 9, "english": "x"}])
        ]
    }
    t = clean_themes(raw, seeds(), "fr")[0]
    assert t.word_ids == ("n1", "n3")
    assert t.new_words == ()


def test_a_new_word_uses_the_decks_meaning_when_it_has_one_and_otherwise_claudes() -> None:
    raw = {
        "themes": [
            theme(
                new_words=[
                    {"index": 0, "english": "something else"},
                    {"index": 1, "english": "allergy"},
                    {"index": 1, "english": "allergy again"},
                ]
            )
        ]
    }
    t = clean_themes(raw, seeds(), "fr")[0]
    assert t.new_words == (Candidate("commander", "to order"), Candidate("l'allergie", "allergy"))


def test_a_new_word_with_no_meaning_anywhere_is_dropped() -> None:
    raw = {"themes": [theme(new_words=[{"index": 1, "english": " "}])]}
    assert clean_themes(raw, seeds(), "fr")[0].new_words == ()


def test_at_most_the_most_new_words_and_questions() -> None:
    many = tuple(Candidate(f"mot{n}", f"word {n}") for n in range(10))
    raw = {
        "themes": [
            theme(
                new_words=[{"index": n, "english": "x"} for n in range(10)],
                questions=[question(n) for n in range(10)],
            )
        ]
    }
    t = clean_themes(raw, seeds(candidates=many), "fr")[0]
    assert len(t.new_words) == MAX_NEW
    assert len(t.questions) == MAX_QUESTIONS


def test_a_theme_needs_words_and_enough_questions() -> None:
    no_words = theme(words=[], new_words=[])
    few = theme(title="Few", questions=[question(1)])
    ok = theme(title="Fine")
    got = clean_themes({"themes": [no_words, few, ok]}, seeds(), "fr")
    assert [t.title for t in got] == ["Fine"]
    assert MIN_QUESTIONS == 2


def test_questions_and_story_must_be_in_the_languages_script() -> None:
    thai = Seeds((PoolWord("n1", "กิน", "to eat", "deck"),), (), (), (), False)
    good = {"text": "คุณชอบกินเผ็ดไหม", "english": "Do you like spicy food?"}
    romanized = {"text": "khun chop gin phet mai", "english": "Do you like spicy food?"}
    mixed = {"text": "คุณชอบ spicy ไหม", "english": "Do you like spicy food?"}
    raw = {
        "themes": [
            theme(
                words=[0],
                new_words=[],
                questions=[good, romanized, mixed, {**good, "text": "คุณกินข้าวหรือยัง"}],
                story=romanized,
            )
        ]
    }
    t = clean_themes(raw, thai, "th")[0]
    assert [q.text for q in t.questions] == ["คุณชอบกินเผ็ดไหม", "คุณกินข้าวหรือยัง"]
    assert t.story is None


def test_titles_are_trimmed_unique_and_not_taken() -> None:
    raw = {
        "themes": [
            theme(title='"At the bank."'),
            theme(title="at the BANK"),
            theme(title="Taken one"),
            theme(title="x" * 61),
            theme(title="  "),
        ]
    }
    got = clean_themes(raw, seeds(avoid=("taken ONE",)), "fr")
    assert [t.title for t in got] == ["At the bank"]


def test_stops_at_the_count_and_survives_a_malformed_answer() -> None:
    raw = {"themes": [theme(title=f"Theme {n}") for n in range(COUNT + 3)]}
    assert len(clean_themes(raw, seeds(), "fr")) == COUNT
    bads: list[Any] = [None, [], {}, {"themes": "a"}, {"themes": [1, "a", None]}, {"themes": [{}]}]
    for bad in bads:
        assert clean_themes(bad, seeds(), "fr") == []
    odd = theme(words="a", new_words="b", questions="c", story=4)
    assert clean_themes({"themes": [odd]}, seeds(), "fr") == []


def test_a_reason_too_long_to_show_is_left_out() -> None:
    assert clean_themes({"themes": [theme(why="x" * 300)]}, seeds(), "fr")[0].why == ""


def test_the_request_numbers_both_lists_and_names_why_each_word_is_there() -> None:
    text = request_message(seeds(weak_spots=("Telling time: minutes:to",), avoid=("At the bank",)))
    assert "[0] un café (a coffee) - not used at the last lesson" in text
    assert "[1] la carte (the menu) - missed in practice rounds" in text
    assert "[2] l'addition (the check) - added lately" in text
    assert "[0] commander (to order)" in text
    assert "[1] l'allergie\n" in text + "\n"
    assert "- Telling time: minutes:to" in text
    assert "- At the bank" in text


def test_the_request_leaves_out_what_there_is_none_of() -> None:
    text = request_message(seeds(candidates=()))
    assert "lacks" not in text
    assert "has been missing" not in text
    assert "taken" not in text


def test_the_system_message_names_the_language_and_the_level() -> None:
    assert "French" in system_message("fr", False)
    assert "within the learner's level" in system_message("fr", False)
    assert "stretch" in system_message("fr", True)


def test_the_system_message_asks_for_spoken_not_written_register() -> None:
    text = system_message("th", False)
    assert "ordinary person talks in everyday conversation" in text
    assert "not the way a textbook or a written text puts it" in text


def test_a_topic_leads_the_request_and_asks_for_angles_on_it() -> None:
    text = request_message(seeds(topic="My violin recital"))
    assert text.startswith("What the lesson is for: My violin recital\n\nThe learner's words:")
    assert "angle on that" in system_message("fr", False, topic=True)
    assert "angle on that" not in system_message("fr", False)
    assert not request_message(seeds()).startswith("What the lesson")
