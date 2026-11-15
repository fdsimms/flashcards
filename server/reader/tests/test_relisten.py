from datetime import date, timedelta

from franki_reader.relisten import (
    DEFAULT_LISTENS,
    MAX_AGE_DAYS,
    MAX_OFFERED,
    SCHEDULES,
    Candidate,
    due,
)

TODAY = date(2026, 11, 20)


def read(days_ago: int, listens: int = 0, text_id: int = 1) -> Candidate:
    return Candidate(text_id, TODAY - timedelta(days=days_ago), listens)


def test_a_text_comes_due_the_day_after_it_was_read_then_at_four_and_ten_days() -> None:
    assert SCHEDULES[DEFAULT_LISTENS] == (1, 4, 10)
    assert due([read(0)], TODAY) == []
    assert due([read(1)], TODAY) == [1]
    assert due([read(3, listens=1)], TODAY) == []
    assert due([read(4, listens=1)], TODAY) == [1]
    assert due([read(9, listens=2)], TODAY) == []
    assert due([read(10, listens=2)], TODAY) == [1]


def test_three_listens_finish_a_text() -> None:
    assert due([read(12, listens=3)], TODAY) == []


def test_a_text_not_heard_for_a_month_is_let_go() -> None:
    assert due([read(MAX_AGE_DAYS)], TODAY) == [1]
    assert due([read(MAX_AGE_DAYS + 1)], TODAY) == []


def test_a_late_listen_still_counts_as_the_next_one() -> None:
    # Read 6 days ago and never heard again: its first listen is due, not its second.
    assert due([read(6)], TODAY) == [1]


def test_the_oldest_are_offered_first_and_only_a_few() -> None:
    texts = [read(d, text_id=i) for i, d in enumerate([2, 9, 5, 3, 7], start=1)]
    assert len(due(texts, TODAY)) == MAX_OFFERED
    assert due(texts, TODAY) == [2, 5, 3]


def test_one_listen_comes_a_few_days_on_and_then_the_text_is_finished() -> None:
    assert due([read(1)], TODAY, listens=1) == []
    assert due([read(2)], TODAY, listens=1) == []
    assert due([read(3)], TODAY, listens=1) == [1]
    assert due([read(8, listens=1)], TODAY, listens=1) == []  # heard once: done


def test_no_listens_wanted_offers_nothing() -> None:
    assert due([read(1), read(5, text_id=2)], TODAY, listens=0) == []
