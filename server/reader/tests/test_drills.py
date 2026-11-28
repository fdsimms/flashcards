"""Grammar drills: checking the questions Claude writes, keeping a stock, and lines from texts read."""

import asyncio
import random
from datetime import datetime, timedelta
from typing import Any

import pytest
from test_exposure import connect, read, write
from test_generator import FakeClient, finish, response
from test_grammar import ES

from franki_reader import store
from franki_reader.drills import (
    BATCH,
    BATCHES_PER_DAY,
    STOCK,
    DrillsFailed,
    GapQuestion,
    check,
    claude_drills,
    request_message,
    rivals_of,
    serve,
    top_up,
    which_questions,
    with_rivals,
)
from franki_reader.generator import Usage
from franki_reader.grammar import POINTS

NOW = datetime(2026, 11, 12, 9, 0)
PRETERITE = POINTS["es.preterite"]


def q(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "before": "Ayer ",
        "answer": "fuimos",
        "after": " al mercado con Ana.",
        "english": "Yesterday we went to the market with Ana.",
        "wrong": ["íbamos", "vamos", "iremos"],
        "hint": "ir, nosotros",
    }
    return {**base, **over}


def test_keeps_a_question_the_code_agrees_with() -> None:
    kept = check(q(), PRETERITE, ES)
    assert kept is not None
    assert (kept.before, kept.answer, kept.after) == ("Ayer ", "fuimos", " al mercado con Ana.")
    assert kept.wrong == ("íbamos", "vamos", "iremos") and kept.hint == "ir, nosotros"


def test_drops_an_answer_that_isnt_the_point() -> None:
    assert check(q(answer="íbamos", wrong=["fuimos", "vamos", "iremos"]), PRETERITE, ES) is None
    # Ambiguous with the present, so the finder doesn't count it: dropped, not guessed.
    assert check(q(answer="hablamos", after=" con Ana."), PRETERITE, ES) is None


def test_drops_a_question_whose_wrong_choice_is_also_the_point() -> None:
    assert check(q(wrong=["fue", "vamos", "iremos"]), PRETERITE, ES) is None


def test_drops_a_question_with_too_many_unknown_words() -> None:
    assert check(q(after=" al zarandajas con embolsamos."), PRETERITE, ES) is None


def test_drops_malformed_questions() -> None:
    assert check("nope", PRETERITE, ES) is None
    assert check(q(wrong=["íbamos", "íbamos", "vamos"]), PRETERITE, ES) is None  # two left
    assert check(q(wrong=["íbamos", "fuimos", "vamos"]), PRETERITE, ES) is None  # one is the answer
    assert check(q(answer=" "), PRETERITE, ES) is None
    assert check(q(english="Yesterday — we went."), PRETERITE, ES) is None
    assert check(q(before="Ayer|"), PRETERITE, ES) is None
    assert check(q(hint=3), PRETERITE, ES) is None


def test_the_request_names_the_point_and_how_to_write_it() -> None:
    spanish = request_message("es", PRETERITE, 12)
    assert "12 practice questions" in spanish and "Spanish" in spanish and "Preterite" in spanish
    assert "spaces included" in spanish
    assert "no spaces between words" in request_message("th", POINTS["th.ever"], 3)
    assert "the way an ordinary person talks, not the way a textbook puts it" in spanish
    # The English shows only after answering, so the sentence itself must rule the rivals out.
    assert "answers before seeing the English" in spanish
    assert "must not make a grammatical sentence with another meaning" in spanish


class Writer:
    def __init__(self, *batches: list[Any] | Exception) -> None:
        self.batches = list(batches)
        self.calls: list[tuple[str, int]] = []

    async def __call__(
        self, entries: Any, language: Any, point: Any, count: int
    ) -> tuple[list[Any], Usage]:
        self.calls.append((point.id, count))
        batch = self.batches.pop(0)
        if isinstance(batch, Exception):
            raise batch
        return batch, Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")


def run_top_up(conn: Any, writer: Writer, *point_ids: str, at: datetime = NOW) -> None:
    asyncio.run(
        top_up(conn, lambda language: ([], ES), writer, point_ids, lambda: at, writing=set())
    )


def test_tops_up_a_point_keeping_only_questions_that_pass() -> None:
    conn = connect()
    writer = Writer([q(), q(answer="íbamos"), q(before="Hoy ", after=" a casa.")])
    run_top_up(conn, writer, "es.preterite", "es.nope")
    assert writer.calls == [("es.preterite", BATCH)]
    assert store.drill_stock(conn, "es.preterite") == 2
    spent = store.drill_spending(conn, NOW - timedelta(days=1))
    assert spent == {"es": (1, 2.0)}  # one batch, its million input tokens


