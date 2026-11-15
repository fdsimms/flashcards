from franki_reader.exposure_effect import MIN_EXPOSED, Exposure, Review, compare, exposures_of

DAY = 86_400_000


def answers(
    note: int, card: int, passed_second: bool, last_ivl: int = 5, start: int = 0
) -> list[Review]:
    """A card answered once, then again `last_ivl` days later."""
    return [
        Review(card, note, start, True, 0, False),
        Review(card, note, start + last_ivl * DAY, passed_second, last_ivl, True),
    ]


def build(
    exposed_pass: int, exposed_n: int, control_pass: int, control_n: int
) -> tuple[list[Review], list[Exposure]]:
    reviews: list[Review] = []
    exposures: list[Exposure] = []
    for i in range(exposed_n):
        reviews += answers(i, i, i < exposed_pass)
        exposures.append(Exposure(i, 2 * DAY))  # between the two answers
    for i in range(control_n):
        n = 10_000 + i
        reviews += answers(n, n, i < control_pass)
    return reviews, exposures


def test_too_few_exposed_reviews_says_not_enough() -> None:
    reviews, exposures = build(MIN_EXPOSED - 1, MIN_EXPOSED - 1, 50, 100)
    effect = compare(reviews, exposures)
    assert effect.verdict == "not_enough" and effect.difference is None
    assert effect.exposed == MIN_EXPOSED - 1


def test_remembering_more_after_exposure_is_better() -> None:
    reviews, exposures = build(95, 100, 280, 400)
    effect = compare(reviews, exposures)
    assert effect.verdict == "better"
    assert (effect.exposed, effect.control) == (100, 400)
    assert effect.difference is not None and abs(effect.difference - 0.25) < 1e-9
    assert effect.low is not None and effect.low > 0


def test_remembering_less_after_exposure_is_worse() -> None:
    reviews, exposures = build(50, 100, 360, 400)
    assert compare(reviews, exposures).verdict == "worse"


def test_the_same_rate_is_no_clear_difference() -> None:
    reviews, exposures = build(80, 100, 320, 400)
    effect = compare(reviews, exposures)
    assert effect.verdict == "no_clear_difference"
    assert effect.low is not None and effect.high is not None and effect.low < 0 < effect.high


def test_controls_are_matched_on_the_interval_before_the_review() -> None:
    # Exposed words all sat at 20 days, where everything is remembered 90%. Controls at 2 days are
    # remembered 50%; matching must not compare the exposed ones with them.
    reviews: list[Review] = []
    exposures: list[Exposure] = []
    for i in range(100):
        reviews += answers(i, i, i < 90, last_ivl=20)
        exposures.append(Exposure(i, 2 * DAY))
    for i in range(100):
        reviews += answers(1000 + i, 1000 + i, i < 90, last_ivl=20)
    for i in range(300):
        reviews += answers(5000 + i, 5000 + i, i < 150, last_ivl=2)
    effect = compare(reviews, exposures)
    assert effect.control_rate == 0.9 and effect.difference == 0.0


def test_only_exposure_between_a_cards_two_answers_counts() -> None:
    reviews = answers(1, 1, True, last_ivl=5)
    before = compare(reviews, [Exposure(1, -DAY)])  # read before the previous answer
    after = compare(reviews, [Exposure(1, 6 * DAY)])  # read after this answer
    during = compare(reviews, [Exposure(1, 3 * DAY)])
    assert (before.exposed, after.exposed, during.exposed) == (0, 0, 0)  # no controls to pair with
    both = reviews + answers(2, 2, True, last_ivl=5)
    assert (
        compare(both, [Exposure(1, 3 * DAY)]).exposed
        + compare(both, [Exposure(1, 3 * DAY)]).control
        == 2
    )


def test_answers_before_the_window_and_learning_steps_are_left_out() -> None:
    reviews = answers(1, 1, True) + answers(2, 2, True)
    # A learning step (not a review) and an answer before `since` are never compared.
    learning = [Review(3, 3, 0, True, 0, False), Review(3, 3, 5 * DAY, True, 5, False)]
    effect = compare(reviews + learning, [Exposure(1, 2 * DAY)], since=6 * DAY)
    assert effect.exposed == effect.control == 0


def test_exposures_skip_words_without_a_single_note() -> None:
    found = exposures_of([(5, ["ไป", "หาย", "ดี"])], {"ไป": 1, "ดี": 2})
    assert found == [Exposure(1, 5), Exposure(2, 5)]
