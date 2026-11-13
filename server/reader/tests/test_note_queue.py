"""The note queue: the checks on what Claude fills in, the passes that fill and retry, and its endpoints."""

import asyncio
import random
import sqlite3
from datetime import datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from test_app import AUTH, started

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.generator import Usage
from franki_reader.note_queue import (
    BATCH,
    MAX_ATTEMPTS,
    RETRY_AFTER,
    FillFailed,
    check,
    fill_pending,
    request_message,
)

NOW = datetime(2026, 11, 13, 9, 0)
DECK = "Languages::Français"
COST = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")  # $2.00


def filled(entry: str, **over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "entry": entry,
        "meaning": "to snigger",
        "context": f"Il <b>{entry}</b> dans son coin.",
        "translation": "He sniggers in his corner.",
        "romanization": "",
        "transliteration": "",
        "register": "",
    }
    return {**base, **over}


class Writer:
    """Answers each call with `answer(language, asked)`, or raises what it's given."""

    def __init__(self, answer: Any = None, fail: str | None = None) -> None:
        self.answer = answer or (lambda language, asked: [filled(e) for e, _ in asked])
        self.fail = fail
        self.calls: list[tuple[str, list[tuple[str, str]]]] = []

    async def __call__(self, language: Any, asked: list[tuple[str, str]]) -> Any:
        self.calls.append((language, asked))
        if self.fail:
            raise FillFailed(self.fail)
        return self.answer(language, asked), COST


def conn_with(*entries: tuple[str, str], language: Any = "fr") -> sqlite3.Connection:
    conn = store.connect(":memory:")
    store.add_queued(conn, language, DECK, list(entries), NOW)
    return conn


# ---- the checks ----


def test_a_good_answer_gives_the_fields_by_their_anki_names() -> None:
    assert check(filled("ricane"), {"ricane": ""}, "fr") == (
        "ricane",
        {
            "Meaning": "to snigger",
            "Context": "Il <b>ricane</b> dans son coin.",
            "ContextTranslation": "He sniggers in his corner.",
        },
    )


def test_the_owners_meaning_is_kept() -> None:
    got = check(filled("ricane"), {"ricane": "sniggers"}, "fr")
    assert got is not None and got[1]["Meaning"] == "sniggers"


def test_a_register_is_kept_lowercase_and_left_out_when_empty() -> None:
    got = check(filled("ricane", register="Informal"), {"ricane": ""}, "fr")
    assert got is not None and got[1]["Register"] == "informal"


def test_a_word_that_wasnt_asked_for_is_dropped() -> None:
    assert check(filled("autre"), {"ricane": ""}, "fr") is None
    assert check("ricane", {"ricane": ""}, "fr") is None


def test_the_sentence_needs_the_word_in_bold() -> None:
    assert check(filled("ricane", context="Il ricane."), {"ricane": ""}, "fr") is None
    assert check(filled("ricane", context="Il <b>ricane dans."), {"ricane": ""}, "fr") is None


def test_other_markup_and_stray_characters_are_refused() -> None:
    asked = {"ricane": ""}
    assert check(filled("ricane", context="Il <i><b>ricane</b></i>."), asked, "fr") is None
    assert check(filled("ricane", translation="He <b>sniggers</b>."), asked, "fr") is None
    assert check(filled("ricane", translation="He sniggers | laughs."), asked, "fr") is None
    assert check(filled("ricane", translation="He sniggers — quietly."), asked, "fr") is None


def test_a_missing_field_fails_the_word() -> None:
    assert check(filled("ricane", translation=""), {"ricane": ""}, "fr") is None
    assert check(filled("ricane", meaning=""), {"ricane": ""}, "fr") is None
    # Unless the owner gave the meaning.
    assert check(filled("ricane", meaning=""), {"ricane": "sniggers"}, "fr") is not None


def test_romanized_languages_need_both_romanizations() -> None:
    asked = {"ขอบคุณ": ""}
    thai = filled("ขอบคุณ", romanization="khɔ̀ɔp khun mâak", transliteration="khɔ̀ɔp khun")
    got = check(thai, asked, "th")
    assert got is not None
    assert got[1]["ContextRomanized"] == "khɔ̀ɔp khun mâak"
    assert got[1]["Transliteration"] == "khɔ̀ɔp khun"
    assert check(filled("ขอบคุณ"), asked, "th") is None
    # Latin-letter languages never carry them, even if Claude wrote some.
    latin = check(filled("ricane", romanization="x", transliteration="y"), {"ricane": ""}, "fr")
    assert latin is not None and "ContextRomanized" not in latin[1]


