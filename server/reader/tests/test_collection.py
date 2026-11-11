"""The reader's copy of the collection against a real Anki sync server (`anki.syncserver`, from the
same `anki` package), with Anki itself as the user's computer: the desktop collection here is made
and synced by Anki's own engine, as in server/mcp's tests."""

import asyncio
import os
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from anki.collection import Collection  # first, for the anki package's own imports
from anki.decks import DeckId
from anki.sync_pb2 import SyncCollectionResponse

from franki_reader.collection import AnkiDeck, SyncSettings
from franki_reader.gateway import AnkiUnavailable
from franki_reader.languages import LANGUAGES
from franki_reader.lexicon import Entry

Required = SyncCollectionResponse.ChangesRequired

THAI = LANGUAGES["th"].deck
SPANISH = LANGUAGES["es"].deck


@pytest.fixture
def sync_server(tmp_path: Path) -> Iterator[str]:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = {
        **os.environ,
        "SYNC_USER1": "user:pass",
        "SYNC_BASE": str(tmp_path / "server"),
        "SYNC_HOST": "127.0.0.1",
        "SYNC_PORT": str(port),
    }
    proc = subprocess.Popen(
        [sys.executable, "-m", "anki.syncserver"],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    deadline = time.monotonic() + 15
    while True:
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            break
        except OSError:
            if time.monotonic() > deadline or proc.poll() is not None:
                proc.kill()
                raise RuntimeError("the Anki sync server didn't start") from None
            time.sleep(0.1)
    yield f"http://127.0.0.1:{port}/"
    proc.kill()
    proc.wait()


class Desktop:
    """Anki on the user's computer: Omnilanguage notes in the language decks."""

    def __init__(self, path: Path, url: str) -> None:
        self.col = Collection(str(path))
        self.url = url
        self.auth: Any = None
        models = self.col.models
        model = models.new("Omnilanguage")
        for name in ("Entry", "Meaning"):
            models.add_field(model, models.new_field(name))
        template = models.new_template("Recognition")
        template["qfmt"], template["afmt"] = "{{Entry}}", "{{Meaning}}"
        models.add_template(model, template)
        models.add(model)
        self.model = models.by_name("Omnilanguage")

    def add(
        self, deck: str, entry: str, meaning: str, ivl: int | None = None, due: bool = False
    ) -> int:
        """A note, its card left new (ivl None) or made a Review card with that interval, due today
        or later."""
        assert self.model is not None
        note = self.col.new_note(self.model)
        note["Entry"], note["Meaning"] = entry, meaning
        self.col.add_note(note, self.deck_id(deck))
        if ivl is not None:
            card = note.cards()[0]
            card.type = card.queue = 2  # type: ignore[assignment]
            card.ivl = ivl
            card.due = self.col.sched.today + (0 if due else ivl)
            self.col.update_card(card)
        return note.id

    def deck_id(self, name: str) -> DeckId:
        did = self.col.decks.id(name)
        assert did is not None
        return did

    def sync(self) -> None:
        if self.auth is None:
            self.auth = self.col.sync_login("user", "pass", self.url)
        out = self.col.sync_collection(self.auth, False)
        if out.required in (Required.FULL_UPLOAD, Required.FULL_SYNC):
            self.col.close_for_full_sync()
            self.col.full_upload_or_download(auth=self.auth, server_usn=None, upload=True)
            self.col.reopen(after_full_sync=True)

    def close(self) -> None:
        self.col.close()


@pytest.fixture
def desktop(sync_server: str, tmp_path: Path) -> Iterator[Desktop]:
    d = Desktop(tmp_path / "desktop.anki2", sync_server)
    yield d
    d.close()


@pytest.fixture
def deck(sync_server: str, tmp_path: Path) -> Iterator[AnkiDeck]:
    d = AnkiDeck(tmp_path / "reader", SyncSettings(sync_server, "user", "pass"))
    yield d
    d.close()


def read(deck: AnkiDeck, code: str = "th") -> dict[str, Entry]:
    return {e.text: e for e in asyncio.run(deck.read(LANGUAGES[code]))}  # type: ignore[index]


def test_reads_the_thai_deck_with_each_notes_tier(desktop: Desktop, deck: AnkiDeck) -> None:
    desktop.add(THAI, "ฉัน", "I; <b>me</b>", ivl=40)
    desktop.add(THAI, "ดี", "good", ivl=5, due=True)
    desktop.add(THAI, "ไป", "go")
    desktop.add(f"{THAI}::🏛 Consonant Classes", "ก", "mid class", ivl=100)
    desktop.add(SPANISH, "el blindaje", "armor plating", ivl=30)
    desktop.sync()

    entries = read(deck)

    assert {t: (e.meaning, e.tier, e.due) for t, e in entries.items()} == {
        "ฉัน": ("I; me", "mature", False),
        "ดี": ("good", "young", True),
        "ไป": ("go", "unreviewed", False),
    }


def test_reads_the_spanish_deck(desktop: Desktop, deck: AnkiDeck) -> None:
    desktop.add(THAI, "ฉัน", "I; me", ivl=40)
    desktop.add(SPANISH, "el blindaje", "armor plating", ivl=30)
    desktop.sync()
    assert list(read(deck, "es")) == ["el blindaje"]


def test_a_note_of_another_type_is_skipped(desktop: Desktop, deck: AnkiDeck) -> None:
    desktop.add(THAI, "ฉัน", "I; me", ivl=40)
    basic = desktop.col.models.by_name("Basic")
    assert basic is not None
    note = desktop.col.new_note(basic)
    note["Front"], note["Back"] = "front", "back"
    desktop.col.add_note(note, desktop.deck_id(THAI))
    desktop.sync()
    assert list(read(deck)) == ["ฉัน"]


def test_a_change_on_another_device_shows_at_the_next_read(
    desktop: Desktop, deck: AnkiDeck
) -> None:
    desktop.add(THAI, "ฉัน", "I; me", ivl=40)
    desktop.sync()
    assert list(read(deck)) == ["ฉัน"]

    desktop.add(THAI, "ดี", "good", ivl=3)
    desktop.sync()

    assert read(deck)["ดี"].tier == "young"


def test_takes_the_servers_copy_after_a_full_sync(desktop: Desktop, deck: AnkiDeck) -> None:
    desktop.add(THAI, "ฉัน", "I; me", ivl=40)
    desktop.sync()
    assert list(read(deck)) == ["ฉัน"]

    # A change Anki can't merge (a note type's fields), so the computer uploads the whole collection.
    desktop.col.mod_schema(check=False)
    desktop.add(THAI, "ดี", "good", ivl=40)
    desktop.sync()

    assert sorted(read(deck)) == sorted(["ฉัน", "ดี"])


def test_a_read_leaves_nothing_to_send(desktop: Desktop, deck: AnkiDeck) -> None:
    """Read & Listen never grades or adds cards: after a read, the reader's copy holds nothing a sync
    would send to the server."""
    desktop.add(THAI, "ฉัน", "I; me", ivl=40, due=True)
    desktop.sync()
    read(deck)
    read(deck)
    db = deck.col.db
    assert db is not None
    for table in ("notes", "cards", "revlog", "graves"):
        assert not db.scalar(f"select count() from {table} where usn = -1"), table


def test_a_server_with_no_collection_reads_no_notes(deck: AnkiDeck) -> None:
    # The snapshot then keeps the one it had (store.refresh_if_stale).
    assert read(deck) == {}


def test_a_wrong_password_says_it_could_not_sign_in(
    desktop: Desktop, sync_server: str, tmp_path: Path
) -> None:
    desktop.add(THAI, "ฉัน", "I; me", ivl=40)
    desktop.sync()
    wrong = AnkiDeck(tmp_path / "wrong", SyncSettings(sync_server, "user", "nope"))
    try:
        with pytest.raises(AnkiUnavailable, match="Couldn't sign in"):
            read(wrong)
    finally:
        wrong.close()
