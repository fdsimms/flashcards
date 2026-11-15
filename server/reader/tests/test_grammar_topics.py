"""Your topics: grammar pages written on request, verified in code for vocabulary and format."""

import asyncio
import random
import time
from typing import Any

from fastapi.testclient import TestClient
from scripted import ENTRIES, IN_RANGE, ScriptedModel
from test_app import AUTH, NOW, started

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.generator import Usage
from franki_reader.grammar_topics import (
    MAX_EXAMPLES,
    MAX_TOPICS,
    MAX_WRITES_PER_DAY,
    TOO_FEW,
    Page,
    TopicFailed,
    check_example,
    check_examples,
    request_message,
    write_page,
)
from franki_reader.lexicon import lexicon_from

COST = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")  # $2
CHECKER = lexicon_from(ENTRIES, "th")
LEAD = "Two verbs in a row share one subject."
EXPLANATION = 'Use **กิน** after **อยาก**, "want to eat".\n\nNo particle is needed between them.'


def ex(line: Any = "ฉันอยากกินครับ", words: Any = None, **over: Any) -> dict[str, Any]:
    base = {
        "line": line,
        "english": "I want to eat.",
        "words": ["อยาก"] if words is None else words,
    }
    return {**base, **over}


GOOD = [
    ex("ฉันอยากกินครับ"),
    ex("อยากกินครับ", ["อยากกิน"]),
    ex("ฉันกินครับ", ["กิน"]),
    ex("ฉันอยากกินข้าวเหนียวมะม่วง", ["อยาก", "กิน"]),
]


def page(examples: list[Any] | None = None, **over: Any) -> dict[str, Any]:
    return {
        "lead": LEAD,
        "explanation": EXPLANATION,
        "examples": GOOD if examples is None else examples,
        **over,
    }


# ==== Verification ====


def test_keeps_an_example_in_known_words_with_its_structure_in_order() -> None:
    kept = check_example(ex("ฉันอยากกินครับ", ["อยาก", "กิน"]), CHECKER)
    assert kept == {"line": "ฉันอยากกินครับ", "english": "I want to eat.", "words": ["อยาก", "กิน"]}


def test_drops_examples_that_fail_a_check() -> None:
    assert check_example(ex(words=["กิน", "อยาก"]), CHECKER) is None  # out of order
    assert check_example(ex(words=["ดื่ม"]), CHECKER) is None  # not in the line
    assert check_example(ex(words=[]), CHECKER) is None
    assert check_example(ex("ฉัน|อยากกิน"), CHECKER) is None  # markup
    assert check_example(ex(english="I want — to eat."), CHECKER) is None
    assert check_example(ex(english="I *want* to eat."), CHECKER) is None
    assert check_example(ex("ฉันอยากกินทุเรียนมะละกอครับ", ["อยาก"]), CHECKER) is None  # unknown
    assert check_example("nope", CHECKER) is None
    assert check_example(ex(3), CHECKER) is None


def test_drops_repeated_lines_and_keeps_at_most_six() -> None:
    kept = check_examples([ex(), ex(), ex("อยากกินครับ")], CHECKER)
    assert [k["line"] for k in kept] == ["ฉันอยากกินครับ", "อยากกินครับ"]
    many = [ex(f"ฉันอยากกินครับ{'ครับ' * i}") for i in range(10)]
    assert len(check_examples(many, CHECKER)) == MAX_EXAMPLES


def test_the_request_names_the_topic_and_the_old_examples() -> None:
    first = request_message("th", Page("Serial verbs"), "page")
    assert "Serial verbs" in first and "Thai" in first and "em dashes" in first
    again = request_message("th", Page("Serial verbs", LEAD, EXPLANATION, ("เก่า",)), "examples")
    assert LEAD in again and "เก่า" in again


# ==== The background write ====


class Writer:
    def __init__(self, *answers: dict[str, Any] | Exception) -> None:
        self.answers = list(answers)
        self.calls: list[tuple[str, str, str]] = []

    async def __call__(
        self, entries: Any, language: Any, page: Page, kind: Any
    ) -> tuple[dict[str, Any], Usage]:
        self.calls.append((page.title, kind, page.lead))
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer, COST


def run(conn: Any, writer: Writer, topic_id: int, kind: Any = "page") -> None:
    write_id = store.start_grammar_topic_write(conn, topic_id, "th", NOW)
    asyncio.run(
        write_page(conn, lambda language: (ENTRIES, CHECKER), writer, topic_id, kind, write_id)
    )