def test_a_full_stock_or_a_point_being_written_isnt_asked_again() -> None:
    conn = connect()
    run_top_up(conn, Writer([q()] * STOCK), "es.preterite")
    writer = Writer()
    run_top_up(conn, writer, "es.preterite")
    asyncio.run(
        top_up(
            conn,
            lambda language: ([], ES),
            writer,
            ("es.imperfect",),
            lambda: NOW,
            writing={"es.imperfect"},
        )
    )
    assert writer.calls == []


def test_a_point_whose_questions_keep_failing_stops_asking_for_the_day() -> None:
    conn = connect()
    writer = Writer(*([[q(answer="íbamos")]] * (BATCHES_PER_DAY + 1)))
    for _ in range(BATCHES_PER_DAY + 1):
        run_top_up(conn, writer, "es.preterite")
    assert len(writer.calls) == BATCHES_PER_DAY
    run_top_up(conn, writer, "es.preterite", at=NOW + timedelta(days=1, minutes=1))
    assert len(writer.calls) == BATCHES_PER_DAY + 1


def test_a_failed_batch_is_logged_and_kept_nothing() -> None:
    conn = connect()
    run_top_up(conn, Writer(DrillsFailed("overloaded")), "es.preterite")
    assert store.drill_stock(conn, "es.preterite") == 0
    assert store.drill_spending(conn, NOW - timedelta(days=1)) == {}  # Claude never answered


BILLED = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")  # $2


def test_a_failed_call_claude_answered_keeps_its_cost_and_counts_toward_the_day() -> None:
    conn = connect()
    writer = Writer(*[DrillsFailed("No questions (max_tokens)", BILLED)] * BATCHES_PER_DAY, [q()])
    for _ in range(BATCHES_PER_DAY + 1):
        run_top_up(conn, writer, "es.preterite")
    assert len(writer.calls) == BATCHES_PER_DAY  # a call that keeps failing stops for the day
    assert store.drill_stock(conn, "es.preterite") == 0
    assert store.drill_spending(conn, NOW - timedelta(days=1)) == {"es": (BATCHES_PER_DAY, 4.0)}
    # Tried again the next day, and what passes is kept.
    run_top_up(conn, writer, "es.preterite", at=NOW + timedelta(days=1, minutes=1))
    assert store.drill_stock(conn, "es.preterite") == 1


@pytest.mark.parametrize(
    ("stop_reason", "text"),
    [("refusal", None), ("max_tokens", '{"questions"'), ("end_turn", None), ("end_turn", "x")],
)
def test_claude_drills_keeps_the_usage_of_an_answer_it_cant_use(
    stop_reason: str, text: str | None
) -> None:
    write = claude_drills(FakeClient(response(stop_reason, text)))  # type: ignore[arg-type]
    with pytest.raises(DrillsFailed) as failed:
        finish(write([], "es", PRETERITE, BATCH))
    assert failed.value.usage.output_tokens == 900  # the call is still paid for


def test_questions_are_served_never_served_first_then_oldest() -> None:
    conn = connect()
    run_top_up(conn, Writer([q(), q(before="Hoy "), q(before="Luego ")]), "es.preterite")
    first = store.take_drill_questions(conn, "es.preterite", 2, NOW)
    second = store.take_drill_questions(conn, "es.preterite", 2, NOW + timedelta(hours=1))
    assert [g.before for g in first] == ["Ayer ", "Hoy "]
    assert [g.before for g in second] == ["Luego ", "Ayer "]
    assert second[0].wrong == ("íbamos", "vamos", "iremos")


def test_which_questions_come_from_texts_read_with_the_related_points_to_choose_from() -> None:
    conn = connect()
    read(conn, write(conn, "Ayer|fuimos|al|mercado.", "Hoy|hablo."), NOW)
    read(conn, write(conn, "Ella|comía|cuando|llegué."), NOW)  # imperfect and preterite: skipped
    read(conn, write(conn, "Ayer|comí|mucho."), NOW, finished=False)  # not read to the end
    got = which_questions(conn, ES, "es.preterite", 5, random.Random(1))
    lines = sorted((w.line, w.words) for w in got)
    assert ("Ayer fuimos al mercado.", ("fuimos",)) in lines
    assert all(w.choices[0] == "es.preterite" for w in got)
    assert set(got[0].choices) == {"es.preterite", *POINTS["es.preterite"].related}
    assert not any("comí mucho" in w.line for w in got)


