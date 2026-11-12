"""The one door to Anki. Every read of a deck goes through `with_timeout`, so a sync server that
doesn't answer leaves the reader on the last snapshot instead of waiting on it.

Everything above the gateway is written against `ReadDeck` (lexicon.py) and `ReadDue` (below); the
real ones are `AnkiDeck.read` and `AnkiDeck.due` in collection.py, and tests pass fakes.
"""

import asyncio
from collections.abc import Awaitable, Callable

from franki_reader.languages import Language
from franki_reader.lexicon import Entry, ReadDeck
from franki_reader.status import DueStatus

TIMEOUT_SECONDS = 45.0

# What's due in the collection now, after a sync (status.py; `GET /api/status`).
ReadDue = Callable[[], Awaitable[DueStatus]]


class AnkiUnavailable(Exception):
    """The deck couldn't be read in time, or reading it failed. Callers fall back to the last
    snapshot."""


def with_timeout(read: ReadDeck, seconds: float = TIMEOUT_SECONDS) -> ReadDeck:
    async def timed(language: Language) -> list[Entry]:
        try:
            return await asyncio.wait_for(read(language), timeout=seconds)
        except TimeoutError as e:
            raise AnkiUnavailable(
                f"Reading the {language.name} deck took longer than {seconds:g} seconds"
            ) from e
        except AnkiUnavailable:
            raise
        except Exception as e:
            raise AnkiUnavailable(f"Reading the {language.name} deck failed: {e}") from e

    return timed


def due_with_timeout(read: ReadDue, seconds: float = TIMEOUT_SECONDS) -> ReadDue:
    async def timed() -> DueStatus:
        try:
            return await asyncio.wait_for(read(), timeout=seconds)
        except TimeoutError as e:
            raise AnkiUnavailable(
                f"Reading what's due in Anki took longer than {seconds:g} seconds"
            ) from e
        except AnkiUnavailable:
            raise
        except Exception as e:
            raise AnkiUnavailable(f"Reading what's due in Anki failed: {e}") from e

    return timed
