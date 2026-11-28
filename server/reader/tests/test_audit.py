"""Review after the fact: what Claude wrote, read through /api/audit without changing anything."""

import random
import sqlite3
from datetime import timedelta

from fastapi.testclient import TestClient
from scripted import BAD, ENTRIES, IN_RANGE, ScriptedModel
from test_app import AUTH, NOW, next_text, started

from franki_reader import audit, store
from franki_reader.app import create_app
from franki_reader.drills import GapQuestion
from franki_reader.engine import Engine
from franki_reader.sentences import Sentence
from franki_reader.vocab_check import VocabItem

POINT = "th.ever"


def client_with(conn: sqlite3.Connection, model: ScriptedModel | None = None) -> TestClient:
    store.save_snapshot(conn, ENTRIES, NOW)
    model = model or ScriptedModel(IN_RANGE)
    engine = Engine(conn, model.ask_for, None, lambda: NOW, random.Random(1))
    return started(create_app(engine, "open sesame"))


def shown_text(c: TestClient) -> int:
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    return int(next_text(c, topic["id"]).json()["id"])


def test_a_texts_detail_carries_every_answer_asked_about_its_lines_in_line_order() -> None:
    conn = store.connect(":memory:")
    c = client_with(conn)
    text_id = shown_text(c)
    later = NOW + timedelta(minutes=5)
    store.save_explanation(conn, text_id, 1, 1, [{"text": "plain point"}], later)
    store.save_explanation(conn, text_id, 0, 0, [{"text": "full point"}], NOW)
    store.save_naturalness(conn, text_id, 0, {"verdict": "natural"}, later)
    store.save_phrase_explanation(conn, text_id, 0, "อยากกิน", 0, {"meaning": "want to eat"}, NOW)
    store.save_phrase_chat(conn, text_id, 0, "อยากกิน", [{"q": "why?", "a": "because"}], NOW)
    store.save_form_explanation(conn, text_id, 1, "กิน", {"parts": ["base form"]}, NOW)

    asked = c.get(f"/api/audit/texts/{text_id}", headers=AUTH).json()["asked"]

    assert [(a["line"], a["kind"]) for a in asked] == [
        (0, "explain"),
        (0, "phrase"),
        (0, "phrase_chat"),
        (0, "natural"),
        (1, "form"),
        (1, "explain"),
    ]
    assert asked[0]["version"] == "full" and asked[0]["points"] == [{"text": "full point"}]
    assert asked[5]["version"] == "plain"
    assert asked[1]["phrase"] == "อยากกิน" and asked[1]["answer"] == {"meaning": "want to eat"}
    assert asked[2]["turns"] == [{"q": "why?", "a": "because"}]
    assert asked[3]["answer"] == {"verdict": "natural"}
    assert asked[4]["word"] == "กิน"


def test_a_text_nobody_asked_about_has_nothing_asked_and_says_its_floor() -> None:
    c = client_with(store.connect(":memory:"))
    detail = c.get(f"/api/audit/texts/{shown_text(c)}", headers=AUTH).json()
    assert detail["asked"] == []
    assert 0 < detail["floor"] <= 1


def test_dropped_drafts_are_listed_and_read_only_when_asked_for() -> None:
    conn = store.connect(":memory:")
    c = client_with(conn, ScriptedModel(BAD))
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    c.post(f"/api/topics/{topic['id']}/next", headers=AUTH)
    next_text(c, topic["id"])  # waits for the write to give up

    assert c.get("/api/audit/texts", headers=AUTH).json() == []
    dropped = c.get("/api/audit/texts?status=dropped", headers=AUTH).json()
    assert dropped and {t["status"] for t in dropped} == {"dropped"}
    assert all(t["coverage"] < t["floor"] for t in dropped)
    assert c.get("/api/audit/texts?status=all", headers=AUTH).json() == dropped
    detail = c.get(f"/api/audit/texts/{dropped[0]['id']}", headers=AUTH).json()
    assert detail["status"] == "dropped"
    assert c.get("/api/audit/texts?status=lost", headers=AUTH).status_code == 422