def test_a_japanese_word_gets_its_reading_in_kana_reading() -> None:
    asked = {"劇団": ""}
    got = check(filled("劇団", transliteration="げきだん", romanization="x"), asked, "ja")
    assert got is not None
    assert got[1]["KanaReading"] == "げきだん"
    assert "Transliteration" not in got[1] and "ContextRomanized" not in got[1]
    # Katakana is a reading too; kanji, Latin letters or none at all aren't.
    assert check(filled("劇団", transliteration="コーヒー"), asked, "ja") is not None
    assert check(filled("劇団", transliteration="げき団"), asked, "ja") is None
    assert check(filled("劇団", transliteration="gekidan"), asked, "ja") is None
    assert check(filled("劇団"), asked, "ja") is None
    assert "reading in hiragana" in request_message("ja", [("劇団", "")])


def test_the_request_lists_entries_with_the_owners_meanings() -> None:
    message = request_message("fr", [("ricane", ""), ("bouder", "to sulk")])
    assert "1. ricane\n" in message
    assert "2. bouder (the learner's meaning: to sulk)" in message


# ---- the passes ----


def run(conn: sqlite3.Connection, writer: Writer, now: datetime = NOW) -> int:
    return asyncio.run(fill_pending(conn, writer, lambda: now))


def test_waiting_words_become_ready_with_their_fields_and_share_the_cost() -> None:
    conn = conn_with(("ricane", ""), ("bouder", "to sulk"))
    writer = Writer()
    assert run(conn, writer) == 2
    assert len(writer.calls) == 1  # one call for the batch, not one a word
    a, b = store.queued_notes(conn)
    assert (a.state, a.fields["Meaning"]) == ("ready", "to snigger")
    assert (b.state, b.fields["Meaning"]) == ("ready", "to sulk")
    assert store.queue_spending(conn, NOW - timedelta(days=1)) == {"fr": (2, 2.0)}


def test_words_go_a_language_and_a_batch_at_a_time() -> None:
    conn = store.connect(":memory:")
    store.add_queued(conn, "fr", DECK, [(f"mot{i}", "") for i in range(BATCH + 1)], NOW)
    store.add_queued(conn, "pl", "Languages::Polski", [("odpuścić", "")], NOW)
    writer = Writer()
    assert run(conn, writer) == BATCH + 2
    assert [(lang, len(asked)) for lang, asked in writer.calls] == [
        ("fr", BATCH),
        ("fr", 1),
        ("pl", 1),
    ]


def test_the_same_word_queued_twice_is_asked_for_once() -> None:
    conn = conn_with(("ricane", ""), ("ricane", "sniggers"))
    writer = Writer()
    assert run(conn, writer) == 2
    assert len(writer.calls[0][1]) == 1
    first, second = store.queued_notes(conn)
    assert (first.fields["Meaning"], second.fields["Meaning"]) == ("to snigger", "sniggers")


def test_a_word_that_fails_the_checks_is_failed_with_a_reason_and_the_rest_are_kept() -> None:
    conn = conn_with(("ricane", ""), ("bouder", ""))
    writer = Writer(lambda lang, asked: [filled("ricane"), filled("bouder", context="Il boude.")])
    assert run(conn, writer) == 1
    ricane, bouder = store.queued_notes(conn)
    assert ricane.state == "ready"
    assert bouder.state == "failed" and "didn't pass the checks" in bouder.error


def test_a_failed_call_fails_its_words_without_ending_the_pass() -> None:
    conn = conn_with(("ricane", ""))
    writer = Writer(fail="Claude didn't answer (APIError).")
    assert run(conn, writer) == 0
    (note,) = store.queued_notes(conn)
    assert (note.state, note.attempts, note.error) == (
        "failed",
        1,
        "Claude didn't answer (APIError).",
    )
    assert len(writer.calls) == 1  # not asked again within the same pass


def test_a_failed_word_waits_then_is_tried_again_up_to_the_limit() -> None:
    conn = conn_with(("ricane", ""))
    failing = Writer(fail="no")
    run(conn, failing)
    run(conn, failing, NOW + RETRY_AFTER - timedelta(seconds=1))
    assert len(failing.calls) == 1  # still waiting
    later = NOW
    for _ in range(MAX_ATTEMPTS - 1):
        later += RETRY_AFTER
        run(conn, failing, later)
    assert len(failing.calls) == MAX_ATTEMPTS
    run(conn, Writer(), later + RETRY_AFTER)  # out of tries: stays failed
    assert store.queued_notes(conn)[0].state == "failed"


def test_a_retry_after_failing_fills_the_word() -> None:
    conn = conn_with(("ricane", ""))
    run(conn, Writer(fail="no"))
    assert run(conn, Writer(), NOW + RETRY_AFTER) == 1
    assert store.queued_notes(conn)[0].state == "ready"


