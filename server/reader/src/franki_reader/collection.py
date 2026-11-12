"""The reader's own copy of the Anki collection, kept in step with the user's Anki sync server.

Like the MCP (server/mcp), the reader is one more Anki client of that server, through Anki's own
engine (the `anki` package), and never touches the server's files. Unlike the MCP it only reads:
nothing here changes the collection, so a normal sync only ever brings the server's changes down,
and when the server asks for a full sync, taking the server's copy can't lose anything. No media is
synced, since the lexicon is text.

Read & Listen never grades or adds cards (CLAUDE.md, Read & Listen), so nothing here may write to
the collection; `tests/test_collection.py` checks a read leaves nothing to send.

The `anki` package isn't safe to use from two threads, so every read runs in a worker thread under
a thread lock. That lock (not an asyncio one) is what keeps a read whose caller gave up
(`with_timeout`) from overlapping the next one: the worker still holds it until it finishes.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from anki.collection import Collection
from anki.sync_pb2 import SyncCollectionResponse
from anki.utils import ids2str

from franki_reader.gateway import AnkiUnavailable
from franki_reader.languages import Language
from franki_reader.lexicon import CardRow, Entry, NoteRow, build_entries
from franki_reader.status import DueStatus, read_due

log = logging.getLogger(__name__)

Required = SyncCollectionResponse.ChangesRequired

ENTRY_FIELD = "Entry"
MEANING_FIELD = "Meaning"
TRANSLIT_FIELD = "Transliteration"


@dataclass(frozen=True)
class SyncSettings:
    endpoint: str
    username: str
    password: str


class AnkiDeck:
    def __init__(self, folder: Path, sync: SyncSettings) -> None:
        folder.mkdir(parents=True, exist_ok=True)
        self.path = folder / "collection.anki2"
        self.sync_settings = sync
        self._col: Collection | None = None
        self._auth: Any = None
        self._lock = threading.Lock()

    @property
    def col(self) -> Collection:
        if self._col is None:
            self._col = Collection(str(self.path))
        return self._col

    def close(self) -> None:
        with self._lock:
            if self._col is not None:
                self._col.close()
                self._col = None

    async def read(self, language: Language) -> list[Entry]:
        """Syncs, then reads one language's deck. This is lexicon.ReadDeck."""
        return await asyncio.to_thread(self._read, language)

    def _read(self, language: Language) -> list[Entry]:
        with self._lock:
            self._sync()
            return read_entries(self.col, language)

    async def due(self) -> DueStatus:
        """Syncs, then reads what's due now (status.py). This is gateway.ReadDue."""
        return await asyncio.to_thread(self._due)

    def _due(self) -> DueStatus:
        with self._lock:
            self._sync()
            return read_due(self.col, int(time.time()))

    # ---- sync ----

    def _login(self) -> Any:
        s = self.sync_settings
        if self._auth is None:
            try:
                self._auth = self.col.sync_login(s.username, s.password, s.endpoint)
            except Exception as e:  # Anki raises its own error types
                raise AnkiUnavailable(
                    f"Couldn't sign in to the Anki sync server at {s.endpoint}: {e}"
                ) from e
        return self._auth

    def _sync(self) -> None:
        auth = self._login()
        try:
            out = self.col.sync_collection(auth, False)
        except Exception as e:
            self._auth = None  # sign in again next time, in case the key was the problem
            raise AnkiUnavailable(f"Couldn't sync with the Anki sync server: {e}") from e
        required = out.required
        if required in (Required.NO_CHANGES, Required.NORMAL_SYNC):
            return
        if required == Required.FULL_UPLOAD:
            # The server has no collection, or this copy is the only one: the reader never uploads.
            raise AnkiUnavailable(
                "The Anki sync server has no collection yet. Sync Anki on your computer with it "
                "first (choosing Upload)."
            )
        # FULL_DOWNLOAD, or FULL_SYNC (the two have different histories). The reader never changes
        # the collection, so the server's copy always wins.
        log.info("downloading the whole collection from the sync server")
        try:
            self.col.close_for_full_sync()
            self.col.full_upload_or_download(auth=auth, server_usn=None, upload=False)
        except Exception as e:
            raise AnkiUnavailable(
                f"Couldn't download the collection from the sync server: {e}"
            ) from e
        finally:
            self.col.reopen(after_full_sync=True)


def read_entries(col: Collection, language: Language) -> list[Entry]:
    """Every note in the language's query with its Entry, Meaning and Transliteration, and its
    cards' state."""
    note_ids = list(col.find_notes(language.notes_query))
    notes = []
    for nid in note_ids:
        fields = dict(col.get_note(nid).items())
        if ENTRY_FIELD not in fields:
            continue  # another note type in the deck
        notes.append(
            NoteRow(
                nid,
                fields[ENTRY_FIELD],
                fields.get(MEANING_FIELD, ""),
                fields.get(TRANSLIT_FIELD, ""),
            )
        )
    if not notes:
        return []
    due = set(col.find_cards(f"({language.notes_query}) is:due"))
    assert col.db is not None  # open: find_notes just used it
    rows = col.db.all(
        f"select id, nid, type, ivl from cards where nid in {ids2str(n.note_id for n in notes)}"
    )
    cards = [CardRow(nid, card_type, ivl, cid in due) for cid, nid, card_type, ivl in rows]
    return build_entries(notes, cards)
