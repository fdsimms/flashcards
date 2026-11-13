"""Grammar points: finding them, asking for them, sending drafts back over them, and showing them."""

import asyncio
import json
import random
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from scripted import ENTRIES

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.generator import Line, TextRequest, Usage, generate, request_message
from franki_reader.grammar import _FINDERS, CATALOG, POINTS, _load, points_for, points_in, words
from franki_reader.languages import Code
from franki_reader.lexicon import lexicon_from
from franki_reader.reader import render
from franki_reader.store import StoredText

ES = lexicon_from([], "es")
TH = lexicon_from(ENTRIES)
NOW = datetime(2026, 10, 26, 9, 0)


def found(text: str, lexicon: Any = ES) -> dict[str, list[str]]:
    ws = words(text, lexicon)
    joiner = " " if lexicon.spaced else ""
    language: Code = "es" if lexicon.spaced else "th"
    out = {}
    for p in points_for(language):
        if spans := p.find(ws):
            out[p.id] = [joiner.join(ws[a:b]) for a, b in spans]
    return out


# ==== Finding Spanish tenses ====


@pytest.mark.parametrize(
    ("text", "point", "matches"),
    [
        (
            "Ayer hablé con Ana y comió conmigo; fueron al cine.",
            "es.preterite",
            ["hablé", "comió", "fueron"],
        ),
        ("Busqué el libro y llegué tarde.", "es.preterite", ["busqué", "llegué"]),
        (
            "Cuando era niño, hablaba mucho y comía poco.",
            "es.imperfect",
            ["era", "hablaba", "comía"],
        ),
        ("He hablado con él. Ya ha comido.", "es.present_perfect", ["he hablado", "ha comido"]),
        ("Había comido antes.", "es.pluperfect", ["había comido"]),
        (
            "Mañana hablaré con ella, tendrá tiempo e iremos.",
            "es.future",
            ["hablaré", "tendrá", "iremos"],
        ),
        ("Yo hablaría con ella. Tendríamos tiempo.", "es.conditional", ["hablaría", "tendríamos"]),
        (
            "Estoy hablando; están diciéndote algo.",
            "es.progressive",
            ["estoy hablando", "están diciéndote"],
        ),
        (
            "Quiero que hables con ella. Ojalá llueva.",
            "es.present_subjunctive",
            ["hables", "llueva"],
        ),
        (
            "Si tuviera tiempo, quería que vinieras.",
            "es.imperfect_subjunctive",
            ["tuviera", "vinieras"],
        ),
    ],
)
def test_each_spanish_point_is_found(text: str, point: str, matches: list[str]) -> None:
    assert found(text)[point] == matches


def test_forms_shared_with_another_tense_count_as_neither() -> None:
    # hablamos is "we speak" and "we spoke"; vamos is ir's present.
    assert found("Hablamos mañana. Vamos a la playa.") == {}


def test_look_alikes_are_left_alone() -> None:
    # había alone is "there was" (imperfect), not part of a pluperfect; fuera is "outside";
    # comida is a noun; vino is "wine".
    result = found("Había una casa. Está fuera. Es la comida. Quiero vino.")
    assert result == {"es.imperfect": ["había"]}


def test_a_pluperfects_haber_is_not_also_imperfect() -> None:
    assert "es.imperfect" not in found("Había comido.")


# ==== Finding Thai points ====


@pytest.mark.parametrize(
    ("text", "point"),
    [
        ("ฉันเคยไปเชียงใหม่", "th.ever"),
        ("เขากำลังกินข้าว", "th.ongoing"),
        ("พรุ่งนี้จะไปตลาด", "th.future"),
        ("กินข้าวแล้ว", "th.already"),
        ("ต้องไปทำงาน", "th.must"),
        ("อันนี้แพงกว่า", "th.comparison"),
        ("ร้านนี้ดีที่สุด", "th.superlative"),
        ("ถ้าฝนตกไม่ไป", "th.if"),
        ("เพราะว่าเหนื่อย", "th.because"),
        ("ไปไหม", "th.yes_no"),
        ("ไปหรือเปล่า", "th.yes_no"),
    ],
)
def test_each_thai_point_is_found(text: str, point: str) -> None:
    assert point in found(text, TH)


def test_want_is_not_must() -> None:
    assert found("ฉันต้องการน้ำ", TH) == {}