def new_topic(conn: Any, title: str = "Serial verbs") -> int:
    return store.add_grammar_topic(conn, "th", title, NOW).id


def test_a_page_is_stored_ready_with_only_the_examples_that_passed() -> None:
    conn = store.connect(":memory:")
    topic_id = new_topic(conn)
    run(conn, Writer(page([*GOOD, ex(words=["ดื่ม"])])), topic_id)
    topic = store.get_grammar_topic(conn, topic_id)
    assert topic is not None and topic.status == "ready" and topic.note is None
    assert (topic.lead, topic.explanation) == (LEAD, EXPLANATION)
    assert [e["line"] for e in topic.examples] == [g["line"] for g in GOOD]


def test_fewer_than_three_examples_left_fails_a_page_never_written() -> None:
    conn = store.connect(":memory:")
    topic_id = new_topic(conn)
    run(conn, Writer(page([GOOD[0], GOOD[1], ex(words=["ดื่ม"])])), topic_id)
    topic = store.get_grammar_topic(conn, topic_id)
    assert topic is not None and topic.status == "failed" and topic.note == TOO_FEW
    assert topic.lead == "" and topic.examples == []


def test_a_bad_lead_or_explanation_fails_the_write() -> None:
    for bad in (
        page(lead="x" * 121),
        page(lead="A — B"),
        page(explanation="An **open word"),
        page(explanation="Dash — here."),
        page(explanation=""),
    ):
        conn = store.connect(":memory:")
        topic_id = new_topic(conn)
        run(conn, Writer(bad), topic_id)
        topic = store.get_grammar_topic(conn, topic_id)
        assert topic is not None and topic.status == "failed" and topic.note


def test_a_call_that_fails_costs_what_it_was_billed_and_keeps_its_message() -> None:
    conn = store.connect(":memory:")
    topic_id = new_topic(conn)
    run(conn, Writer(TopicFailed("Claude didn't answer. Try again in a moment.", COST)), topic_id)
    topic = store.get_grammar_topic(conn, topic_id)
    assert topic is not None and topic.status == "failed"
    assert topic.note == "Claude didn't answer. Try again in a moment."
    assert store.grammar_topic_spending(conn, NOW.replace(year=2020)) == {"th": (1, 2.0)}


def test_a_failed_regeneration_keeps_the_old_page_ready_and_a_success_clears_the_note() -> None:
    conn = store.connect(":memory:")
    topic_id = new_topic(conn)
    run(conn, Writer(page()), topic_id)
    before = store.get_grammar_topic(conn, topic_id)
    run(conn, Writer({"examples": [GOOD[0]]}), topic_id, "examples")
    after = store.get_grammar_topic(conn, topic_id)
    assert before is not None and after is not None
    assert after.status == "ready" and after.note == TOO_FEW
    assert (after.lead, after.explanation, after.examples) == (
        before.lead,
        before.explanation,
        before.examples,
    )
    run(conn, Writer(TopicFailed("Claude didn't answer. Try again in a moment.")), topic_id)
    again = store.get_grammar_topic(conn, topic_id)
    assert again is not None and again.status == "ready" and again.examples == before.examples
    fresh = [ex("ฉันกินครับ", ["กิน"]), ex("อยากกินครับ", ["กิน"]), ex("ฉันอยากกินครับ")]
    writer = Writer({"examples": fresh})
    run(conn, writer, topic_id, "examples")
    done = store.get_grammar_topic(conn, topic_id)
    assert done is not None and done.note is None and len(done.examples) == 3
    assert done.lead == LEAD  # examples alone leave the page's text
    assert writer.calls == [("Serial verbs", "examples", LEAD)]


def test_a_rewrite_replaces_the_text_too() -> None:
    conn = store.connect(":memory:")
    topic_id = new_topic(conn)
    run(conn, Writer(page(), page(lead="New idea.")), topic_id)
    run(conn, Writer(page(lead="New idea.")), topic_id)
    topic = store.get_grammar_topic(conn, topic_id)
    assert topic is not None and topic.lead == "New idea."


# ==== Through the API ====


def topic_client(writer: Writer | None) -> TestClient:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1))
    c = started(create_app(engine, "open sesame", write_topic=writer))
    _CONNS[id(c)] = conn
    return c


