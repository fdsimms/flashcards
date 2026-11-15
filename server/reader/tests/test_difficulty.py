from franki_reader.difficulty import (
    CHECK_LOW,
    CHECK_MIN_ASKED,
    DEFAULT_FLOOR,
    EASIER_FLOOR,
    HARDER_FLOOR,
    MAX_CEILING,
    STANDARD_FLOOR,
    Difficulty,
    after_reading,
    nearest_floor,
)


def test_the_target_is_93_95_or_97_percent() -> None:
    assert (HARDER_FLOOR, STANDARD_FLOOR, EASIER_FLOOR, DEFAULT_FLOOR) == (0.93, 0.95, 0.97, 0.95)
    assert Difficulty().floor == STANDARD_FLOOR


def test_the_ceiling_is_four_points_above_the_floor_up_to_98_percent() -> None:
    assert Difficulty(HARDER_FLOOR, 2).ceiling == 0.97
    # ... but never above 98%: more known words than that leaves about one new word in 50.
    assert Difficulty().ceiling == MAX_CEILING == 0.98
    assert Difficulty(EASIER_FLOOR).ceiling == 0.98


def test_a_poor_check_steps_one_level_easier() -> None:
    assert after_reading(Difficulty(), 2, 8) == Difficulty(EASIER_FLOOR)
    assert after_reading(Difficulty(), 0, CHECK_MIN_ASKED) == Difficulty(EASIER_FLOOR)
    assert after_reading(Difficulty(HARDER_FLOOR), 2, 8) == Difficulty(STANDARD_FLOOR)
    assert 2 / 8 < CHECK_LOW


def test_a_saved_target_snaps_to_the_nearest_level() -> None:
    assert [nearest_floor(f) for f in (0.90, 0.93, 0.94, 0.95, 0.96, 0.99)] == [
        0.93,
        0.93,
        0.93,
        0.95,
        0.95,
        0.97,
    ]


def test_easier_stays_easier_after_another_poor_check() -> None:
    assert after_reading(Difficulty(EASIER_FLOOR), 0, 8) == Difficulty(EASIER_FLOOR)


def test_a_fair_check_or_too_few_answers_change_nothing() -> None:
    assert after_reading(Difficulty(), 5, 8) == Difficulty()
    assert after_reading(Difficulty(), 0, CHECK_MIN_ASKED - 1) == Difficulty()
    assert after_reading(Difficulty(), None, None) == Difficulty()
    # A good score never takes Easier away: only the setting does.
    assert after_reading(Difficulty(EASIER_FLOOR), 8, 8) == Difficulty(EASIER_FLOOR)


def test_a_check_leaves_the_practice_word_count_and_the_grammar_allowance_alone() -> None:
    d = after_reading(Difficulty(STANDARD_FLOOR, 3, unset_uses=4), 0, 8)
    assert (d.floor, d.stretch, d.unset_uses) == (EASIER_FLOOR, 3, 4)