def test_a_ready_word_is_not_asked_for_again() -> None:
    conn = conn_with(("ricane", ""))
    run(conn, Writer())
    writer = Writer()
    assert run(conn, writer, NOW + timedelta(days=1)) == 0
    assert writer.calls == []


# ---- the endpoints ----


def queue_client(writer: Writer | None) -> TestClient:
    conn = store.connect(":memory:")
    now = [NOW]
    engine = Engine(conn, None, None, lambda: now[0], random.Random(1))
    c = started(create_app(engine, "open sesame", write_notes=writer))
    c.conn = conn  # type: ignore[attr-defined]
    c.now = now  # type: ignore[attr-defined]
    return c


def add(c: TestClient, *entries: dict[str, str], language: str = "fr") -> Any:
    return c.post(
        "/api/note-queue",
        headers=AUTH,
        json={"language": language, "deck": DECK, "entries": list(entries)},
    )


def items(c: TestClient) -> list[dict[str, Any]]:
    return c.get("/api/note-queue", headers=AUTH).json()["items"]  # type: ignore[no-any-return]


def test_queueing_a_word_returns_it_waiting_and_the_next_ask_has_it_ready() -> None:
    c = queue_client(Writer())
    r = add(c, {"entry": "ricane"}, {"entry": "bouder", "meaning": "to sulk"})
    assert r.status_code == 202
    assert [(i["entry"], i["state"]) for i in r.json()["items"]] == [
        ("ricane", "waiting"),
        ("bouder", "waiting"),
    ]
    got = items(c)
    assert [i["state"] for i in got] == ["ready", "ready"]
    assert got[0]["deck"] == DECK
    assert got[0]["fields"]["Context"] == "Il <b>ricane</b> dans son coin."
    assert got[1]["fields"]["Meaning"] == "to sulk"


def test_entries_are_trimmed_and_repeats_in_one_request_are_dropped() -> None:
    c = queue_client(Writer())
    r = add(c, {"entry": "  ricane  "}, {"entry": "ricane"}, {"entry": "   "})
    assert [i["entry"] for i in r.json()["items"]] == ["ricane"]


def test_nothing_to_queue_is_refused() -> None:
    c = queue_client(Writer())
    assert add(c, {"entry": "   "}).status_code == 422
    assert add(c).status_code == 422


def test_without_claude_the_queue_refuses_with_the_reason() -> None:
    c = queue_client(None)
    r = add(c, {"entry": "ricane"})
    assert r.status_code == 503 and "isn't set up" in r.json()["detail"]
    assert c.get("/api/note-queue", headers=AUTH).json() == {"available": False, "items": []}


def test_a_word_that_failed_can_be_retried_and_a_missing_one_is_a_404() -> None:
    c = queue_client(Writer(fail="Claude didn't answer."))
    add(c, {"entry": "ricane"})
    (failed,) = items(c)
    assert (failed["state"], failed["error"]) == ("failed", "Claude didn't answer.")
    c.post(f"/api/note-queue/{failed['id']}/retry", headers=AUTH)
    assert c.post("/api/note-queue/999/retry", headers=AUTH).status_code == 404


def test_a_word_comes_off_the_queue_and_removing_it_twice_is_fine() -> None:
    c = queue_client(Writer())
    add(c, {"entry": "ricane"})
    (note,) = items(c)
    assert c.delete(f"/api/note-queue/{note['id']}", headers=AUTH).status_code == 204
    assert c.delete(f"/api/note-queue/{note['id']}", headers=AUTH).status_code == 204
    assert items(c) == []


def test_a_restart_with_words_still_waiting_fills_them_on_the_next_ask() -> None:
    c = queue_client(Writer())
    store.add_queued(c.conn, "fr", DECK, [("ricane", "")], NOW)  # type: ignore[attr-defined]
    assert items(c)[0]["state"] == "waiting"  # this ask starts the pass
    assert items(c)[0]["state"] == "ready"


def test_the_queue_needs_the_passphrase() -> None:
    c = queue_client(Writer())
    assert c.get("/api/note-queue").status_code in (401, 403)
    assert c.post("/api/note-queue", json={}).status_code in (401, 403)
    assert c.delete("/api/note-queue/1").status_code in (401, 403)


def test_the_costs_report_the_queue() -> None:
    c = queue_client(Writer())
    add(c, {"entry": "ricane"}, {"entry": "bouder"})
    items(c)
    block = c.get("/api/costs", headers=AUTH).json()["note_queue"]
    assert block["notes"] == 2 and block["cost_usd"] == 2.0
    assert block["languages"] == [{"language": "fr", "name": "French", "notes": 2, "cost_usd": 2.0}]