def test_a_skipped_text_is_listed_apart_from_the_shown_ones() -> None:
    c = client_with(store.connect(":memory:"))
    text_id = shown_text(c)
    assert c.post(f"/api/texts/{text_id}/skip", headers=AUTH).status_code < 300

    assert c.get("/api/audit/texts", headers=AUTH).json() == []
    [skipped] = c.get("/api/audit/texts?status=skipped", headers=AUTH).json()
    assert skipped["id"] == text_id and skipped["status"] == "skipped"


def made_lesson(conn: sqlite3.Connection) -> int:
    lesson_id = store.add_lesson(conn, "th", "At the market", NOW)
    plan = {
        "title": "Buying fruit",
        "scene": "At the market",
        "phrases": [{"text": "เท่าไหร่", "english": "how much"}],
        "dialogue": [{"speaker": "A", "text": "มะม่วงเท่าไหร่", "english": "How much are mangoes?"}],
    }
    script = {
        "entries": [
            {"kind": "say", "voice": "narrator", "text": "How do you say:", "start": 0, "end": 900},
            {
                "kind": "turn",
                "text": "เท่าไหร่",
                "english": "how much",
                "start": 900,
                "end": 3000,
                "replay": 0,
            },
        ],
        "phrase_clips": [],
    }
    store.finish_lesson(conn, lesson_id, "Buying fruit", plan, 60_000, [(900, 3000)], script)
    store.add_lesson_mark(conn, lesson_id, "เท่าไหร่", "how much", "again", NOW)
    return lesson_id


def test_lessons_are_listed_with_their_marks_and_read_in_full() -> None:
    conn = store.connect(":memory:")
    c = client_with(conn)
    lesson_id = made_lesson(conn)
    failed = store.add_lesson(conn, "pl", "Na poczcie", NOW + timedelta(minutes=1))
    store.fail_lesson(conn, failed, "The plan had too few phrases.")

    listed = c.get("/api/audit/lessons", headers=AUTH).json()
    assert [(row["id"], row["state"], row["marks"]) for row in listed] == [
        (failed, "failed", 0),
        (lesson_id, "ready", 1),
    ]
    assert listed[0]["error"] == "The plan had too few phrases."
    assert [r["id"] for r in c.get("/api/audit/lessons?language=th", headers=AUTH).json()] == [
        lesson_id
    ]

    detail = c.get(f"/api/audit/lessons/{lesson_id}", headers=AUTH).json()
    assert detail["title"] == "Buying fruit"
    assert detail["phrases"] == [{"text": "เท่าไหร่", "english": "how much"}]
    assert detail["dialogue"][0]["english"] == "How much are mangoes?"
    assert [e["kind"] for e in detail["script"]] == ["say", "turn"]
    assert all("replay" not in e for e in detail["script"])
    [mark] = detail["marks"]
    assert mark["reason"] == "again" and mark["reviewed"] is False
    assert c.get("/api/audit/lessons/999", headers=AUTH).status_code == 404


def test_grammar_pages_list_both_kinds_and_read_one_without_writing_anything() -> None:
    conn = store.connect(":memory:")
    c = client_with(conn)
    topic = store.add_grammar_topic(conn, "th", "Two verbs in a row", NOW)
    example = {"line": "ฉันอยากกิน", "english": "I want to eat.", "words": ["อยาก"]}
    store.save_grammar_topic_page(conn, topic.id, "Lead.", "Explanation.", [example])
    store.start_grammar_lesson(conn, POINT, NOW + timedelta(minutes=1))
    store.save_grammar_lesson(conn, POINT, [example, example])

    pages = c.get("/api/audit/grammar?language=th", headers=AUTH).json()
    assert [(p["kind"], p["id"], p["examples"]) for p in pages] == [
        ("point", POINT, 2),
        ("topic", str(topic.id), 1),
    ]
    assert pages[0]["title"].startswith("เคย")
    assert c.get("/api/audit/grammar?language=pl", headers=AUTH).json() == []

    page = c.get(f"/api/audit/grammar/topic/{topic.id}", headers=AUTH).json()
    assert page["lead"] == "Lead." and page["explanation"] == "Explanation."
    assert page["examples"] == [example]
    point = c.get(f"/api/audit/grammar/point/{POINT}", headers=AUTH).json()
    assert point["status"] == "ready" and point["point_note"]
    assert len(point["examples"]) == 2

    # A point with no lesson is a 404 here, never a write started (the app's route would start one).
    assert c.get("/api/audit/grammar/point/th.ongoing", headers=AUTH).status_code == 404
    assert store.get_grammar_lesson(conn, "th.ongoing") is None
    assert c.get("/api/audit/grammar/topic/nope", headers=AUTH).status_code == 404
    assert c.get("/api/audit/grammar/essay/1", headers=AUTH).status_code == 422


