"""Word forms: which words of a text are asked about, what is kept, that a tap then finds the form, and
that the primers the chip opens are well formed in every language."""

import asyncio
import json
import random
from datetime import datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from test_app import AUTH, started
from test_generator import FakeClient, finish, response

from franki_reader import form_primers, store
from franki_reader.app import create_app
from franki_reader.coverage import check
from franki_reader.engine import FAILURE_COOLDOWN, Engine
from franki_reader.forms import (
    FormsFailed,
    candidates,
    claude_forms,
    is_current,
    keep,
    request_message,
    schema,
)
from franki_reader.generator import CHEAP_MODEL, Generated, Line, Usage
from franki_reader.languages import LANGUAGES
from franki_reader.lexicon import Entry, lexicon_from
from franki_reader.reader import render

NOW = datetime(2026, 11, 13, 9, 0)
DECK = [Entry(1, "mat", "food", "mature")]
LINES = (
    Line("A", "Jeg|snakket|med|henne|i|går.", "I talked with her yesterday."),
    Line("B", "Gutten|har|gått|hjem.|Snakket|han?", "The boy has gone home. Did he talk?"),
)
BILLED = Usage(1_000_000, 0, 0, 0)  # $2


class Writer:
    """Names the form of each word it is given from `answers`, and `none` for any other."""

    def __init__(self, answers: dict[str, str], fail: bool = False) -> None:
        self.answers = answers
        self.fail = fail
        self.asked: list[list[tuple[str, str, str, str]]] = []

    async def __call__(self, language: str, rows: list[tuple[str, str, str, str]]) -> Any:
        self.asked.append(list(rows))
        if self.fail:
            raise FormsFailed("down")
        words = [{"word": r[0], "form": self.answers.get(r[0], "none")} for r in rows]
        return words, BILLED


def stored_text(conn: Any, language: str = "nb", status: str = "ready") -> store.StoredText:
    lexicon = lexicon_from(DECK, "nb", 1000)
    coverage = check([ln.text for ln in LINES], lexicon)
    generated = Generated("t", LINES, {}, coverage, 1, True, ())
    topic = store.add_topic(conn, "Food", NOW)
    text_id = store.save_text(
        conn,
        topic.id,
        generated,
        [],
        0.95,
        NOW,
        status,
        "dialogue",
        language,  # type: ignore[arg-type]
    )
    text = store.get_text(conn, text_id)
    assert text is not None
    return text


# ==== Which words are asked about ====


def test_a_word_that_is_a_form_of_another_is_asked_about_once_with_its_line() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    rows = candidates(text, lexicon_from(DECK, "nb", 1000))
    by_word = {r[0]: r for r in rows}
    # snakket comes up twice (the second capitalized) and is asked about at its first appearance.
    assert [r[0] for r in rows].count("snakket") == 1 and "Snakket" not in by_word
    assert by_word["snakket"] == (
        "snakket",
        "snakke",
        "Jeg snakket med henne i går.",
        "I talked with her yesterday.",
    )
    assert by_word["gått"][1] == "gå"
    # A word that is its own dictionary form has nothing to say about its form.
    assert "med" not in by_word and "hjem" not in by_word


def test_the_request_lists_the_languages_forms_and_each_row() -> None:
    message = request_message("nb", [("snakket", "snakke", "Jeg snakket.", "I talked.")])
    assert "- past: past tense" in message
    assert "snakket | snakke | Jeg snakket. | I talked." in message
    assert '"helper"' in message and '"phrase"' in message


def test_the_schema_only_allows_the_languages_form_ids_and_none() -> None:
    item = schema("nb")["properties"]["words"]["items"]
    assert set(item["properties"]["form"]["enum"]) == {*form_primers.names("nb"), "none"}
    assert set(item["required"]) == {"word", "form", "helper", "phrase"}


# ==== What is kept ====


def plain(form: str) -> dict[str, str]:
    return {"id": form, "helper": "", "phrase": ""}


def test_only_a_listed_form_for_a_word_that_was_asked_about_is_kept() -> None:
    rows = [("snakket", "snakke", "x", "x"), ("gått", "gå", "x", "x")]
    raw = [
        {"word": "Snakket", "form": "past"},  # lower-cased: how it is kept
        {"word": "gått", "form": "none"},
        {"word": "hun", "form": "past"},  # nobody asked
        {"word": "snakket", "form": "participle"},  # a second answer for the same word
        {"word": "gått", "form": "not-a-form"},
        "garbage",
        {"word": 3, "form": "past"},
    ]
    assert keep("nb", raw, rows) == {"snakket": plain("past")}


