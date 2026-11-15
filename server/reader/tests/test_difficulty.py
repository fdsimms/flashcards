from franki_reader.difficulty import (
    DEFAULT_FLOOR,
    MAX_CEILING,
    MAX_FLOOR,
    MIN_FLOOR,
    Difficulty,
    adapt,
    adapt_to_check,
    after_reading,
)


def test_too_hard_raises_the_target_a_step() -> None:
    assert adapt(Difficulty(0.95, 2), "too_hard") == Difficulty(0.96, 2)


def test_too_easy_lowers_it_a_step() -> None:
    assert adapt(Difficulty(0.97, 2), "too_easy") == Difficulty(0.96, 2)


def test_about_right_and_no_rating_change_nothing() -> None:
    assert adapt(Difficulty(0.96, 2), "about_right") == Difficulty(0.96, 2)
    assert adapt(Difficulty(0.96, 2), None) == Difficulty(0.96, 2)


def test_a_rating_leaves_the_practice_word_count_alone() -> None:
    # Practice words are words already studied, so they don't make a text harder.
    for stretch in (1, 2, 4):
        assert adapt(Difficulty(0.95, stretch), "too_hard").stretch == stretch
        assert adapt(Difficulty(0.97, stretch), "too_easy").stretch == stretch
        assert adapt_to_check(Difficulty(0.95, stretch), None, 0, 8).stretch == stretch


def test_the_target_stays_between_95_and_97_percent() -> None:
    assert (DEFAULT_FLOOR, MIN_FLOOR, MAX_FLOOR) == (0.95, 0.95, 0.97)
    assert adapt(Difficulty(0.97, 2), "too_hard") == Difficulty(0.97, 2)
    assert adapt(Difficulty(0.95, 2), "too_easy") == Difficulty(0.95, 2)


def test_repeated_steps_land_on_round_numbers() -> None:
    d = Difficulty()
    for _ in range(3):
        d = adapt(d, "too_hard")
    assert d.floor == 0.97  # a third step would pass the top of the range


def test_the_ceiling_is_four_points_above_the_floor_up_to_98_percent() -> None:
    assert Difficulty(0.93, 2).ceiling == 0.97
    # ... but never above 98%: more known words than that leaves about one new word in 50.
    assert Difficulty().ceiling == MAX_CEILING == 0.98
    assert Difficulty(0.97, 1).ceiling == 0.98


def test_a_poor_check_raises_the_target_a_step() -> None:
    assert adapt_to_check(Difficulty(0.95, 2), "about_right", 2, 8) == Difficulty(0.96, 2)
    assert adapt_to_check(Difficulty(0.95, 2), None, 2, 6) == Difficulty(0.96, 2)
    assert adapt_to_check(Difficulty(0.97, 2), "about_right", 0, 8) == Difficulty(0.97, 2)


def test_a_fair_check_too_few_questions_or_too_hard_change_nothing() -> None:
    assert adapt_to_check(Difficulty(0.95, 2), "about_right", 5, 8) == Difficulty(0.95, 2)
    assert adapt_to_check(Difficulty(0.95, 2), "about_right", 0, 5) == Difficulty(0.95, 2)
    assert adapt_to_check(Difficulty(0.95, 2), "about_right", None, None) == Difficulty(0.95, 2)
    # Too hard already raised it.
    assert adapt_to_check(Difficulty(0.96, 2), "too_hard", 0, 8) == Difficulty(0.96, 2)
    # A good score never makes the next text harder: the rating does that.
    assert adapt_to_check(Difficulty(0.95, 2), "too_easy", 8, 8) == Difficulty(0.95, 2)


def test_grammar_allowance_defaults_to_two_and_a_rating_leaves_it_alone() -> None:
    assert Difficulty().unset_uses == 2
    assert adapt(Difficulty(unset_uses=4), "too_hard").unset_uses == 4
    assert adapt(Difficulty(unset_uses=1), "too_easy").unset_uses == 1
    assert adapt_to_check(Difficulty(unset_uses=4), None, 0, 8).unset_uses == 4


def test_a_rating_steps_from_the_level_the_text_was_written_at() -> None:
    # Written at 95%; the target has since moved to 96%.
    written, current = Difficulty(0.95, 2), Difficulty(0.96, 2)
    # Too hard: already a step above the text's level, so nothing moves.
    assert after_reading(current, written, "too_hard", None, None) == current
    # Too easy: a step below the text's level, which is below the current one.
    assert after_reading(current, written, "too_easy", None, None) == Difficulty(0.95, 2)
    assert after_reading(current, written, "about_right", None, None) == current


def test_a_rating_never_moves_the_level_back() -> None:
    # Too hard on a text written at 95% when the target is already 97%: it stays at 97%.
    assert after_reading(Difficulty(0.97, 2), Difficulty(0.95, 2), "too_hard", None, None) == (
        Difficulty(0.97, 2)
    )
    # Too easy on a text written at 97% when the target has dropped to 95%.
    assert after_reading(Difficulty(0.95, 2), Difficulty(0.97, 2), "too_easy", None, None) == (
        Difficulty(0.95, 2)
    )


def test_a_rating_of_a_text_at_a_limit_takes_the_level_to_that_limit() -> None:
    # The text was written at the highest target; the current one has dropped since.
    assert after_reading(Difficulty(0.96, 2), Difficulty(0.97, 2), "too_hard", None, None) == (
        Difficulty(0.97, 2)
    )
    assert after_reading(Difficulty(0.96, 2), Difficulty(0.95, 2), "too_easy", None, None) == (
        Difficulty(0.95, 2)
    )


def test_ratings_of_texts_written_ahead_move_the_target_one_step_not_three() -> None:
    current = Difficulty()
    for _ in range(3):
        current = after_reading(current, Difficulty(), "too_hard", None, None)
    assert current == Difficulty(0.96, 2)


def test_a_poor_check_steps_from_the_texts_level_too() -> None:
    # Three texts written at 95% each with a poor check raise the target once, not three times.
    current = Difficulty()
    for _ in range(3):
        current = after_reading(current, Difficulty(), "about_right", 2, 8)
    assert current == Difficulty(0.96, 2)
    # With "too easy", the two cancel out.
    assert after_reading(Difficulty(), Difficulty(), "too_easy", 2, 8) == Difficulty()


def test_after_reading_keeps_the_current_practice_word_count_and_grammar_allowance() -> None:
    current = Difficulty(0.95, 3, unset_uses=4)
    after = after_reading(current, Difficulty(0.95, 2), "too_hard", None, None)
    assert (after.stretch, after.unset_uses) == (3, 4)
