from franki_reader.difficulty import (
    DEFAULT_FLOOR,
    MAX_CEILING,
    Difficulty,
    adapt,
    adapt_to_check,
    after_reading,
)


def test_too_hard_cuts_a_stretch_word_and_leaves_the_target() -> None:
    assert adapt(Difficulty(0.95, 2), "too_hard") == Difficulty(0.95, 1)


def test_too_easy_adds_one() -> None:
    assert adapt(Difficulty(0.95, 2), "too_easy") == Difficulty(0.95, 3)


def test_about_right_and_no_rating_change_nothing() -> None:
    assert adapt(Difficulty(0.95, 2), "about_right") == Difficulty(0.95, 2)
    assert adapt(Difficulty(0.95, 2), None) == Difficulty(0.95, 2)


def test_stretch_words_stay_between_one_and_four() -> None:
    assert adapt(Difficulty(0.95, 1), "too_hard") == Difficulty(0.95, 1)
    assert adapt(Difficulty(0.95, 4), "too_easy") == Difficulty(0.95, 4)


def test_no_rating_moves_the_coverage_target() -> None:
    d = Difficulty()
    for rating in ("too_hard", "too_hard", "too_easy", "too_easy", "too_hard"):
        d = adapt(d, rating)
    assert d.floor == DEFAULT_FLOOR == 0.95


def test_the_ceiling_is_four_points_above_the_floor_up_to_98_percent() -> None:
    assert Difficulty(0.93, 2).ceiling == 0.97
    # ... but never above 98%: more known words than that leaves about one new word in 50.
    assert Difficulty().ceiling == MAX_CEILING == 0.98


def test_a_poor_check_cuts_a_stretch_word() -> None:
    assert adapt_to_check(Difficulty(0.95, 3), "about_right", 2, 8) == Difficulty(0.95, 2)
    assert adapt_to_check(Difficulty(0.95, 3), None, 2, 6) == Difficulty(0.95, 2)
    assert adapt_to_check(Difficulty(0.95, 1), "about_right", 0, 8) == Difficulty(0.95, 1)


def test_a_fair_check_too_few_questions_or_too_hard_change_nothing() -> None:
    assert adapt_to_check(Difficulty(0.95, 3), "about_right", 5, 8) == Difficulty(0.95, 3)
    assert adapt_to_check(Difficulty(0.95, 3), "about_right", 0, 5) == Difficulty(0.95, 3)
    assert adapt_to_check(Difficulty(0.95, 3), "about_right", None, None) == Difficulty(0.95, 3)
    # Too hard already cut one.
    assert adapt_to_check(Difficulty(0.95, 2), "too_hard", 0, 8) == Difficulty(0.95, 2)
    # A good score never makes the next text harder: the rating does that.
    assert adapt_to_check(Difficulty(0.95, 3), "too_easy", 8, 8) == Difficulty(0.95, 3)


def test_grammar_allowance_defaults_to_two_and_a_rating_leaves_it_alone() -> None:
    assert Difficulty().unset_uses == 2
    assert adapt(Difficulty(unset_uses=4), "too_hard").unset_uses == 4
    assert adapt(Difficulty(unset_uses=1), "too_easy").unset_uses == 1
    assert adapt_to_check(Difficulty(unset_uses=4), None, 0, 8).unset_uses == 4


def test_a_rating_steps_from_the_level_the_text_was_written_at() -> None:
    # Written with three stretch words; the count has since moved to one.
    written, current = Difficulty(0.95, 3), Difficulty(0.95, 1)
    # Too hard: already below a step under the text's level, so nothing moves.
    assert after_reading(current, written, "too_hard", None, None) == current
    # Too easy: a step above the text's level, which is above the current one.
    assert after_reading(current, written, "too_easy", None, None) == Difficulty(0.95, 4)
    assert after_reading(current, written, "about_right", None, None) == current


def test_a_rating_never_moves_the_level_back() -> None:
    # Too hard on a text written with four stretch words when the count is already one.
    assert after_reading(Difficulty(0.95, 1), Difficulty(0.95, 4), "too_hard", None, None) == (
        Difficulty(0.95, 1)
    )
    # Too easy on a text written with one when the count has risen to four.
    assert after_reading(Difficulty(0.95, 4), Difficulty(0.95, 1), "too_easy", None, None) == (
        Difficulty(0.95, 4)
    )


def test_a_rating_of_a_text_at_a_limit_takes_the_level_to_that_limit() -> None:
    # The text was written with one stretch word, the minimum; the current count is higher.
    assert after_reading(Difficulty(0.95, 3), Difficulty(0.95, 1), "too_hard", None, None) == (
        Difficulty(0.95, 1)
    )
    assert after_reading(Difficulty(0.95, 2), Difficulty(0.95, 4), "too_easy", None, None) == (
        Difficulty(0.95, 4)
    )


def test_three_ratings_of_texts_written_ahead_cut_one_stretch_word_not_three() -> None:
    current = Difficulty(0.95, 3)
    for _ in range(3):
        current = after_reading(current, Difficulty(0.95, 3), "too_hard", None, None)
    assert current == Difficulty(0.95, 2)


def test_a_poor_check_steps_from_the_texts_level_too() -> None:
    # Three texts written with three stretch words, each with a poor check, cut one, not three.
    current = Difficulty(0.95, 3)
    for _ in range(3):
        current = after_reading(current, Difficulty(0.95, 3), "about_right", 2, 8)
    assert current == Difficulty(0.95, 2)
    # With "too easy", the two cancel out: the count stays where it was.
    assert after_reading(Difficulty(0.95, 3), Difficulty(0.95, 3), "too_easy", 2, 8) == (
        Difficulty(0.95, 3)
    )


def test_after_reading_keeps_the_current_grammar_allowance() -> None:
    current = Difficulty(0.95, 2, unset_uses=4)
    assert after_reading(current, Difficulty(0.95, 2), "too_hard", None, None).unset_uses == 4