HOODS = (
    "капюшонах",
    "капюшон",
    "Три тёмные фигуры в тёмных капюшонах встают",
    "Three dark figures",
)


def hoods(**fields: Any) -> dict[str, Any]:
    return {"word": "капюшонах", "form": "prepositional", **fields}


def test_a_helper_and_phrase_are_kept_when_the_helper_is_one_of_the_languages_for_the_form() -> (
    None
):
    # An adjective stands between the preposition and the word, which is fine.
    raw = [hoods(helper="в", phrase="in hoods")]
    assert keep("ru", raw, [HOODS]) == {
        "капюшонах": {"id": "prepositional", "helper": "в", "phrase": "in hoods"}
    }
    # How the line spells it doesn't matter: case and surrounding space.
    raw = [hoods(helper=" В ", phrase=" in hoods ")]
    assert keep("ru", raw, [HOODS])["капюшонах"]["helper"] == "В"


@pytest.mark.parametrize(
    "fields",
    [
        {"helper": "на", "phrase": "on hoods"},  # not a word of the line
        {"helper": "встают", "phrase": "stand"},  # not a preposition
        {"helper": "фигуры", "phrase": "figures"},  # a noun
        {"helper": "капюшонах", "phrase": "hoods"},  # the word itself
        {"helper": "в", "phrase": ""},
        {"helper": "", "phrase": "in hoods"},
        {"helper": "в", "phrase": "x" * 41},
        {"helper": 1, "phrase": "in hoods"},
        {},
    ],
)
def test_a_form_without_a_usable_helper_is_kept_without_it(fields: dict[str, Any]) -> None:
    assert keep("ru", [hoods(**fields)], [HOODS]) == {"капюшонах": plain("prepositional")}


def test_a_preposition_must_come_before_the_word() -> None:
    row = ("доме", "дом", "Доме в", "x")
    raw = [{"word": "доме", "form": "prepositional", "helper": "в", "phrase": "in the house"}]
    assert keep("ru", raw, [row]) == {"доме": plain("prepositional")}


def lemma(word: str) -> str | None:
    return {"помогает": "помогать", "friend": None}.get(word)


def test_a_verb_gives_its_case_only_when_that_is_the_case_it_takes() -> None:
    row = ("другу", "друг", "Он помогает другу", "He helps a friend")
    dative = [
        {"word": "другу", "form": "dative", "helper": "помогает", "phrase": "helps (a friend)"}
    ]
    assert keep("ru", dative, [row], lemma)["другу"]["helper"] == "помогает"
    # помогать takes the dative: the same verb is not claimed for a genitive.
    genitive = [{**dative[0], "form": "genitive"}]
    assert keep("ru", genitive, [row], lemma)["другу"]["helper"] == ""
    # A verb that isn't on the list gives nothing, and neither does a word with no lemma.
    assert keep("ru", dative, [row])["другу"]["helper"] == ""


def test_an_auxiliary_may_come_after_its_participle_as_in_a_german_subordinate_clause() -> None:
    row = ("gegessen", "essen", "Ich weiß, dass er gegessen hat", "I know he has eaten")
    raw = [{"word": "gegessen", "form": "participle", "helper": "hat", "phrase": "has eaten"}]
    assert keep("de", raw, [row])["gegessen"] == {
        "id": "participle",
        "helper": "hat",
        "phrase": "has eaten",
    }


@pytest.mark.parametrize(
    ("language", "form", "helper", "line", "word"),
    [
        ("fr", "participle", "a", "Il a mangé", "mangé"),
        ("es", "participle", "he", "Yo he comido", "comido"),
        ("es", "gerund", "está", "Ella está comiendo", "comiendo"),
        ("es", "present-subjunctive", "que", "Quiero que vengas", "vengas"),
        ("fr", "subjunctive", "que", "Il faut que tu viennes", "viennes"),
        ("el", "subjunctive", "να", "Θέλω να πάω", "πάω"),
        ("nb", "participle", "har", "Jeg har gått", "gått"),
    ],
)
def test_the_auxiliaries_and_triggers_of_each_language_are_recognized(
    language: str, form: str, helper: str, line: str, word: str
) -> None:
    row = (word, word, line, "x")
    raw = [{"word": word, "form": form, "helper": helper, "phrase": "x"}]
    assert keep(language, raw, [row])[word.casefold()]["helper"] == helper  # type: ignore[arg-type]


