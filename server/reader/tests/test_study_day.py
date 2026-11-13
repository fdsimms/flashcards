from datetime import date, datetime, timedelta, timezone

from franki_reader.study_day import study_day, study_day_start

BANGKOK = timezone(timedelta(hours=7))


def test_a_study_day_is_the_owners_not_utcs() -> None:
    # 06:30 and 07:30 in Bangkok on the 19th: one study day, though UTC's date changes between them.
    assert study_day(datetime(2026, 10, 18, 23, 30), 4, BANGKOK) == date(2026, 10, 19)
    assert study_day(datetime(2026, 10, 19, 0, 30), 4, BANGKOK) == date(2026, 10, 19)


def test_before_the_rollover_it_is_still_the_day_before() -> None:
    # 03:30 in Bangkok on the 19th, before 4 AM: still the 18th's study day.
    assert study_day(datetime(2026, 10, 18, 20, 30), 4, BANGKOK) == date(2026, 10, 18)
    assert study_day(datetime(2026, 10, 18, 20, 30), 3, BANGKOK) == date(2026, 10, 19)


def test_a_study_day_starts_at_the_rollover_in_the_owners_zone() -> None:
    # 08:00 in Bangkok on the 19th: the day began at 04:00 there, 21:00 UTC on the 18th.
    assert study_day_start(datetime(2026, 10, 19, 1, 0), 4, BANGKOK) == datetime(2026, 10, 18, 21)
    # 02:00 in Bangkok on the 19th: still the 18th's, which began at 04:00 on the 18th.
    assert study_day_start(datetime(2026, 10, 18, 19, 0), 4, BANGKOK) == datetime(2026, 10, 17, 21)
