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
from datetime import UTC, datetime
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
        for name in ("Entry", "Meaning", "Transliteration"):
            models.add_field(model, models.new_field(name))
        template = models.new_template("Recognition")
        template["qfmt"], template["afmt"] = "{{Entry}}", "{{Meaning}}"
        models.add_template(model, template)
        models.add(model)
        self.model = models.by_name("Omnilanguage")

    def add(
        self,
        deck: str,
        entry: str,
        meaning: str,
        ivl: int | None = None,
        due: bool = False,
        translit: str = "",
    ) -> int:
        """A note, its card left new (ivl None) or made a Review card with that interval, due today
        or later."""
        assert self.model is not None
        note = self.col.new_note(self.model)
        note["Entry"], note["Meaning"], note["Transliteration"] = entry, meaning, translit
        self.col.add_note(note, self.deck_id(deck))
        if ivl is not None:
            card = note.cards()[0]
            card.type = card.queue = 2  # type: ignore[assignment]
            card.ivl = ivl
            card.due = self.col.sched.today + (0 if due else ivl)
            self.col.update_card(card)
        return note.id

    def learning(self, deck: str, entry: str, due_in: int, interday: bool = False) -> None:
        """A note whose card is on a learning step: due `due_in` seconds from now within the day
        (queue 1), or today after a step that crossed into a later day (queue 3)."""
        assert self.model is not None
        note = self.col.new_note(self.model)
        note["Entry"], note["Meaning"] = entry, entry
        self.col.add_note(note, self.deck_id(deck))
        card = note.cards()[0]
        card.type = 1  # type: ignore[assignment]
        card.queue = 3 if interday else 1  # type: ignore[assignment]
        card.due = self.col.sched.today if interday else int(time.time()) + due_in
        card.left = 1001
        self.col.update_card(card)

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


def test_a_suspended_leech_is_read_as_unreviewed(desktop: Desktop, deck: AnkiDeck) -> None:
    desktop.add(THAI, "ฉัน", "I; me", ivl=40)
    leech = desktop.add(THAI, "ยาก", "hard", ivl=5, due=True)
    desktop.col.sched.suspend_cards(desktop.col.card_ids_of_note(leech))  # type: ignore[arg-type]
    desktop.sync()

    entries = read(deck)

    assert {t: (e.tier, e.due) for t, e in entries.items()} == {
        "ฉัน": ("mature", False),
        "ยาก": ("unreviewed", False),
    }


def test_reads_each_notes_transliteration(desktop: Desktop, deck: AnkiDeck) -> None:
    desktop.add(THAI, "หนังสือ", "book", ivl=40, translit="nǎng-sǔue")
    desktop.add(THAI, "ไป", "go")
    desktop.sync()

    entries = read(deck)

    assert entries["หนังสือ"].translit == "nǎng-sǔue"
    assert entries["ไป"].translit == ""


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
    leech = desktop.add(THAI, "ยาก", "hard", ivl=5, due=True)
    desktop.col.sched.suspend_cards(desktop.col.card_ids_of_note(leech))  # type: ignore[arg-type]
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


def test_due_counts_reviews_and_learning_as_ankis_deck_list_does(
    desktop: Desktop, deck: AnkiDeck
) -> None:
    desktop.add(THAI, "ฉัน", "I; me", ivl=40, due=True)
    desktop.add(f"{THAI}::Phrases", "ไป", "go", ivl=3, due=True)
    desktop.add(THAI, "ดี", "good", ivl=5)  # not due until later
    desktop.add(SPANISH, "el blindaje", "armor plating", ivl=30, due=True)
    desktop.learning(SPANISH, "la mesa", due_in=-60)
    desktop.learning(SPANISH, "la silla", due_in=0, interday=True)
    # Later today means after the learn-ahead limit and before the study day ends, so place these
    # halfway: a fixed 3 hours falls past the cutoff when the test runs in the day's last hours.
    learn_ahead = 20 * 60
    room = int(desktop.col.sched.day_cutoff - time.time()) - learn_ahead
    if room < 2 * 60:
        pytest.skip("too close to the end of the study day to place a later learning card")
    later = learn_ahead + room // 2
    desktop.learning(SPANISH, "el vaso", due_in=later)
    desktop.learning(SPANISH, "la taza", due_in=later)
    desktop.add(THAI, "ใหม่", "new")  # new cards aren't counted
    desktop.sync()
    tree = desktop.col.sched.deck_due_tree()
    cutoff = desktop.col.sched.day_cutoff

    due = asyncio.run(deck.due())

    names = {d.name: (d.reviews, d.learning) for d in due.decks}
    assert names[THAI] == (2, 0)
    assert names[f"{THAI}::Phrases"] == (1, 0)
    assert names[SPANISH] == (1, 2)
    assert names[THAI.split("::")[0]] == (3, 2)  # the parent both language decks are in
    assert (due.reviews, due.learning) == (
        sum(c.review_count for c in tree.children),
        sum(c.learn_count for c in tree.children),
    )
    assert (due.reviews, due.learning) == (3, 2)
    assert [x.count for x in due.learning_later] in ([2], [1, 1])  # same second, or a tick apart
    assert due.day_ends_at == datetime.fromtimestamp(cutoff, UTC)


def test_reading_whats_due_leaves_nothing_to_send(desktop: Desktop, deck: AnkiDeck) -> None:
    desktop.add(THAI, "ฉัน", "I; me", ivl=40, due=True)
    desktop.learning(THAI, "ดี", due_in=600)
    desktop.sync()
    asyncio.run(deck.due())
    asyncio.run(deck.due())
    db = deck.col.db
    assert db is not None
    for table in ("notes", "cards", "revlog", "graves"):
        assert not db.scalar(f"select count() from {table} where usn = -1"), table


def test_due_counts_each_study_days_answers_and_their_time(
    desktop: Desktop, deck: AnkiDeck
) -> None:
    desktop.add(THAI, "ฉัน", "I; me", ivl=40, due=True)
    desktop.add(THAI, "ดี", "good", ivl=5, due=True)
    desktop.sync()
    col = desktop.col
    cutoff = col.sched.day_cutoff
    card_ids = col.find_cards(f'"deck:{THAI}"')
    db = col.db
    assert db is not None
    # Two answers today (8 and 12 seconds) and one yesterday, as Anki logs them: id in ms.
    today_ms = (cutoff - 3600) * 1000
    rows = [
        (today_ms, card_ids[0], 3, 8000),
        (today_ms + 1, card_ids[1], 1, 12000),
        (today_ms - 86400 * 1000, card_ids[0], 3, 5000),
        (today_ms + 2, card_ids[1], 0, 0),  # a manual reschedule, not an answer
    ]
    for rid, cid, ease, ms in rows:
        db.execute(
            "insert into revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type)"
            " values (?, ?, -1, ?, 1, 1, 2500, ?, 1)",
            rid,
            cid,
            ease,
            ms,
        )
    # Raw rows don't touch the collection's modified stamp, which is what a sync checks for changes.
    db.execute("update col set mod = ?", int(time.time() * 1000))
    desktop.sync()

    days = asyncio.run(deck.due()).study_days

    assert len(days) == 7
    assert days[-1].starts_at == datetime.fromtimestamp(cutoff - 86400, UTC)
    assert (days[-1].cards, days[-1].answer_seconds) == (2, 20)
    assert (days[-2].cards, days[-2].answer_seconds) == (1, 5)
    assert all(d.cards == 0 for d in days[:-2])
