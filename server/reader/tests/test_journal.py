import asyncio
import json
import random
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from scripted import IN_RANGE
from scripted import ScriptedModel as AppModel
from test_app import AUTH, started
from test_generator import FakeClient, finish, response

from franki_reader import journal, journal_store, rotation, store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.generator import Usage
from franki_reader.journal import CheckRequest, claude_check, clean
from franki_reader.lexicon import Entry
from franki_reader.production import ProductionFailed

COST = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")  # $2
NOW = datetime(2026, 11, 20, 9, 0)

TEXT = (
    "Wczoraj ja idę do sklepu. Kupiłem chleb i mleko. Nie mam czas na [cooking]. "
    "Wieczorem oglądałem film z moja siostra."
)
REQUEST = CheckRequest("pl", TEXT, "What did you do yesterday evening?")


def mistake(**over: Any) -> dict[str, Any]:
    base = {
        "was": "idę",
        "now": "poszedłem",
        "kind": "pl.past",
        "case": "",
        "governor": "",
        "note": "Idę is present. For yesterday, the past.",
        "hint": "The verb's tense doesn't fit wczoraj.",
    }
    return {**base, **over}


def answer(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "sentences": [
            {
                "written": "Wczoraj ja idę do sklepu.",
                "verdict": "almost",
                "corrected": "Wczoraj poszedłem do sklepu.",
                "english": "Yesterday I went to the shop.",
                "mistakes": [mistake()],
            },
            {
                "written": "Kupiłem chleb i mleko.",
                "verdict": "right",
                "corrected": "Kupiłem chleb i mleko.",
                "english": "I bought bread and milk.",
                "mistakes": [],
            },
            {
                "written": "Nie mam czas na [cooking].",
                "verdict": "almost",
                "corrected": "Nie mam czasu na gotowanie.",
                "english": "I don't have time for cooking.",
                "mistakes": [
                    mistake(
                        was="czas",
                        now="czasu",
                        kind="case",
                        case="genitive",
                        governor="nie mam",
                        note="A negative takes the genitive.",
                        hint="After nie mam this noun takes a different case.",
                    )
                ],
            },
            {
                "written": "Wieczorem oglądałem film z moja siostra.",
                "verdict": "almost",
                "corrected": "Wieczorem oglądałem film z moją siostrą.",
                "english": "In the evening I watched a film with my sister.",
                "mistakes": [
                    mistake(
                        was="moja siostra",
                        now="moją siostrą",
                        kind="case",
                        case="instrumental",
                        governor="z",
                        note="Z meaning with takes the instrumental.",
                        hint="Both endings after z are in the wrong case.",
                    )
                ],
            },
        ],
        "filled": [{"english": "cooking", "word": "gotowanie"}],
    }
    return {**base, **over}


# ==== Cleaning what Claude sent ====


def test_a_check_keeps_each_sentence_its_mistakes_and_the_filled_word() -> None:
    got = clean(answer(), REQUEST)
    assert got is not None
    assert got["verdict"] == "almost"
    assert [s["verdict"] for s in got["sentences"]] == ["almost", "right", "almost", "almost"]
    first = got["sentences"][0]["mistakes"][0]
    assert (first["kind"], first["name"], first["case"], first["governor"]) == (
        "pl.past",
        "Past tense",
        None,
        None,
    )
    case = got["sentences"][3]["mistakes"][0]
    assert (case["name"], case["case"], case["governor"]) == (
        "Instrumental ending",
        "instrumental",
        "z",
    )
    assert got["filled"] == [{"english": "cooking", "word": "gotowanie"}]


def test_an_answer_that_isnt_the_entry_as_written_is_refused() -> None:
    changed = answer()
    changed["sentences"][1]["written"] = "Kupiłem chleb."
    assert clean(changed, REQUEST) is None
    dropped = answer()
    del dropped["sentences"][2]
    assert clean(dropped, REQUEST) is None
    # Spacing and line breaks don't matter.
    assert clean(answer(), CheckRequest("pl", TEXT.replace(". ", ".\n\n"))) is not None


