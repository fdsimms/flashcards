from franki_reader.difficulty import Difficulty, adapt, adapt_to_check


def test_too_hard_raises_the_floor_and_cuts_a_stretch_word() -> None:
    assert adapt(Difficulty(0.92, 2), "too_hard") == Difficulty(0.93, 1)


def test_too_easy_does_the_reverse() -> None:
    assert adapt(Difficulty(0.97, 2), "too_easy") == Difficulty(0.96, 3)


def test_about_right_and_no_rating_change_nothing() -> None:
    assert adapt(Difficulty(0.96, 2), "about_right") == Difficulty(0.96, 2)
    assert adapt(Difficulty(0.96, 2), None) == Difficulty(0.96, 2)


def test_limits_hold() -> None:
    assert adapt(Difficulty(0.99, 1), "too_hard") == Difficulty(0.99, 1)
    assert adapt(Difficulty(0.90, 3), "too_easy") == Difficulty(0.90, 3)


def test_repeated_steps_land_on_round_numbers() -> None:
    d = Difficulty()
    for _ in range(3):
        d = adapt(d, "too_hard")
    assert d.floor == 0.95


def test_the_ceiling_is_four_points_above_the_floor() -> None:
    assert Difficulty(0.92, 2).ceiling == 0.96
    assert Difficulty(0.99, 1).ceiling == 1.0


def test_a_poor_check_raises_the_floor_but_leaves_the_stretch_words() -> None:
    assert adapt_to_check(Difficulty(0.92, 2), "about_right", 1, 5) == Difficulty(0.93, 2)
    assert adapt_to_check(Difficulty(0.92, 2), None, 1, 3) == Difficulty(0.93, 2)
    assert adapt_to_check(Difficulty(0.99, 2), "about_right", 0, 5) == Difficulty(0.99, 2)


def test_a_fair_check_too_few_questions_or_too_hard_change_nothing() -> None:
    assert adapt_to_check(Difficulty(0.92, 2), "about_right", 3, 5) == Difficulty(0.92, 2)
    assert adapt_to_check(Difficulty(0.92, 2), "about_right", 0, 2) == Difficulty(0.92, 2)
    assert adapt_to_check(Difficulty(0.92, 2), "about_right", None, None) == Difficulty(0.92, 2)
    # Too hard already raised it.
    assert adapt_to_check(Difficulty(0.93, 1), "too_hard", 0, 5) == Difficulty(0.93, 1)
    # A good score never makes the next text harder: the rating does that.
    assert adapt_to_check(Difficulty(0.92, 2), "too_easy", 5, 5) == Difficulty(0.92, 2)


def test_grammar_allowance_defaults_to_two_and_a_rating_leaves_it_alone() -> None:
    assert Difficulty().unset_uses == 2
    assert adapt(Difficulty(unset_uses=4), "too_hard").unset_uses == 4
    assert adapt(Difficulty(unset_uses=1), "too_easy").unset_uses == 1
    assert adapt_to_check(Difficulty(unset_uses=4), None, 0, 5).unset_uses == 4
