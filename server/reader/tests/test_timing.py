from typing import Any

from franki_speech import WordMark

from franki_reader.timing import add_times, word_times


def test_each_word_takes_the_time_azure_spoke_it() -> None:
    pieces = ["ตอน", "นั้น", " ", "มี", "เรือ"]
    marks = [
        WordMark("ตอน", 50, 300),
        WordMark("นั้น", 300, 520),
        WordMark("มี", 740, 900),
        WordMark("เรือ", 900, 1200),
    ]
    assert word_times(pieces, marks) == [(50, 300), (300, 520), None, (740, 900), (900, 1200)]


def test_two_words_azure_spoke_as_one_light_up_together() -> None:
    assert word_times(
        ["มา", "ที่", "ชาย", "หาด"],
        [
            WordMark("มา", 0, 200),
            WordMark("ที่", 200, 350),
            WordMark("ชายหาด", 350, 900),
        ],
    ) == [(0, 200), (200, 350), (350, 900), (350, 900)]


def test_a_word_azure_split_runs_from_its_first_part_to_its_last() -> None:
    assert word_times(
        ["ชายหาด", "สวย"],
        [
            WordMark("ชาย", 0, 300),
            WordMark("หาด", 300, 600),
            WordMark("สวย", 600, 900),
        ],
    ) == [(0, 600), (600, 900)]


def test_a_word_that_cant_be_found_is_skipped_and_the_rest_keep_their_times() -> None:
    # A number Azure read out, or a word it reported spelled otherwise.
    assert word_times(
        ["ราคา", "50", "บาท"],
        [
            WordMark("ราคา", 0, 300),
            WordMark("ห้าสิบ", 300, 700),
            WordMark("บาท", 700, 900),
        ],
    ) == [(0, 300), None, (700, 900)]


def test_a_respelling_is_found_as_the_line_spells_it() -> None:
    assert word_times(
        ["มะม่วง", "ราคา"],
        [
            WordMark("มะ\u200bม่วง", 0, 500),
            WordMark("ราคา", 500, 900),
        ],
    ) == [(0, 500), (500, 900)]


def test_a_word_used_twice_takes_each_time_in_turn() -> None:
    assert word_times(
        ["ไป", "ไหน", " ", "ไป", "ตลาด"],
        [
            WordMark("ไป", 0, 100),
            WordMark("ไหน", 100, 300),
            WordMark("ไป", 500, 600),
            WordMark("ตลาด", 600, 900),
        ],
    ) == [(0, 100), (100, 300), None, (500, 600), (600, 900)]


def test_punctuation_and_spaces_have_no_time_in_a_spaced_language() -> None:
    pieces = ["¿", "Qué", " ", "quieres", " ", "tomar", "?"]
    marks = [WordMark("Qué", 100, 300), WordMark("quieres", 300, 700), WordMark("tomar", 700, 1000)]
    assert word_times(pieces, marks) == [
        None,
        (100, 300),
        None,
        (300, 700),
        None,
        (700, 1000),
        None,
    ]


def test_text_in_another_unicode_form_still_matches() -> None:
    decomposed = "que\u0301"  # é as e plus a combining accent
    assert word_times(["¿", "Qué", "?"], [WordMark(decomposed.capitalize(), 0, 400)]) == [
        None,
        (0, 400),
        None,
    ]


def word(text: str, status: str | None) -> dict[str, Any]:
    return {"text": text, "status": status}


def test_add_times_gives_words_their_time_and_leaves_punctuation_and_untimed_lines_alone() -> None:
    words = [word("Hola", "known"), word(",", None), word(" ", None), word("Ana", "name")]
    add_times(words, [WordMark("Hola", 0, 300), WordMark("Ana", 450, 800)])
    assert [w.get("time") for w in words] == [[0, 300], None, None, [450, 800]]

    untimed = [word("Hola", "known")]
    add_times(untimed, None)
    add_times(untimed, [])
    assert "time" not in untimed[0]