def test_a_kind_off_the_list_is_counted_as_something_else() -> None:
    got = answer()
    got["sentences"][0]["mistakes"] = [mistake(kind="vibes")]
    cleaned = clean(got, REQUEST)
    assert cleaned is not None
    assert cleaned["sentences"][0]["mistakes"][0]["kind"] == "other"


def test_a_hint_that_names_the_fix_gives_way_to_the_kinds_name() -> None:
    got = answer()
    got["sentences"][0]["mistakes"] = [mistake(hint='Use "poszedłem" here.')]
    cleaned = clean(got, REQUEST)
    assert cleaned is not None
    assert cleaned["sentences"][0]["mistakes"][0]["hint"] == "Past tense"


def test_words_not_in_the_sentence_and_a_case_off_the_list_are_left_out() -> None:
    got = answer()
    got["sentences"][3]["mistakes"] = [
        mistake(was="moją", kind="case", case="ablative", governor="przez")
    ]
    cleaned = clean(got, REQUEST)
    assert cleaned is not None
    m = cleaned["sentences"][3]["mistakes"][0]
    assert (m["was"], m["case"], m["governor"], m["name"]) == ("", None, None, "Case ending")


def test_only_a_bracket_the_entry_has_is_filled() -> None:
    got = answer(
        filled=[{"english": "cooking", "word": "gotowanie"}, {"english": "dog", "word": "pies"}]
    )
    cleaned = clean(got, REQUEST)
    assert cleaned is not None
    assert cleaned["filled"] == [{"english": "cooking", "word": "gotowanie"}]


def test_a_sentence_judged_wrong_with_nothing_to_fix_stands_as_written() -> None:
    got = answer()
    got["sentences"][1]["verdict"] = "almost"
    cleaned = clean(got, REQUEST)
    assert cleaned is not None
    assert cleaned["sentences"][1]["verdict"] == "right"


def test_every_sentence_right_is_right_and_most_wrong_is_wrong() -> None:
    right = answer()
    for s in right["sentences"]:
        s["verdict"], s["mistakes"] = "right", []
        s["corrected"] = s["written"]
    cleaned = clean(right, REQUEST)
    assert cleaned is not None and cleaned["verdict"] == "right"
    wrong = answer()
    for s in wrong["sentences"][:3]:
        s["verdict"] = "wrong"
        s["corrected"] = s["corrected"] + " Tak."
    cleaned = clean(wrong, REQUEST)
    assert cleaned is not None and cleaned["verdict"] == "wrong"


def test_claude_is_asked_with_the_languages_kinds_and_the_entry() -> None:
    fake = FakeClient(response("end_turn", json.dumps(answer())))
    got, used = finish(claude_check(fake)(REQUEST))  # type: ignore[arg-type]
    assert got["sentences"][2]["mistakes"][0]["name"] == "Genitive ending"
    assert used.cost_usd() > 0
    system = fake.calls[0]["system"]
    assert "pl.past: Past tense" in system and "word_order: Word order" in system
    assert TEXT in fake.calls[0]["messages"][0]["content"]
    assert "yesterday evening" in fake.calls[0]["messages"][0]["content"]


def test_a_check_that_doesnt_match_fails_with_its_cost() -> None:
    fake = FakeClient(response("end_turn", json.dumps(answer(sentences=[]))))
    with pytest.raises(ProductionFailed) as e:
        finish(claude_check(fake)(REQUEST))  # type: ignore[arg-type]
    assert e.value.usage.cost_usd() > 0


def test_the_idea_is_the_same_all_day_and_changes_with_the_day() -> None:
    assert journal.idea("pl", "2026-11-20") == journal.idea("pl", "2026-11-20")
    ideas = {journal.idea("pl", f"2026-11-{d:02}") for d in range(1, 29)}
    assert len(ideas) > 5


# ==== Routes ====


WORDS = [
    Entry(1, "gotować", "to cook", "young", stability=1.0),
    Entry(2, "siostra", "sister", "young", stability=2.0),
    Entry(3, "chleb", "bread", "mature"),
]


class Clock:
    def __init__(self) -> None:
        self.now = NOW

    def __call__(self) -> datetime:
        return self.now


def client(check: Any = None, clock: Clock | None = None) -> tuple[TestClient, Engine]:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, WORDS, NOW, "pl")
    engine = Engine(
        conn, AppModel(IN_RANGE).ask_for, None, clock or Clock(), random.Random(1), zone=UTC
    )
    return started(create_app(engine, "open sesame", check_journal=check)), engine