def test_a_helper_with_a_final_sigma_or_eszett_is_found_in_its_line() -> None:
    greek = ("δουλεύω", "δουλεύω", "Δουλεύω προς το σπίτι", "x")
    raw = [{"word": "σπίτι", "form": "accusative", "helper": "προς", "phrase": "toward the house"}]
    assert keep("el", raw, [("σπίτι", "σπίτι", greek[2], "x")])["σπίτι"]["helper"] == "προς"
    german = [{"word": "Haus", "form": "dative", "helper": "außer", "phrase": "except the house"}]
    row = ("Haus", "Haus", "Alle außer dem Haus", "x")
    assert keep("de", german, [row])["haus"]["helper"] == "außer"


def test_a_form_that_does_not_take_that_helper_never_keeps_it() -> None:
    # que goes with a subjunctive, not with a present tense.
    row = ("viene", "venir", "Dice que viene", "He says he comes")
    raw = [{"word": "viene", "form": "present", "helper": "que", "phrase": "that he comes"}]
    assert keep("es", raw, [row]) == {"viene": plain("present")}


def test_forms_kept_before_helpers_are_current_only_where_a_language_has_them() -> None:
    old = {"капюшонах": {"id": "prepositional"}}
    assert not is_current("ru", old)
    assert not is_current("nb", {"snakket": {"id": "past"}})  # nb has auxiliaries now
    assert is_current("ja", {"食べた": {"id": "past"}})  # no helper words to ask for
    assert is_current("ru", {})
    assert is_current("ru", {"капюшонах": plain("prepositional")})


# ==== The engine ====


def test_the_engine_keeps_the_forms_and_the_cost_and_asks_a_text_once() -> None:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, DECK, NOW, "nb")
    text = stored_text(conn)
    writer = Writer({"snakket": "past", "gått": "participle"})
    engine = Engine(conn, None, None, lambda: NOW, random.Random(1), write_forms=writer)

    asyncio.run(engine.fill_forms([text]))
    kept = store.get_text(conn, text.id)
    assert kept is not None and kept.forms == {
        "snakket": plain("past"),
        "gått": plain("participle"),
    }
    assert store.form_spending(conn, NOW - timedelta(days=1)) == {"nb": (1, 2.0)}

    asyncio.run(engine.fill_forms([text]))  # the stale copy is read again: already asked
    assert len(writer.asked) == 1


def test_a_text_whose_words_were_all_none_is_not_asked_again() -> None:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, DECK, NOW, "nb")
    text = stored_text(conn)
    writer = Writer({})
    engine = Engine(conn, None, None, lambda: NOW, random.Random(1), write_forms=writer)
    asyncio.run(engine.fill_forms([text]))
    asyncio.run(engine.fill_forms([text]))
    again = store.get_text(conn, text.id)
    assert again is not None and again.forms == {} and len(writer.asked) == 1


def test_a_text_with_no_inflected_words_costs_no_call() -> None:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, DECK, NOW, "nb")
    lexicon = lexicon_from(DECK, "nb", 1000)
    only = (Line("A", "Mat|og|vann.", "Food and water."),)
    generated = Generated("t", only, {}, check(["Mat|og|vann."], lexicon), 1, True, ())
    topic = store.add_topic(conn, "Food", NOW)
    text_id = store.save_text(conn, topic.id, generated, [], 0.95, NOW, "ready", "dialogue", "nb")
    text = store.get_text(conn, text_id)
    assert text is not None
    writer = Writer({})
    engine = Engine(conn, None, None, lambda: NOW, random.Random(1), write_forms=writer)
    asyncio.run(engine.fill_forms([text]))
    assert writer.asked == []
    again = store.get_text(conn, text_id)
    assert again is not None and again.forms == {}


def test_a_failure_leaves_the_text_unasked_and_waits_before_trying_again() -> None:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, DECK, NOW, "nb")
    text = stored_text(conn)
    now = [NOW]
    writer = Writer({"snakket": "past"}, fail=True)
    engine = Engine(conn, None, None, lambda: now[0], random.Random(1), write_forms=writer)

    asyncio.run(engine.fill_forms([text]))
    asyncio.run(engine.fill_forms([text]))
    assert len(writer.asked) == 1  # cooling down
    left = store.get_text(conn, text.id)
    assert left is not None and left.forms is None  # still to be asked

    now[0] += FAILURE_COOLDOWN
    writer.fail = False
    asyncio.run(engine.fill_forms([text]))
    done = store.get_text(conn, text.id)
    assert done is not None and done.forms == {"snakket": plain("past")}