def test_practice_items_are_listed_by_kind_with_how_their_batches_went() -> None:
    conn = store.connect(":memory:")
    c = client_with(conn)
    question = GapQuestion(
        "ฉัน", "เคย", "ไปเชียงใหม่", "I have been to Chiang Mai.", ("กำลัง",), "ever"
    )
    store.save_drill_batch(conn, POINT, "th", [question], 3, NOW, 0.01)
    store.save_sentence_batch(
        conn, "th", [Sentence(7, "กิน", "ฉันกินข้าว", "I eat rice.")], 2, NOW, 0.02
    )
    store.save_vocab_batch(conn, "pl", [VocabItem("kot", 120, "cat", ("dog", "cow"))], 4, NOW, 0.03)
    store.save_meaning_batch(
        conn, "th", {"ข้าว": "rice", "แกง": ""}, NOW, 0.04, sentences={"ฉันกินข้าว": {"ข้าว": "rice"}}
    )

    drills = c.get("/api/audit/practice?kind=drill", headers=AUTH).json()
    [item] = drills["items"]
    assert item["line"] == "ฉัน___ไปเชียงใหม่" and item["answer"] == "เคย"
    assert item["wrong"] == ["กำลัง"] and item["served_at"] is None
    assert item["point_name"].startswith("เคย")
    assert drills["batches"] == {"calls": 1, "asked": 3, "kept": 1, "cost_usd": 0.01}
    other_point = c.get("/api/audit/practice?kind=drill&point=th.ongoing", headers=AUTH).json()
    assert other_point["items"] == [] and other_point["batches"]["calls"] == 0

    [sentence] = c.get("/api/audit/practice?kind=sentence", headers=AUTH).json()["items"]
    assert sentence["word"] == "กิน" and sentence["note_id"] == 7

    vocab = c.get("/api/audit/practice?kind=vocab&language=pl", headers=AUTH).json()
    assert vocab["items"][0]["wrong"] == ["dog", "cow"]
    assert vocab["batches"]["asked"] == 4

    meanings = c.get("/api/audit/practice?kind=meaning", headers=AUTH).json()
    assert {(m["word"], m["meaning"]) for m in meanings["items"]} == {("ข้าว", "rice"), ("แกง", "")}
    assert meanings["batches"]["kept"] == 1

    in_sentences = c.get("/api/audit/practice?kind=sentence_meaning", headers=AUTH).json()
    assert in_sentences == {
        "items": [{"language": "th", "sentence": "ฉันกินข้าว", "word": "ข้าว", "meaning": "rice"}],
        "batches": None,
    }

    later = c.get("/api/audit/practice?kind=vocab&days=1", headers=AUTH).json()
    assert len(later["items"]) == 1
    assert c.get("/api/audit/practice?kind=essay", headers=AUTH).status_code == 422
    assert c.get("/api/audit/practice?kind=drill&limit=0", headers=AUTH).status_code == 422


def test_every_audit_route_needs_the_passphrase() -> None:
    c = client_with(store.connect(":memory:"))
    for path in (
        "/api/audit/lessons",
        "/api/audit/lessons/1",
        "/api/audit/grammar",
        "/api/audit/grammar/topic/1",
        "/api/audit/practice?kind=drill",
    ):
        assert c.get(path).status_code == 401, path


def test_practice_refuses_a_kind_it_doesnt_know() -> None:
    conn = store.connect(":memory:")
    try:
        audit.practice(conn, NOW, "essay")
    except ValueError as e:
        assert "essay" in str(e)
    else:
        raise AssertionError("an unknown kind was listed")