def checker(seen: list[CheckRequest], result: dict[str, Any] | None = None) -> Any:
    async def check(request: CheckRequest) -> tuple[dict[str, Any], Usage]:
        seen.append(request)
        cleaned = clean(result or answer(), REQUEST)
        assert cleaned is not None
        return cleaned, COST

    return check


def test_an_entry_is_checked_kept_and_its_cost_counted() -> None:
    seen: list[CheckRequest] = []
    app, _ = client(checker(seen))
    body = {"language": "pl", "text": TEXT, "prompt": "What did you do?", "key": "k1"}
    got = app.post("/api/journal/check", json=body, headers=AUTH).json()
    assert got["tries"] == 1 and got["prompt"] == "What did you do?"
    assert got["check"]["sentences"][0]["corrected"] == "Wczoraj poszedłem do sklepu."
    assert got["created_at"].endswith("+00:00")
    assert seen == [CheckRequest("pl", TEXT, "What did you do?")]
    assert app.get(f"/api/journal/{got['id']}", headers=AUTH).json() == got
    other = app.get("/api/costs", headers=AUTH).json()["other_calls"]
    assert {"feature": "journal", "asked": 1, "cost_usd": 2.0} in other["features"]


def test_an_entry_sent_twice_is_checked_once() -> None:
    seen: list[CheckRequest] = []
    app, _ = client(checker(seen))
    body = {"language": "pl", "text": TEXT, "key": "held-1"}
    first = app.post("/api/journal/check", json=body, headers=AUTH).json()
    again = app.post("/api/journal/check", json=body, headers=AUTH).json()
    assert first == again and len(seen) == 1


def test_an_entry_resent_while_its_check_runs_is_checked_once() -> None:
    seen: list[CheckRequest] = []
    first_check = checker(seen)

    async def slow(request: CheckRequest) -> tuple[dict[str, Any], Usage]:
        await asyncio.sleep(0.3)  # longer than the phone waits before sending a held entry again
        return await first_check(request)

    app, _ = client(slow)
    body = {"language": "pl", "text": TEXT, "key": "held-2"}
    with ThreadPoolExecutor(2) as pool:
        sent = [
            pool.submit(app.post, "/api/journal/check", json=body, headers=AUTH) for _ in range(2)
        ]
        answers = [f.result() for f in sent]
    assert [a.status_code for a in answers] == [200, 200]
    assert answers[0].json() == answers[1].json() and len(seen) == 1


def test_writing_again_counts_the_first_checks_mistakes_only() -> None:
    seen: list[CheckRequest] = []
    app, _ = client(checker(seen))
    entry = app.post(
        "/api/journal/check", json={"language": "pl", "text": TEXT}, headers=AUTH
    ).json()
    fixed = TEXT.replace("ja idę", "poszedłem")
    again = app.post(
        "/api/journal/check",
        json={"language": "pl", "text": fixed, "entry_id": entry["id"]},
        headers=AUTH,
    ).json()
    assert again["id"] == entry["id"] and again["tries"] == 2 and again["text"] == fixed
    home = app.get("/api/journal?language=pl", headers=AUTH).json()
    counts = {k["group"]: k["count"] for k in home["kinds"]}
    assert counts == {"pl.past": 1, "case:genitive": 1, "case:instrumental": 1}
    [summary] = home["entries"]
    assert (summary["sentences"], summary["fixed"]) == (4, 3)