def test_a_point_with_nothing_to_compare_has_no_which_questions() -> None:
    conn = connect()
    read(conn, write(conn, "Ayer|fuimos|al|mercado."), NOW)
    assert POINTS["th.must"].related == ()
    assert which_questions(conn, ES, "th.must", 5, random.Random(1)) == []


# ==== Through the API ====


def drill_client(writer: Writer | None) -> tuple[Any, Any]:
    from fastapi.testclient import TestClient

    from franki_reader.app import create_app
    from franki_reader.engine import Engine

    conn = connect()
    engine = Engine(conn, None, None, lambda: NOW, random.Random(1))
    return TestClient(create_app(engine, "p", write_drills=writer)), conn


AUTH = {"Authorization": "Bearer p"}


def test_a_drill_mixes_lines_read_and_gap_questions_then_writes_more() -> None:
    writer = Writer([q(), q(before="Hoy "), q(before="Luego ")], [q(before="Antes ")])
    c, conn = drill_client(writer)
    read(conn, write(conn, "Ayer|fuimos|al|mercado.", "Hoy|hablo."), NOW)
    # Nothing written yet: only the line read, and a batch is written after the response.
    first = c.post("/api/drills", json={"points": ["es.preterite"], "count": 4}, headers=AUTH)
    body = first.json()
    assert [x["kind"] for x in body["questions"]] == ["which"]
    assert body["questions"][0]["words"] == ["fuimos"] and body["missing"] == []
    assert writer.calls == [("es.preterite", BATCH)]
    second = c.post("/api/drills", json={"points": ["es.preterite"], "count": 4}, headers=AUTH)
    kinds = sorted(x["kind"] for x in second.json()["questions"])
    assert kinds == ["gap", "gap", "gap", "which"]  # the gaps make up for one line read
    gap = next(x for x in second.json()["questions"] if x["kind"] == "gap")
    assert gap["answer"] == "fuimos" and gap["wrong"] == ["íbamos", "vamos", "iremos"]
    spent = c.get("/api/costs", headers=AUTH).json()["drills"]
    assert spent["batches"] == 2 and spent["languages"][0]["language"] == "es"


def test_a_failed_batch_shows_in_the_costs() -> None:
    c, _ = drill_client(Writer(DrillsFailed("No questions (refusal)", BILLED)))
    c.post("/api/drills", json={"points": ["es.preterite"], "count": 4}, headers=AUTH)
    spent = c.get("/api/costs", headers=AUTH).json()["drills"]
    assert spent["batches"] == 1 and spent["cost_usd"] == 2.0


def test_points_with_nothing_to_ask_are_named() -> None:
    c, _ = drill_client(None)
    body = c.post(
        "/api/drills", json={"points": ["es.future", "es.nope"], "count": 5}, headers=AUTH
    ).json()
    assert body == {"questions": [], "missing": ["es.future", "es.nope"], "writing": False}
    assert c.post("/api/drills", json={"points": []}).status_code == 401
    too_many = c.post("/api/drills", json={"points": ["es.future"], "count": 99}, headers=AUTH)
    assert too_many.status_code == 422


def test_setting_a_point_to_practice_writes_its_questions_ahead() -> None:
    writer = Writer([q()], [q()])
    c, conn = drill_client(writer)
    c.put("/api/grammar/es.preterite", json={"state": "practice"}, headers=AUTH)
    c.put("/api/grammar/es.imperfect", json={"state": "avoid"}, headers=AUTH)  # not drilled
    assert writer.calls == [("es.preterite", BATCH)]
    assert store.drill_stock(conn, "es.preterite") == 1


# ==== Points named by the word itself ====


def stock(conn: Any, point_id: str, *befores: str) -> None:
    """Puts gap questions straight into a point's stock."""
    store.save_drill_batch(
        conn,
        point_id,
        POINTS[point_id].language,
        [GapQuestion(b, "x", "", "e", ("a", "b", "c"), "") for b in befores],
        len(befores),
        NOW,
        0.0,
    )


def serve_th(conn: Any, point: str, count: int, at: datetime = NOW) -> list[dict[str, Any]]:
    return serve(conn, lambda language: ([], ES), (point,), count, at, random.Random(1))