def add(c: TestClient, title: str = "Serial verbs", language: str = "th") -> Any:
    return c.post("/api/grammar-topics", json={"language": language, "title": title}, headers=AUTH)


def settled(c: TestClient, topic_id: int) -> dict[str, Any]:
    deadline = time.time() + 10
    while True:
        got = c.get(f"/api/grammar-topics/{topic_id}", headers=AUTH).json()
        if got["status"] != "writing" or time.time() > deadline:
            return got  # type: ignore[no-any-return]
        time.sleep(0.02)


def test_asking_for_a_topic_answers_202_writing_then_the_page_is_ready() -> None:
    writer = Writer(page())
    c = topic_client(writer)
    response = add(c, "  Serial   verbs ")
    assert response.status_code == 202
    body = response.json()
    assert set(body) == {
        "id",
        "language",
        "title",
        "status",
        "note",
        "lead",
        "explanation",
        "examples",
        "created_at",
    }
    assert body["title"] == "Serial verbs" and body["status"] == "writing"
    assert (body["lead"], body["explanation"], body["examples"], body["note"]) == ("", "", [], None)
    assert body["created_at"].endswith("+00:00")
    got = settled(c, body["id"])
    assert got["status"] == "ready" and got["lead"] == LEAD and got["note"] is None
    assert got["examples"][0] == {
        "line": "ฉันอยากกินครับ",
        "english": "I want to eat.",
        "words": ["อยาก"],
    }
    listing = c.get("/api/grammar-topics?language=th", headers=AUTH).json()
    assert listing == {
        "topics": [
            {
                "id": body["id"],
                "title": "Serial verbs",
                "status": "ready",
                "created_at": got["created_at"],
            }
        ]
    }
    assert c.get("/api/grammar-topics?language=es", headers=AUTH).json() == {"topics": []}


def test_the_same_title_returns_the_page_without_another_call() -> None:
    writer = Writer(page())
    c = topic_client(writer)
    first = add(c).json()
    settled(c, first["id"])
    again = add(c, "SERIAL VERBS")
    assert again.status_code == 200 and again.json()["id"] == first["id"]
    assert len(writer.calls) == 1
    other = add(c, "Serial verbs", "es")  # another language's page, so a new one
    assert other.status_code in (202, 503) and other.json().get("id") != first["id"]


def test_listing_is_newest_first_and_needs_the_passphrase() -> None:
    c = topic_client(Writer(page(), page()))
    a, b = add(c, "A").json(), add(c, "B").json()
    settled(c, a["id"])
    settled(c, b["id"])
    titles = [
        t["title"] for t in c.get("/api/grammar-topics?language=th", headers=AUTH).json()["topics"]
    ]
    assert titles == ["B", "A"]
    assert c.get("/api/grammar-topics?language=th").status_code == 401
    assert c.post("/api/grammar-topics", json={"language": "th", "title": "A"}).status_code == 401


def test_a_failed_first_write_is_failed_with_a_note_and_a_rewrite_can_fix_it() -> None:
    writer = Writer(page([GOOD[0]]), page())
    c = topic_client(writer)
    topic_id = add(c).json()["id"]
    got = settled(c, topic_id)
    assert got["status"] == "failed" and got["note"] == TOO_FEW and got["lead"] == ""
    assert c.post(f"/api/grammar-topics/{topic_id}/rewrite", headers=AUTH).status_code == 202
    got = settled(c, topic_id)
    assert got["status"] == "ready" and got["note"] is None and len(got["examples"]) == 4


def test_new_examples_replace_the_old_and_keep_the_text() -> None:
    fresh = [ex("ฉันกินครับ", ["กิน"]), ex("อยากกินครับ", ["กิน"]), ex("ฉันอยากกินครับ")]
    writer = Writer(page(), {"examples": fresh})
    c = topic_client(writer)
    topic_id = add(c).json()["id"]
    settled(c, topic_id)
    response = c.post(f"/api/grammar-topics/{topic_id}/examples", headers=AUTH)
    assert response.status_code == 202
    assert response.json()["status"] == "writing"
    assert response.json()["lead"] == LEAD and response.json()["examples"]  # still shown
    got = settled(c, topic_id)
    assert [e["line"] for e in got["examples"]] == [e["line"] for e in fresh]
    assert got["lead"] == LEAD and got["explanation"] == EXPLANATION
    assert writer.calls[1][1] == "examples"


