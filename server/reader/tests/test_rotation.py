import random
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from test_generator import GOOD, MANGO, ScriptedModel
from test_generator import run as write

from franki_reader import rotation, store
from franki_reader.app import create_app
from franki_reader.difficulty import Difficulty
from franki_reader.engine import Engine
from franki_reader.generator import TextRequest
from franki_reader.rotation import Progress, graduates, progress
from franki_reader.store import GrammarAnswer, Reading

NOW = datetime(2026, 11, 20, 9, 0)
AUTH = {"Authorization": "Bearer open sesame"}


class Clock:
    def __init__(self) -> None:
        self.now = NOW

    def __call__(self) -> datetime:
        return self.now


def _engine(clock: Clock) -> Engine:
    # UTC, so a study day is the date at 4 AM UTC whatever zone the suite runs in.
    return Engine(store.connect(":memory:"), None, None, clock, random.Random(1), zone=UTC)


def _read_texts(e: Engine, point: str, days: int, per_day: int, start: datetime = NOW) -> None:
    """Texts written to practice `point` and read to the end, `per_day` on each of `days` days."""
    generated = write(ScriptedModel(GOOD), TextRequest("food", (MANGO,)))
    topic = store.add_topic(e.conn, "food", start)
    for d in range(days):
        for k in range(per_day):
            at = start + timedelta(days=d, hours=k)
            text_id = store.save_text(
                e.conn, topic.id, generated, [], 0.95, at, grammar={"practice": [point]}
            )
            store.log_reading(
                e.conn,
                text_id,
                Reading(None, True, (), (), 1.0, False, 120),
                at + timedelta(minutes=10),
            )


def _answers(e: Engine, point: str, results: list[bool]) -> None:
    store.add_grammar_answers(
        e.conn,
        (
            GrammarAnswer(point, f"d{i}", "gap", ok, (NOW + timedelta(minutes=i)).isoformat())
            for i, ok in enumerate(results)
        ),
    )


def test_a_point_needs_texts_over_several_days_and_mostly_right_answers() -> None:
    drilled = progress(rotation.TEXTS, rotation.DAYS, [True] * 9 + [False])
    assert graduates(drilled)
    assert not graduates(Progress(rotation.TEXTS, rotation.DAYS - 1, 9, 10))  # one binge
    assert not graduates(Progress(rotation.TEXTS - 1, rotation.DAYS, 9, 10))
    assert not graduates(Progress(rotation.TEXTS_UNDRILLED, rotation.DAYS, 7, 10))  # too many wrong
    # Undrilled (fewer than DRILL_MIN answers) takes more texts.
    assert not graduates(Progress(rotation.TEXTS, rotation.DAYS, 3, 3))
    assert graduates(Progress(rotation.TEXTS_UNDRILLED, rotation.DAYS, 0, 0))
    # Only the latest DRILL_WINDOW answers count.
    assert progress(8, 4, [True] * 10 + [False] * 5).drill_right == 10


def test_a_learned_point_moves_to_know_it_and_the_easiest_unknown_one_starts() -> None:
    clock = Clock()
    e = _engine(clock)
    store.set_grammar_many(e.conn, {"th.ever": "practice", "th.yes_no": "normal"}, NOW)
    _read_texts(e, "th.ever", days=4, per_day=2, start=NOW + timedelta(hours=1))
    clock.now = NOW + timedelta(days=5)
    assert e.rotate_grammar("th") == []  # 8 texts, no drill answers: 12 needed

    _answers(e, "th.ever", [True] * 5)
    [swap] = e.rotate_grammar("th")
    choices = store.load_grammar(e.conn)
    # กำลัง (level 2) is the easiest point neither practiced nor known: ไหม (level 1) is known.
    assert choices["th.ever"] == "normal" and choices["th.ongoing"] == "practice"
    assert (swap.graduated, swap.started, swap.started_was) == ("th.ever", "th.ongoing", "")
    assert (swap.texts, swap.days, swap.drill_right, swap.drill_asked) == (8, 4, 5, 5)
    assert [r.id for r in store.new_rotations(e.conn, "th")] == [swap.id]
    assert e.rotate_grammar("th") == []  # th.ongoing has no texts yet


def test_texts_written_before_a_point_started_being_practiced_dont_count() -> None:
    clock = Clock()
    e = _engine(clock)
    _read_texts(e, "th.ever", days=6, per_day=2)
    store.set_grammar_many(e.conn, {"th.ever": "practice"}, NOW + timedelta(days=7))
    clock.now = NOW + timedelta(days=8)
    assert e.rotate_grammar("th") == []