def test_every_point_has_a_name_and_a_note() -> None:
    assert len(points_for("es")) == 9 and len(points_for("th")) == 10
    assert all(p.name and p.note and p.id.startswith(p.language + ".") for p in POINTS.values())


def test_the_points_a_line_uses_in_catalog_order() -> None:
    line = "Ayer|fuimos|al|mercado|y|*compramos*|fruta|porque|*había*|*llovido*"
    assert [p.id for p in points_in(line, ES, "es")] == ["es.preterite", "es.pluperfect"]
    assert points_in("Hoy|como|fruta", ES, "es") == []


def _catalog(tmp_path: Path, *points: dict[str, Any]) -> Path:
    path = tmp_path / "grammar_points.json"
    path.write_text(json.dumps({"points": list(points)}), encoding="utf-8")
    return path


def _point(pid: str, language: str = "es") -> dict[str, Any]:
    return {"id": pid, "language": language, "name": pid, "note": "a note"}


def test_points_come_from_the_catalog_in_its_order(tmp_path: Path) -> None:
    def find(ws: list[str]) -> list[tuple[int, int]]:
        return []

    path = _catalog(tmp_path, _point("es.b"), {**_point("es.a"), "forms": ["preterite"]})
    points = _load(path, {"es.a": find, "es.b": find})
    assert [p.id for p in points] == ["es.b", "es.a"]
    assert points[1].find is find


@pytest.mark.parametrize(
    ("points", "finders", "problem"),
    [
        ([_point("es.a")], [], "es.a has no finder"),
        ([], ["es.a"], "es.a has a finder but isn't in the catalog"),
        ([_point("es.a"), _point("es.a")], ["es.a"], "es.a is listed twice"),
        ([_point("it.a", "it")], ["it.a"], "it.a is in it, which isn't a language here"),
    ],
)
def test_a_catalog_that_doesnt_match_the_finders_stops_the_server(
    tmp_path: Path, points: list[dict[str, Any]], finders: list[str], problem: str
) -> None:
    with pytest.raises(ValueError, match=re.escape(problem)):
        _load(_catalog(tmp_path, *points), {pid: lambda ws: [] for pid in finders})


def test_the_real_catalog_has_a_finder_for_every_point() -> None:
    entries = json.loads(CATALOG.read_text(encoding="utf-8"))["points"]
    assert [e["id"] for e in entries] == list(POINTS)
    assert len(POINTS) == len(_FINDERS)


# ==== Asking for grammar and checking the draft ====


class Model:
    def __init__(self, *drafts: dict[str, Any]) -> None:
        self.drafts = list(drafts)
        self.sent: list[list[dict[str, Any]]] = []

    async def __call__(self, messages: Any) -> Any:
        self.sent.append(list(messages))
        return self.drafts.pop(0), [], Usage(1, 1, 0, 0)


def draft(*lines: str) -> dict[str, Any]:
    return {
        "title": "t",
        "roles": {"A": "A", "B": "B"},
        "genders": {"A": "male", "B": "female"},
        "lines": [{"speaker": "AB"[i % 2], "text": t, "english": "."} for i, t in enumerate(lines)],
        "glosses": [],
    }


PRETERITE = draft("Ayer|hablé|con|Ana.", "¿Y|qué|dijo?")
PRESENT = draft("Hoy|hablo|con|Ana.", "¿Y|qué|dice?")
PLUPERFECT_ONCE = draft("Ya|había|comido.", "¿Y|qué|dice?")
PLUPERFECT_TWICE = draft("Ya|había|comido.", "Yo|también|había|comido.")


def test_the_request_names_what_to_practice_and_avoid() -> None:
    message = request_message(
        TextRequest("food", language="es", practice=("es.pluperfect",), avoid=("es.preterite",))
    )
    assert "Grammar to practice" in message and "Pluperfect (Had done" in message
    assert "Grammar to avoid" in message and "Preterite (Finished past" in message


def test_the_request_names_known_points_to_work_in_and_unmarked_ones_to_keep_few() -> None:
    message = request_message(
        TextRequest("food", language="es", review=("es.future",), unset=("es.conditional",))
    )
    assert "work these in where they fit naturally" in message and "Future (Will do" in message
    assert "at most 2 times in the whole text" in message and "Conditional (Would do" in message