def test_a_call_that_failed_after_claude_answered_still_shows_its_cost() -> None:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, DECK, NOW, "nb")
    text = stored_text(conn)

    async def cut_off(language: str, rows: list[Any]) -> Any:
        raise FormsFailed("No forms (max_tokens)", BILLED)

    engine = Engine(conn, None, None, lambda: NOW, random.Random(1), write_forms=cut_off)
    c: TestClient = started(create_app(engine, "open sesame"))
    asyncio.run(engine.fill_forms([text]))
    costs = c.get("/api/costs", headers=AUTH).json()["forms"]
    assert costs["asked"] == 1 and costs["cost_usd"] == 2.0
    assert costs["languages"][0]["language"] == "nb"


def test_thai_has_no_forms_so_nothing_is_asked() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn, language="th")
    writer = Writer({})
    engine = Engine(conn, None, None, lambda: NOW, random.Random(1), write_forms=writer)
    asyncio.run(engine.fill_forms([text]))
    assert writer.asked == []


def test_without_a_writer_nothing_is_asked() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    engine = Engine(conn, None, None, lambda: NOW, random.Random(1))
    asyncio.run(engine.fill_forms([text]))
    again = store.get_text(conn, text.id)
    assert again is not None and again.forms is None


def test_a_pass_picks_forms_for_the_few_newest_texts_still_without() -> None:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, DECK, NOW, "nb")
    store.save_settings(conn, store.Settings(language="nb"))
    for _ in range(5):
        stored_text(conn)
    writer = Writer({})
    engine = Engine(conn, None, None, lambda: NOW, random.Random(1), write_forms=writer)
    asyncio.run(engine.top_up())
    assert len(writer.asked) == 3  # BACKFILL_FORMS


# ==== What the app is sent ====


def test_a_word_carries_the_form_the_text_kept_for_it() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    store.save_forms(
        conn, text.id, {"snakket": plain("past"), "gått": plain("removed-from-the-catalog")}
    )
    kept = store.get_text(conn, text.id)
    assert kept is not None
    out = render(kept, lexicon_from(DECK, "nb", 1000), {})
    words = {w["text"]: w for line in out["lines"] for w in line["words"]}
    assert words["snakket"]["form"] == {"id": "past", "name": "past tense"}
    assert words["Snakket"]["form"] == {"id": "past", "name": "past tense"}  # same word
    assert words["gått"]["form"] is None  # an id the catalog no longer has
    assert words["med"]["form"] is None and words["i"]["form"] is None


def test_a_text_not_yet_asked_has_no_form_on_any_word() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    assert text.forms is None
    out = render(text, lexicon_from(DECK, "nb", 1000), {})
    assert all(w["form"] is None for line in out["lines"] for w in line["words"])


def test_the_forms_endpoint_serves_a_languages_primers_and_none_for_thai() -> None:
    conn = store.connect(":memory:")
    engine = Engine(conn, None, None, lambda: NOW, random.Random(1))
    c: TestClient = started(create_app(engine, "open sesame"))
    primers = c.get("/api/forms?language=ru", headers=AUTH).json()["forms"]
    instrumental = next(p for p in primers if p["id"] == "instrumental")
    assert instrumental["name"] == "instrumental case" and instrumental["examples"]
    assert c.get("/api/forms?language=th", headers=AUTH).json() == {"forms": []}
    assert c.get("/api/forms?language=xx", headers=AUTH).status_code == 422
    assert c.get("/api/forms?language=ru").status_code == 401


def test_a_words_helper_and_phrase_reach_the_app_only_when_there_are_some() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    store.save_forms(
        conn,
        text.id,
        {
            "snakket": {"id": "past", "helper": "", "phrase": ""},
            "gått": {"id": "participle", "helper": "har", "phrase": "has gone"},
        },
    )
    kept = store.get_text(conn, text.id)
    assert kept is not None
    out = render(kept, lexicon_from(DECK, "nb", 1000), {})
    words = {w["text"]: w for line in out["lines"] for w in line["words"]}
    assert words["snakket"]["form"] == {"id": "past", "name": "past tense"}
    assert words["gått"]["form"] == {
        "id": "participle",
        "name": "past participle",
        "helper": "har",
        "phrase": "has gone",
    }


def test_forms_kept_as_a_bare_id_before_helpers_still_read() -> None:
    conn = store.connect(":memory:")
    text = stored_text(conn)
    with conn:
        conn.execute(
            "UPDATE texts SET forms = ? WHERE id = ?", (json.dumps({"snakket": "past"}), text.id)
        )
    kept = store.get_text(conn, text.id)
    assert kept is not None and kept.forms == {"snakket": {"id": "past"}}
    out = render(kept, lexicon_from(DECK, "nb", 1000), {})
    words = {w["text"]: w for line in out["lines"] for w in line["words"]}
    assert words["snakket"]["form"] == {"id": "past", "name": "past tense"}