def test_the_home_counts_kinds_most_first_with_the_latest_example_and_an_idea() -> None:
    clock = Clock()
    app, _ = client(checker([]), clock)
    app.post("/api/journal/check", json={"language": "pl", "text": TEXT}, headers=AUTH)
    clock.now = NOW + timedelta(days=1)
    app.post("/api/journal/check", json={"language": "pl", "text": TEXT}, headers=AUTH)
    home = app.get("/api/journal?language=pl", headers=AUTH).json()
    assert [k["count"] for k in home["kinds"]][:1] == [2]
    past = next(k for k in home["kinds"] if k["group"] == "pl.past")
    assert (past["name"], past["point"], past["was"], past["now"]) == (
        "Past tense",
        "pl.past",
        "idę",
        "poszedłem",
    )
    genitive = next(k for k in home["kinds"] if k["group"] == "case:genitive")
    assert (genitive["name"], genitive["point"]) == ("Genitive ending", None)
    assert home["idea"]["prompt"] in journal.IDEAS
    assert {w["word"] for w in home["idea"]["words"]} <= {"gotować", "siostra"}
    assert home["checks"] is True
    # Older than the window: counted only for all time.
    clock.now = NOW + timedelta(days=journal.MISTAKE_DAYS + 2)
    assert app.get("/api/journal?language=pl", headers=AUTH).json()["kinds"] == []
    assert app.get("/api/journal?language=pl&days=0", headers=AUTH).json()["kinds"]


def test_deleting_an_entry_takes_its_mistakes_out_of_the_counts() -> None:
    app, _ = client(checker([]))
    entry = app.post(
        "/api/journal/check", json={"language": "pl", "text": TEXT}, headers=AUTH
    ).json()
    assert app.delete(f"/api/journal/{entry['id']}", headers=AUTH).status_code == 204
    home = app.get("/api/journal?language=pl", headers=AUTH).json()
    assert home["entries"] == [] and home["kinds"] == []
    gone = app.post(
        "/api/journal/check",
        json={"language": "pl", "text": TEXT, "entry_id": entry["id"]},
        headers=AUTH,
    )
    assert gone.status_code == 404
    assert app.get(f"/api/journal/{entry['id']}", headers=AUTH).status_code == 404


def test_without_claude_it_says_so_and_the_home_still_reads() -> None:
    app, _ = client(None)
    got = app.post("/api/journal/check", json={"language": "pl", "text": TEXT}, headers=AUTH)
    assert got.status_code == 503 and "ANTHROPIC_API_KEY" in got.json()["detail"]
    assert app.get("/api/journal?language=pl", headers=AUTH).json()["checks"] is False


def test_a_failed_check_keeps_what_it_cost_and_keeps_no_entry() -> None:
    async def check(request: CheckRequest) -> tuple[dict[str, Any], Usage]:
        raise ProductionFailed("Claude didn't check this. Try again in a moment.", COST)

    app, _ = client(check)
    got = app.post("/api/journal/check", json={"language": "pl", "text": TEXT}, headers=AUTH)
    assert got.status_code == 503 and got.json()["detail"].startswith("Claude didn't")
    other = app.get("/api/costs", headers=AUTH).json()["other_calls"]
    assert {"feature": "journal", "asked": 1, "cost_usd": 2.0} in other["features"]
    assert app.get("/api/journal?language=pl", headers=AUTH).json()["entries"] == []


def test_the_journal_needs_the_passphrase() -> None:
    app, _ = client(checker([]))
    assert app.get("/api/journal?language=pl").status_code == 401
    assert app.post("/api/journal/check", json={"language": "pl", "text": TEXT}).status_code == 401


# ==== Rotation ====


def test_a_practiced_point_with_a_recent_journal_mistake_isnt_learned() -> None:
    assert not rotation.graduates(rotation.Progress(rotation.TEXTS, rotation.DAYS, 9, 10, 1))
    assert rotation.graduates(rotation.Progress(rotation.TEXTS, rotation.DAYS, 9, 10, 0))


def test_journal_slips_count_from_practice_starting_within_the_window() -> None:
    clock = Clock()
    _, engine = client(None, clock)
    check = clean(answer(), REQUEST)
    assert check is not None
    journal_store.add(engine.conn, "pl", None, "", TEXT, check, NOW - timedelta(days=2))
    store.set_grammar_many(engine.conn, {"pl.past": "practice"}, NOW - timedelta(days=1))
    assert engine.grammar_progress("pl.past").journal_slips == 0  # before it was practiced
    journal_store.add(engine.conn, "pl", None, "", TEXT, check, NOW + timedelta(hours=1))
    clock.now = NOW + timedelta(days=1)
    assert engine.grammar_progress("pl.past").journal_slips == 1
    clock.now = NOW + timedelta(days=rotation.JOURNAL_DAYS + 1)
    assert engine.grammar_progress("pl.past").journal_slips == 0