def test_a_word_named_point_is_never_asked_which_and_its_questions_say_who_they_are_for() -> None:
    conn = connect()
    read(conn, write(conn, "Ayer|fuimos|al|mercado."), NOW)
    assert POINTS["th.already"].word_named and POINTS["th.already"].related
    stock(conn, "th.already", "own1", "own2", "own3")
    stock(conn, "th.ever", "ever1", "ever2")
    stock(conn, "th.yes_no", "yn1", "yn2")
    got = serve_th(conn, "th.already", 6)
    assert [x["kind"] for x in got] == ["gap"] * 6
    assert all(x["for"] == "th.already" for x in got)
    by_point = sorted(x["point"] for x in got)
    # Half (3) its own, the other 3 from its two rivals in turn.
    assert by_point == ["th.already"] * 3 + ["th.ever"] * 2 + ["th.yes_no"]
    assert sorted(got[0]) == sorted(
        ["kind", "id", "point", "for", "before", "answer", "after", "english", "wrong", "hint"]
    )
    assert len({x["id"] for x in got}) == 6


def test_a_word_named_point_rounds_its_own_share_up_and_never_repeats_a_question() -> None:
    conn = connect()
    stock(conn, "th.already", "o1", "o2", "o3", "o4")
    stock(conn, "th.ever", "e1", "e2", "e3")
    got = serve_th(conn, "th.already", 5)
    assert sum(x["point"] == "th.already" for x in got) == 3
    assert len({x["id"] for x in got}) == 5
    # Asked again, never-served questions come first, and nothing repeats within the drill.
    again = serve_th(conn, "th.already", 5, NOW + timedelta(minutes=1))
    assert len({x["id"] for x in again}) == len(again)
    assert {"o4", "e3"} <= {x["before"] for x in again}


def test_a_word_named_point_with_rivals_out_of_stock_is_filled_from_its_own() -> None:
    conn = connect()
    stock(conn, "th.already", "o1", "o2", "o3", "o4")
    got = serve_th(conn, "th.already", 4)
    assert [x["point"] for x in got] == ["th.already"] * 4
    assert all(x["for"] == "th.already" for x in got)
    # A rival with stock but an own stock that runs short is made up from the rival.
    conn = connect()
    stock(conn, "th.already", "o1")
    stock(conn, "th.ever", "e1", "e2", "e3")
    got = serve_th(conn, "th.already", 4)
    assert sorted(x["point"] for x in got) == ["th.already", "th.ever", "th.ever", "th.ever"]


def test_a_point_not_named_by_a_word_keeps_its_which_and_gap_questions_unchanged() -> None:
    conn = connect()
    read(conn, write(conn, "Ayer|fuimos|al|mercado."), NOW)
    run_top_up(conn, Writer([q(), q(before="Hoy ")]), "es.preterite")
    got = serve(conn, lambda language: ([], ES), ("es.preterite",), 3, NOW, random.Random(1))
    assert sorted(x["kind"] for x in got) == ["gap", "gap", "which"]
    assert all("for" not in x for x in got)


def test_a_word_named_points_rivals_are_the_related_points_that_are_word_named_too() -> None:
    assert [r.id for r in rivals_of(POINTS["th.already"])] == ["th.ever", "th.yes_no"]
    assert rivals_of(PRETERITE) == ()
    assert with_rivals(("th.already", "es.preterite", "th.ever")) == (
        "th.already",
        "es.preterite",
        "th.ever",
        "th.yes_no",
    )
    asked = request_message("th", POINTS["th.already"], 5)
    assert "rival words that genuinely compete" in asked and POINTS["th.ever"].name in asked
    assert "rival" not in request_message("es", PRETERITE, 5)


def test_drilling_a_word_named_point_also_writes_its_rivals_stock() -> None:
    writer = Writer([], [], [], [], [], [])
    c, conn = drill_client(writer)
    body = c.post("/api/drills", json={"points": ["th.already"], "count": 4}, headers=AUTH).json()
    assert body["questions"] == [] and body["missing"] == ["th.already"]
    assert [pid for pid, _ in writer.calls] == ["th.already", "th.ever", "th.yes_no"]
    # A drill served from a rival's stock alone isn't missing the drilled point.
    stock(conn, "th.ever", "e1")
    got = c.post("/api/drills", json={"points": ["th.already"], "count": 4}, headers=AUTH).json()
    assert got["missing"] == [] and all(x["for"] == "th.already" for x in got["questions"])