def test_a_text_kept_before_helpers_is_asked_again_once() -> None:
    conn = store.connect(":memory:")
    deck = [Entry(1, "дом", "house", "mature")]
    store.save_snapshot(conn, deck, NOW, "ru")
    lexicon = lexicon_from(deck, "ru", 1000)
    lines = (Line("A", "Он|живёт|в|доме.", "He lives in the house."),)
    generated = Generated("t", lines, {}, check([ln.text for ln in lines], lexicon), 1, True, ())
    topic = store.add_topic(conn, "Home", NOW)
    text_id = store.save_text(conn, topic.id, generated, [], 0.95, NOW, "ready", "dialogue", "ru")
    text = store.get_text(conn, text_id)
    assert text is not None
    with conn:
        conn.execute(
            "UPDATE texts SET forms = ? WHERE id = ?",
            (json.dumps({"доме": "prepositional"}), text_id),
        )
    asked = [{"word": "доме", "form": "prepositional", "helper": "в", "phrase": "in the house"}]

    async def write(language: str, rows: list[Any]) -> Any:
        calls.append(rows)
        return asked, BILLED

    calls: list[Any] = []
    engine = Engine(conn, None, None, lambda: NOW, random.Random(1), write_forms=write)
    asyncio.run(engine.fill_forms([text]))
    asyncio.run(engine.fill_forms([text]))  # now current: not asked again
    assert len(calls) == 1
    again = store.get_text(conn, text_id)
    assert again is not None and again.forms == {
        "доме": {"id": "prepositional", "helper": "в", "phrase": "in the house"}
    }


# ==== Claude's call ====


def test_claude_forms_asks_for_the_languages_ids_in_a_schema() -> None:
    answer = json.dumps({"words": [{"word": "snakket", "form": "past"}]})
    client = FakeClient(response("end_turn", answer))
    write = claude_forms(client)  # type: ignore[arg-type]
    words, used = finish(write("nb", [("snakket", "snakke", "Jeg snakket.", "I talked.")]))
    assert words == [{"word": "snakket", "form": "past"}] and used.output_tokens == 900
    sent = client.calls[0]
    enum = sent["output_config"]["format"]["schema"]["properties"]["words"]["items"]
    assert "past" in enum["properties"]["form"]["enum"]
    assert sent["model"] == CHEAP_MODEL
    assert "fallbacks" not in sent and "betas" not in sent


@pytest.mark.parametrize(
    ("stop_reason", "text"),
    [("refusal", None), ("max_tokens", '{"words"'), ("end_turn", None), ("end_turn", "not json")],
)
def test_claude_forms_keeps_the_usage_of_an_answer_it_cant_use(
    stop_reason: str, text: str | None
) -> None:
    write = claude_forms(FakeClient(response(stop_reason, text)))  # type: ignore[arg-type]
    with pytest.raises(FormsFailed) as failed:
        finish(write("nb", [("snakket", "snakke", "Jeg snakket.", "I talked.")]))
    assert failed.value.usage.output_tokens == 900


# ==== The primers ====


# Thai has no inflection, and English is read by someone who already knows its grammar: neither is
# ever asked about its forms.
NO_FORMS = ("th", "en", "tok")


def test_every_language_has_primers_except_thai_and_english() -> None:
    for code in LANGUAGES:
        assert bool(form_primers.primers(code)) == (code not in NO_FORMS), code


@pytest.mark.parametrize("code", [c for c in LANGUAGES if c not in NO_FORMS])
def test_a_primer_is_well_formed(code: str) -> None:
    primers = form_primers.primers(code)
    ids = [p["id"] for p in primers]
    assert len(ids) == len(set(ids)) and "none" not in ids
    for p in primers:
        assert set(p) == {"id", "name", "summary", "table", "examples"}, p["id"]
        assert p["name"] and p["summary"] and p["examples"], p["id"]
        table = p["table"]
        if table:
            # Every row has a cell for each column, so the app can lay it out as a grid.
            assert table["rows"] and all(len(r) == len(table["head"]) for r in table["rows"]), p[
                "id"
            ]
        texts = [p["summary"], *(e["text"] + e["english"] for e in p["examples"])]
        if table:
            texts += [c for row in [table["head"], *table["rows"]] for c in row]
        for t in texts:
            assert "—" not in t, (code, p["id"])  # no em dashes in what the app shows
        for e in p["examples"]:
            assert e["text"].count("*") % 2 == 0, (code, p["id"], e["text"])
        for row in table["rows"] if table else []:
            assert all(c.count("*") % 2 == 0 for c in row), (code, p["id"], row)
