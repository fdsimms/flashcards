"""
The MCP's own copy of the Anki collection, kept in step with the user's Anki sync server.

The MCP is one more Anki client of that server, like Anki on a computer or AnkiMobile: it never
touches the server's files. Before a tool reads, it syncs (unless it synced moments ago); after a
tool changes anything, it syncs again, so the change reaches Franki, AnkiMobile and Anki at their
next sync. All of it runs through Anki's own engine (the `anki` package), so searches, new
notes, scheduling and sync behave exactly as in Anki.

One collection, one tool at a time: the `anki` package isn't safe to use from two threads, so
every call takes a lock and runs in a worker thread.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TypeVar

import anyio
from anki.collection import Collection
from anki.sync_pb2 import SyncCollectionResponse
from mcp.server.mcpserver.exceptions import ToolError

log = logging.getLogger(__name__)
T = TypeVar("T")

Required = SyncCollectionResponse.ChangesRequired


class SyncProblem(ToolError):
    """The collection couldn't be synced; the message says why and what to do (and reaches the model)."""


@dataclass
class SyncSettings:
    endpoint: str
    username: str
    password: str
    # A read within this many seconds of the last sync uses the copy as it is.
    fresh_seconds: float = 10.0


class CollectionManager:
    def __init__(self, folder: Path, sync: SyncSettings | None):
        folder.mkdir(parents=True, exist_ok=True)
        self.path = folder / "collection.anki2"
        self.sync_settings = sync
        self._col: Collection | None = None
        self._auth = None
        self._lock = anyio.Lock()
        self._synced_at = 0.0
        # Changes made here that haven't reached the server yet (a sync after them failed).
        self._unsent = False

    # ---- the collection ----

    @property
    def col(self) -> Collection:
        if self._col is None:
            self._col = Collection(str(self.path))
        return self._col

    def close(self) -> None:
        if self._col is not None:
            self._col.close()
            self._col = None

    async def read(self, fn: Callable[[Collection], T]) -> T:
        """Runs `fn` on an up-to-date collection."""
        async with self._lock:
            await anyio.to_thread.run_sync(self._sync_if_stale)
            return await anyio.to_thread.run_sync(fn, self.col)

    async def write(self, fn: Callable[[Collection], T], *, media: bool = False) -> T:
        """Runs `fn`, which changes the collection, on an up-to-date copy, then syncs the change."""
        async with self._lock:
            await anyio.to_thread.run_sync(self._sync)
            result = await anyio.to_thread.run_sync(fn, self.col)
            self._unsent = True
            try:
                await anyio.to_thread.run_sync(self._sync)
            except SyncProblem as e:
                # The change is made here and goes out with the next sync that works.
                log.warning("change made but not synced yet: %s", e)
            if media:
                await anyio.to_thread.run_sync(self._start_media_sync)
            return result

    async def change_schema(self, fn: Callable[[Collection], T]) -> T:
        """
        Runs `fn`, a change only a full upload can send (a field added to a note type), on an
        up-to-date copy, then uploads the whole collection over the server's. Every other device
        then downloads it. If the upload fails, this copy is thrown away and downloaded again at
        the next call, so it never holds a change the server lacks.
        """
        async with self._lock:
            await anyio.to_thread.run_sync(self._sync)
            result = await anyio.to_thread.run_sync(fn, self.col)
            try:
                await anyio.to_thread.run_sync(self._full_upload)
            except Exception as e:  # noqa: BLE001 - the server unreachable, or refusing the upload
                await anyio.to_thread.run_sync(self._discard)
                raise SyncProblem(f"Couldn't upload the collection to the sync server: {e}. Nothing changed there.") from e
            await anyio.to_thread.run_sync(self._start_media_sync)
            return result

    async def sync_now(self, *, take_server: bool = False) -> str:
        """Syncs now. With `take_server`, a full sync the server asks for is taken as a download
        even when this copy holds changes that never reached it (they're lost)."""
        async with self._lock:
            await anyio.to_thread.run_sync(lambda: self._sync(take_server=take_server))
            await anyio.to_thread.run_sync(self._start_media_sync)
            return "Synced."

    # ---- sync ----

    def _login(self):
        s = self.sync_settings
        if self._auth is None and s is not None:
            try:
                self._auth = self.col.sync_login(s.username, s.password, s.endpoint)
            except Exception as e:  # noqa: BLE001 - Anki raises its own error types
                raise SyncProblem(f"Couldn't sign in to the Anki sync server at {s.endpoint}: {e}") from e
        return self._auth

    def _sync_if_stale(self) -> None:
        if self.sync_settings and time.monotonic() - self._synced_at > self.sync_settings.fresh_seconds:
            self._sync()

    def _sync(self, *, take_server: bool = False) -> None:
        if self.sync_settings is None:
            return
        auth = self._login()
        try:
            out = self.col.sync_collection(auth, False)
        except Exception as e:  # noqa: BLE001
            self._auth = None  # sign in again next time, in case the key was the problem
            raise SyncProblem(f"Couldn't sync with the Anki sync server: {e}") from e
        required = out.required
        if required in (Required.NO_CHANGES, Required.NORMAL_SYNC):
            pass
        elif required == Required.FULL_UPLOAD:
            # The server has no collection: this copy never replaces one on its own.
            raise SyncProblem(
                "The sync server has no collection yet. Sync Anki on your computer with it first "
                "(choosing Upload), then try again."
            )
        else:
            # FULL_DOWNLOAD, or FULL_SYNC (the two have different histories): the server's wins,
            # unless this copy holds changes that never reached it and the caller hasn't said to
            # take the server's anyway.
            if not take_server and self._unsent and self._has_local_changes():
                raise SyncProblem(
                    "The sync server's collection was replaced (a full sync from another device), and "
                    "changes made here haven't reached it. Nothing was overwritten; check the server's "
                    "collection, then run sync_now with take_server=true to replace this copy with the "
                    "server's (the changes made here are lost)."
                )
            self._full_download(auth)
        self._unsent = False
        first = self._synced_at == 0.0
        self._synced_at = time.monotonic()
        if first:
            # Its media copy starts empty: fetch the collection's images and sounds in the background.
            self._start_media_sync()

    def _has_local_changes(self) -> bool:
        db = self.col.db
        return any(db.scalar(f"select 1 from {t} where usn = -1 limit 1") for t in ("notes", "cards", "revlog", "graves"))

    def _full_upload(self) -> None:
        if self.sync_settings is None:
            return
        auth = self._login()
        log.info("uploading the whole collection to the sync server (a schema change)")
        self.col.close_for_full_sync()
        self.col.full_upload_or_download(auth=auth, server_usn=None, upload=True)
        self.col.reopen(after_full_sync=True)
        self._unsent = False
        self._synced_at = time.monotonic()

    def _discard(self) -> None:
        """Throws this copy away; the next sync downloads the server's."""
        self.close()
        for p in self.path.parent.glob(self.path.name + "*"):
            p.unlink(missing_ok=True)
        self._synced_at = 0.0
        self._unsent = False

    def _full_download(self, auth) -> None:
        log.info("downloading the whole collection from the sync server")
        self.col.close_for_full_sync()
        self.col.full_upload_or_download(auth=auth, server_usn=None, upload=False)
        self.col.reopen(after_full_sync=True)

    # ---- media ----

    def _start_media_sync(self) -> None:
        """Starts a media sync, which Anki runs in the background (it can take a while the first
        time, when it downloads every file). Anki keeps track of files not yet sent, so one cut
        short by a restart goes out with the next."""
        if self.sync_settings is None or self._auth is None:
            return
        try:
            self.col.sync_media(self._auth)
        except Exception as e:  # noqa: BLE001 - one already running, or the server unreachable
            log.warning("media sync didn't start: %s", e)

    def wait_for_media(self, timeout: float = 60.0) -> None:
        """For tests: waits until a media sync has finished."""
        deadline = time.monotonic() + timeout
        time.sleep(0.2)
        while time.monotonic() < deadline:
            try:
                if not self.col.media_sync_status().active:
                    return
            except Exception:  # noqa: BLE001 - the last media sync failed
                return
            time.sleep(0.1)