def test_more_than_two_uses_of_unmarked_grammar_go_back() -> None:
    three = draft("Yo|comería|y|hablaría.", "Ella|tendría|tiempo.")
    two = draft("Yo|comería|y|hablaría.", "Ella|tiene|tiempo.")
    model = Model(three, two)
    request = TextRequest("t", language="es", unset=("es.conditional", "es.future"))
    result = asyncio.run(generate(model, ES, request))
    assert result.passed and result.attempts == 2 and result.grammar_problems == 0
    assert (
        "Use grammar the learner may not know at most 2 times in all; this draft has: "
        "Conditional (comería, hablaría, tendría)." in model.sent[1][-1]["content"]
    )


def test_an_avoided_tense_sends_the_draft_back_naming_the_words() -> None:
    model = Model(PRETERITE, PRESENT)
    result = asyncio.run(
        generate(model, ES, TextRequest("t", language="es", avoid=("es.preterite",)))
    )
    assert result.passed and result.attempts == 2 and result.grammar_problems == 0
    revision = model.sent[1][-1]["content"]
    assert "Don't use the Preterite; this draft has: hablé, dijo." in revision


def test_a_practiced_tense_used_once_goes_back() -> None:
    model = Model(PLUPERFECT_ONCE, PLUPERFECT_TWICE)
    request = TextRequest("t", language="es", practice=("es.pluperfect",))
    result = asyncio.run(generate(model, ES, request))
    assert result.passed and result.attempts == 2
    assert (
        "Use the Pluperfect at least 2 times; this draft uses it 1 time."
        in model.sent[1][-1]["content"]
    )


def test_the_closest_attempt_prefers_fewer_grammar_problems() -> None:
    # All three keep the preterite, so none passes; the one using it least is kept, though the
    # others have the same coverage.
    both = draft("Ayer|hablé|con|Ana|y|comió|conmigo.", "¿Y|qué|dijo?")
    model = Model(both, PRETERITE, both)
    request = TextRequest("t", language="es", avoid=("es.preterite",))
    result = asyncio.run(generate(model, ES, request))
    assert result.passed and result.grammar_problems == 2  # hablé, dijo; the others have 3
    assert result.lines[0].text == "Ayer|hablé|con|Ana."


# ==== The reader ====


def test_practiced_and_avoided_words_are_marked_in_the_reader() -> None:
    text = StoredText(
        1,
        1,
        "t",
        (Line("A", "Ya|había|comido|y|después|hablé.", "."),),
        {},
        (),
        1.0,
        language="es",
        grammar={"practice": ["es.pluperfect"], "avoid": ["es.preterite"]},
    )
    out = render(text, ES, {})
    marked = {w["text"]: w["grammar"] for w in out["lines"][0]["words"] if w["grammar"]}
    assert marked == {"había": "es.pluperfect", "comido": "es.pluperfect", "hablé": "es.preterite"}
    assert [(g["id"], g["role"]) for g in out["grammar"]] == [
        ("es.pluperfect", "practice"),
        ("es.preterite", "avoid"),
    ]


def test_known_points_worked_in_and_unmarked_ones_that_turn_up_are_marked() -> None:
    text = StoredText(
        1,
        1,
        "t",
        (Line("A", "Yo|comía|y|mañana|hablaré.", "."),),
        {},
        (),
        1.0,
        language="es",
        grammar={"practice": [], "avoid": [], "review": ["es.imperfect", "es.pluperfect"]},
    )
    out = render(text, ES, {}, unset=("es.future", "es.conditional"))
    marked = {w["text"]: w["grammar"] for w in out["lines"][0]["words"] if w["grammar"]}
    assert marked == {"comía": "es.imperfect", "hablaré": "es.future"}
    # Only points a word uses are listed: the pluperfect and the conditional never came up.
    assert [(g["id"], g["role"]) for g in out["grammar"]] == [
        ("es.imperfect", "review"),
        ("es.future", "unset"),
    ]


def test_a_text_written_with_a_point_since_removed_still_renders() -> None:
    text = StoredText(
        1, 1, "t", (Line("A", "ฉัน", "."),), {}, (), 1.0, grammar={"practice": ["th.gone"]}
    )
    assert render(text, TH, {})["grammar"] == []


# ==== Choosing, through the API ====


