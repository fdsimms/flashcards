"""WaniKani's vocabulary as known Japanese words (docs/read-and-listen/architecture.md, Languages).
Added on 13 November 2026, by the owner's decision: Japanese counts its deck, its common words and
the words learned in WaniKani.

A word counts once WaniKani has it at Guru or above (SRS stage 5, its own line for "learned"), and
Master or above (stage 7) is listed to the model as well known. The server reads it with
`WANIKANI_TOKEN` (server/.env), a read-only token made in WaniKani's settings, once a day with the
Japanese deck (store.refresh_wanikani_if_stale); a failure keeps the last list, and with no token
Japanese counts its deck and common words only. WaniKani keeps the schedule: nothing here answers
or changes an assignment.

The words go to the checker as known words that aren't deck words (lexicon_from's `extra`), to the
model's word list (`as_entries`), and to the glosses' meanings.
"""

import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx

from franki_reader.lexicon import Entry

log = logging.getLogger(__name__)

API_BASE = "https://api.wanikani.com/v2"
REVISION = "20170710"  # the API revision WaniKani asks clients to name
GURU = 5
MASTER = 7
TIMEOUT_SECONDS = 45.0
_IDS_PER_PAGE = 500  # subject ids asked for in one request, to keep the address short
_MARKS = re.compile(r"[〜～~]")


@dataclass(frozen=True)
class WaniKaniWord:
    subject_id: int
    characters: str  # as WaniKani writes it, 〜 marks dropped (〜中 is 中)
    meaning: str  # its primary meaning
    reading: str  # its primary reading, empty for a kana-only word
    srs_stage: int


class WaniKaniUnavailable(Exception):
    """WaniKani couldn't be read. The last list stays in use."""


# Reads every vocabulary word at Guru or above.
ReadWaniKani = Callable[[], Awaitable[list[WaniKaniWord]]]


def as_entries(words: list[WaniKaniWord]) -> list[Entry]:
    """The words as the model's word list shows them, beside the deck's: M at Master or above, Y
    below. Their ids are negative, so they never meet a note id and sort ahead of the deck's."""
    return [
        Entry(
            note_id=-w.subject_id,
            text=w.characters,
            meaning=w.meaning,
            tier="mature" if w.srs_stage >= MASTER else "young",
            translit=w.reading,
        )
        for w in words
    ]


def parse_subject(resource: dict[str, Any], srs_stage: int) -> WaniKaniWord | None:
    """A vocabulary or kana vocabulary subject, or None for anything else or a malformed one."""
    if resource.get("object") not in ("vocabulary", "kana_vocabulary"):
        return None
    data = resource.get("data") or {}
    characters = _MARKS.sub("", str(data.get("characters") or "")).strip()
    meanings = [m for m in data.get("meanings") or [] if isinstance(m, dict)]
    primary = next((m for m in meanings if m.get("primary")), meanings[0] if meanings else None)
    if not characters or primary is None or not isinstance(resource.get("id"), int):
        return None
    readings = [r for r in data.get("readings") or [] if isinstance(r, dict)]
    reading = next((r for r in readings if r.get("primary")), readings[0] if readings else None)
    return WaniKaniWord(
        subject_id=resource["id"],
        characters=characters,
        meaning=str(primary.get("meaning") or ""),
        reading=str(reading.get("reading") or "") if reading else "",
        srs_stage=srs_stage,
    )


def wanikani_reader(token: str, transport: httpx.AsyncBaseTransport | None = None) -> ReadWaniKani:
    """Reads the learned vocabulary from WaniKani's API. `transport` is for tests."""
    headers = {"Authorization": f"Bearer {token}", "Wanikani-Revision": REVISION}

    async def pages(client: httpx.AsyncClient, url: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        next_url: str | None = url
        while next_url:
            response = await client.get(next_url)
            if response.status_code == 401:
                raise WaniKaniUnavailable("WaniKani refused WANIKANI_TOKEN. Make a new token.")
            response.raise_for_status()
            body = response.json()
            out += [r for r in body.get("data") or [] if isinstance(r, dict)]
            next_url = (body.get("pages") or {}).get("next_url")
        return out

    async def read() -> list[WaniKaniWord]:
        stages = ",".join(str(s) for s in range(GURU, 10))
        try:
            async with httpx.AsyncClient(
                headers=headers, timeout=TIMEOUT_SECONDS, transport=transport
            ) as client:
                assignments = await pages(
                    client,
                    f"{API_BASE}/assignments?subject_types=vocabulary,kana_vocabulary"
                    f"&srs_stages={stages}&hidden=false",
                )
                stage_of = {
                    a["data"]["subject_id"]: a["data"]["srs_stage"]
                    for a in assignments
                    if isinstance(a.get("data"), dict)
                    and isinstance(a["data"].get("subject_id"), int)
                    and isinstance(a["data"].get("srs_stage"), int)
                }
                ids = sorted(stage_of)
                words = []
                for i in range(0, len(ids), _IDS_PER_PAGE):
                    batch = ",".join(str(n) for n in ids[i : i + _IDS_PER_PAGE])
                    for subject in await pages(client, f"{API_BASE}/subjects?ids={batch}"):
                        stage = stage_of.get(subject.get("id"))
                        if stage is not None and (word := parse_subject(subject, stage)):
                            words.append(word)
                return words
        except WaniKaniUnavailable:
            raise
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as e:
            raise WaniKaniUnavailable(f"Reading WaniKani failed: {e}") from e

    return read
