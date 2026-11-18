from franki_reader import lesson
from franki_reader.lesson_topics import COUNT, MAX_IDEA, clean_topics, request_message, words_of


def test_keeps_the_usable_ideas_in_order() -> None:
    raw = {
        "topics": [
            '"At the bank."',
            "  Buying   a SIM card ",
            "at the bank",
            "x" * (MAX_IDEA + 1),
            4,
        ]
    }
    assert clean_topics(raw, ()) == ["At the bank", "Buying a SIM card"]


def test_drops_what_is_taken_ignoring_case_and_stops_at_the_count() -> None:
    raw = {"topics": ["Ordering a coffee", *[f"Idea {n}" for n in range(10)]]}
    got = clean_topics(raw, ("ordering a COFFEE",))
    assert got == [f"Idea {n}" for n in range(COUNT)]


def test_a_malformed_answer_gives_nothing() -> None:
    assert clean_topics(["a"], ()) == []
    assert clean_topics({"topics": "a"}, ()) == []
    assert clean_topics({}, ()) == []


def test_the_request_names_the_words_and_what_to_avoid_only_when_there_are_some() -> None:
    plain = request_message("fr", (), ())
    assert "French" in plain
    assert "chosen" not in plain
    assert "Do not suggest" not in plain
    full = request_message("fr", ("Un café (A coffee)",), ("At the bank",))
    assert "- Un café (A coffee)" in full
    assert "- At the bank" in full


def test_words_are_sent_with_their_meaning() -> None:
    phrases = lesson.given_phrases([("Un café", "A coffee")])
    assert words_of(phrases) == ("Un café (A coffee)",)
