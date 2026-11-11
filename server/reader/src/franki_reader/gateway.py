"""The one door to Anki. Every read of a deck goes through `with_timeout`, so a sync server that
doesn't answer leaves the reader on the last snapshot instead of waiting on it.

Everything above the gateway is written against `ReadDeck` (lexicon.py); the real one is
`AnkiDeck.read` in collection.py, and tests pass fakes.
"""

import asyncio

from franki_reader.languages import Language
from franki_reader.lexicon import Entry, ReadDeck

TIMEOUT_SECONDS = 45.0


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