def client(language: str = "es") -> tuple[TestClient, Engine]:
    conn = store.connect(":memory:")
    store.save_settings(conn, store.Settings(language=language))  # type: ignore[arg-type]
    engine = Engine(conn, None, None, lambda: NOW, random.Random(1))
    c = TestClient(create_app(engine, "p"))
    return c, engine


AUTH = {"Authorization": "Bearer p"}


def test_the_grammar_list_is_the_current_languages_and_starts_unset() -> None:
    c, _ = client("es")
    body = c.get("/api/grammar", headers=AUTH).json()
    assert body["max_practice"] == 2
    assert [p["id"] for p in body["points"]][:2] == ["es.preterite", "es.imperfect"]
    assert {p["state"] for p in body["points"]} == {"unset"}
    assert body["points"][0]["seen"] == {"texts": 0, "uses": 0, "last": None}
    assert body["least"] == []  # nothing is known yet, so nothing is worked in
    assert c.get("/api/grammar").status_code == 401


def test_know_it_is_kept_and_the_least_seen_known_points_are_listed() -> None:
    c, _ = client("es")
    c.put("/api/grammar/es.future", json={"state": "normal"}, headers=AUTH)
    body = c.put("/api/grammar/es.imperfect", json={"state": "normal"}, headers=AUTH).json()
    states = {p["id"]: p["state"] for p in body["points"]}
    assert states["es.future"] == "normal" and states["es.preterite"] == "unset"
    assert body["least"] == ["es.imperfect", "es.future"]


def test_at_most_two_points_are_practiced_at_once() -> None:
    c, _ = client("es")
    assert (
        c.put("/api/grammar/es.pluperfect", json={"state": "practice"}, headers=AUTH).status_code
        == 200
    )
    assert (
        c.put("/api/grammar/es.future", json={"state": "practice"}, headers=AUTH).status_code == 200
    )
    third = c.put("/api/grammar/es.conditional", json={"state": "practice"}, headers=AUTH)
    assert third.status_code == 422
    assert third.json()["detail"] == "Practice at most 2 at a time. Set one to Know it first."
    # Avoiding has no limit, and setting one back to normal makes room.
    assert (
        c.put("/api/grammar/es.preterite", json={"state": "avoid"}, headers=AUTH).status_code == 200
    )
    c.put("/api/grammar/es.future", json={"state": "normal"}, headers=AUTH)
    states = {
        p["id"]: p["state"]
        for p in c.put(
            "/api/grammar/es.conditional", json={"state": "practice"}, headers=AUTH
        ).json()["points"]
    }
    assert states["es.conditional"] == "practice" and states["es.future"] == "normal"
    assert states["es.preterite"] == "avoid"
    assert c.put("/api/grammar/es.nope", json={"state": "avoid"}, headers=AUTH).status_code == 404
    assert c.put("/api/grammar/es.future", json={"state": "maybe"}, headers=AUTH).status_code == 422


def test_every_languages_choices_are_listed_for_forms_practice() -> None:
    c, engine = client("th")
    # Japanese's ます and past read as Know it until chosen (the catalog's `known`).
    known = {"ja.masu": "normal", "ja.past": "normal"}
    assert c.get("/api/grammar/choices", headers=AUTH).json() == {"choices": known}
    c.put("/api/grammar/es.preterite", json={"state": "practice"}, headers=AUTH)
    c.put("/api/grammar/th.ever", json={"state": "avoid"}, headers=AUTH)
    store.set_grammar(engine.conn, "es.gone", "practice")  # a point since taken out of the catalog
    body = c.get("/api/grammar/choices", headers=AUTH).json()
    assert body == {"choices": {**known, "es.preterite": "practice", "th.ever": "avoid"}}
    assert c.get("/api/grammar/choices").status_code == 401


def test_choices_reach_the_request_for_their_own_language_only() -> None:
    c, engine = client("es")
    c.put("/api/grammar/es.pluperfect", json={"state": "practice"}, headers=AUTH)
    c.put("/api/grammar/es.preterite", json={"state": "avoid"}, headers=AUTH)
    from franki_reader.difficulty import Difficulty

    spanish = engine._request("t", [], Difficulty(), "es")
    assert (spanish.practice, spanish.avoid) == (("es.pluperfect",), ("es.preterite",))
    thai = engine._request("t", [], Difficulty(), "th")
    assert (thai.practice, thai.avoid) == ((), ())