def test_a_failed_regeneration_over_the_api_leaves_the_old_page() -> None:
    c = topic_client(Writer(page(), {"examples": []}))
    topic_id = add(c).json()["id"]
    old = settled(c, topic_id)
    c.post(f"/api/grammar-topics/{topic_id}/examples", headers=AUTH)
    got = settled(c, topic_id)
    assert got["status"] == "ready" and got["note"] == TOO_FEW
    assert got["examples"] == old["examples"]


def test_a_day_allows_ten_writes_across_pages_then_says_so() -> None:
    writer = Writer(*[page()] * MAX_WRITES_PER_DAY)
    c = topic_client(writer)
    first = add(c, "One").json()["id"]
    settled(c, first)
    second = add(c, "Two").json()["id"]
    settled(c, second)
    for _ in range(MAX_WRITES_PER_DAY - 2):
        assert c.post(f"/api/grammar-topics/{first}/rewrite", headers=AUTH).status_code == 202
        settled(c, first)
    assert len(writer.calls) == MAX_WRITES_PER_DAY
    for blocked in (
        add(c, "Three"),
        c.post(f"/api/grammar-topics/{first}/rewrite", headers=AUTH),
        c.post(f"/api/grammar-topics/{second}/examples", headers=AUTH),
    ):
        assert blocked.status_code == 429 and "today" in blocked.json()["detail"]
    assert len(writer.calls) == MAX_WRITES_PER_DAY
    assert store.count_grammar_topics(_engine_conn(c), "th") == 2


def test_a_language_holds_thirty_topics() -> None:
    writer = Writer(*[page()] * 5)
    c = topic_client(writer)
    # Direct rows, so the cap is tested without thirty writes (and ten a day).
    engine_conn = _engine_conn(c)
    for i in range(MAX_TOPICS):
        store.add_grammar_topic(engine_conn, "th", f"Topic {i}", NOW)
    blocked = add(c, "One more")
    assert blocked.status_code == 409 and "Delete one to add another." in blocked.json()["detail"]
    # An existing title still answers, and another language isn't full.
    assert add(c, "topic 3").status_code == 200
    assert add(c, "One more", "es").status_code == 202
    assert writer.calls[0][0] == "One more"


def _engine_conn(c: TestClient) -> Any:
    return _CONNS[id(c)]


_CONNS: dict[int, Any] = {}


def test_deleting_removes_the_page_and_is_fine_when_it_is_already_gone() -> None:
    c = topic_client(Writer(page()))
    topic_id = add(c).json()["id"]
    settled(c, topic_id)
    assert c.delete(f"/api/grammar-topics/{topic_id}", headers=AUTH).status_code == 204
    assert c.get(f"/api/grammar-topics/{topic_id}", headers=AUTH).status_code == 404
    assert c.delete(f"/api/grammar-topics/{topic_id}", headers=AUTH).status_code == 204
    assert c.post(f"/api/grammar-topics/{topic_id}/rewrite", headers=AUTH).status_code == 404
    assert c.get("/api/grammar-topics?language=th", headers=AUTH).json() == {"topics": []}
    # Its cost stays in the costs.
    assert c.get("/api/costs", headers=AUTH).json()["topics"]["writes"] == 1


def test_without_claude_nothing_is_added() -> None:
    c = topic_client(None)
    response = add(c)
    assert response.status_code == 503 and "write a topic" in response.json()["detail"]
    assert c.get("/api/grammar-topics?language=th", headers=AUTH).json() == {"topics": []}


def test_costs_sum_each_write_failed_ones_included() -> None:
    c = topic_client(Writer(page(), TopicFailed("Claude didn't write this topic.", COST)))
    topic_id = add(c).json()["id"]
    settled(c, topic_id)
    c.post(f"/api/grammar-topics/{topic_id}/rewrite", headers=AUTH)
    settled(c, topic_id)
    assert c.get("/api/costs", headers=AUTH).json()["topics"] == {
        "writes": 2,
        "cost_usd": 4.0,
        "languages": [{"language": "th", "name": "Thai", "writes": 2, "cost_usd": 4.0}],
    }


def test_a_page_left_writing_by_a_restart_is_settled_when_read() -> None:
    c = topic_client(Writer())
    conn = _engine_conn(c)
    topic_id = store.add_grammar_topic(conn, "th", "Stuck", NOW).id
    got = c.get(f"/api/grammar-topics/{topic_id}", headers=AUTH).json()
    assert got["status"] == "failed" and got["note"]