def test_undo_puts_both_points_back_and_starts_the_count_again() -> None:
    clock = Clock()
    e = _engine(clock)
    store.set_grammar_many(e.conn, {"th.ever": "practice", "th.yes_no": "avoid"}, NOW)
    _read_texts(e, "th.ever", days=6, per_day=2, start=NOW + timedelta(hours=1))
    clock.now = NOW + timedelta(days=7)
    [swap] = e.rotate_grammar("th")
    assert swap.started == "th.yes_no" and swap.started_was == "avoid"

    assert e.undo_rotation(swap.id) is None
    choices = store.load_grammar(e.conn)
    assert choices["th.ever"] == "practice" and choices["th.yes_no"] == "avoid"
    assert store.new_rotations(e.conn, "th") == []
    assert e.rotate_grammar("th") == []  # its earlier texts no longer count
    assert e.undo_rotation(swap.id) == "That change has already been undone."


def test_undo_is_refused_once_either_point_was_changed_by_hand() -> None:
    clock = Clock()
    e = _engine(clock)
    store.set_grammar_many(e.conn, {"th.ever": "practice"}, NOW)
    _read_texts(e, "th.ever", days=6, per_day=2, start=NOW + timedelta(hours=1))
    clock.now = NOW + timedelta(days=7)
    [swap] = e.rotate_grammar("th")
    store.set_grammar_many(e.conn, {swap.started: "normal"}, clock.now)
    why = e.undo_rotation(swap.id)
    assert why is not None and "changed since" in why
    assert store.load_grammar(e.conn)["th.ever"] == "normal"


def test_an_answer_sent_twice_is_kept_once() -> None:
    conn = store.connect(":memory:")
    answer = GrammarAnswer("th.ever", "d1", "gap", True, NOW.isoformat())
    assert store.add_grammar_answers(conn, [answer]) == 1
    assert store.add_grammar_answers(conn, [answer]) == 0
    assert store.recent_grammar_answers(conn, "th.ever", 10) == [True]


def test_the_routes_take_answers_and_show_dismiss_and_undo_a_swap() -> None:
    clock = Clock()
    e = _engine(clock)
    store.set_grammar_many(e.conn, {"th.ever": "practice"}, NOW)
    _read_texts(e, "th.ever", days=6, per_day=2, start=NOW + timedelta(hours=1))
    clock.now = NOW + timedelta(days=7)
    with TestClient(create_app(e, "open sesame")) as c:
        sent = {
            "answers": [
                {
                    "point": "th.ever",
                    "drill": "d",
                    "kind": "gap",
                    "correct": True,
                    "answered_at": NOW.isoformat(),
                },
                {
                    "point": "xx.gone",
                    "drill": "d",
                    "kind": "gap",
                    "correct": True,
                    "answered_at": NOW.isoformat(),
                },
            ]
        }
        assert c.post("/api/grammar/answers", json=sent, headers=AUTH).json() == {"saved": 1}
        assert c.get("/api/grammar/rotations", headers=AUTH).json() == {"rotations": []}

        [swap] = e.rotate_grammar("th")
        [shown] = c.get("/api/grammar/rotations", headers=AUTH).json()["rotations"]
        assert shown["graduated"] == {"id": "th.ever", "name": "เคย (have ever)"}
        assert shown["started"]["id"] == swap.started and shown["texts"] == 12

        assert c.post(f"/api/grammar/rotations/{swap.id}/undo", headers=AUTH).status_code == 200
        assert c.post(f"/api/grammar/rotations/{swap.id}/undo", headers=AUTH).status_code == 409
        assert c.post("/api/grammar/rotations/999/dismiss", headers=AUTH).status_code == 404


def test_closing_the_notice_leaves_the_swap_in_place() -> None:
    clock = Clock()
    e = _engine(clock)
    store.set_grammar_many(e.conn, {"th.ever": "practice"}, NOW)
    _read_texts(e, "th.ever", days=6, per_day=2, start=NOW + timedelta(hours=1))
    clock.now = NOW + timedelta(days=7)
    [swap] = e.rotate_grammar("th")
    with TestClient(create_app(e, "open sesame")) as c:
        assert c.post(f"/api/grammar/rotations/{swap.id}/dismiss", headers=AUTH).status_code == 200
        assert c.get("/api/grammar/rotations", headers=AUTH).json() == {"rotations": []}
    assert store.load_grammar(e.conn)["th.ever"] == "normal"


def test_a_text_written_after_a_point_is_learned_practices_the_next_one() -> None:
    clock = Clock()
    e = _engine(clock)
    store.save_snapshot(e.conn, [], NOW)
    store.set_grammar_many(e.conn, {"th.ever": "practice"}, NOW)
    _read_texts(e, "th.ever", days=6, per_day=2, start=NOW + timedelta(hours=1))
    clock.now = NOW + timedelta(days=7)
    request = e._request("food", [], Difficulty())
    assert "th.ever" not in request.practice and len(request.practice) == 1
