"""Which of the owner's study days a time belongs to, as Anki decides it: in the process's time zone
(`TZ` in server/.env, the one Anki itself uses) and starting at the collection's "Next day starts
at" hour (`rollover`), so a reading at 1 AM still belongs to the day before. The reader's times are
naive UTC (`engine.utc_now`); never cut a day out of one directly, since that's a UTC day."""

from datetime import UTC, date, datetime, timedelta, tzinfo

# Anki's default "Next day starts at", for before the collection has been read.
DEFAULT_ROLLOVER = 4


def study_day(at: datetime, rollover: int = DEFAULT_ROLLOVER, zone: tzinfo | None = None) -> date:
    """The study day naive-UTC `at` falls on. `zone` None is the process's own zone."""
    local = at.replace(tzinfo=UTC).astimezone(zone)
    return (local - timedelta(hours=rollover)).date()


def study_day_start(
    at: datetime, rollover: int = DEFAULT_ROLLOVER, zone: tzinfo | None = None
) -> datetime:
    """When the study day holding naive-UTC `at` began, as naive UTC."""
    day = study_day(at, rollover, zone)
    start = datetime(day.year, day.month, day.day, rollover)
    local = start.replace(tzinfo=zone) if zone is not None else start.astimezone()
    return local.astimezone(UTC).replace(tzinfo=None)
