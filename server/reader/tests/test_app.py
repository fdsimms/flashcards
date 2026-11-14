import random
import time
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from franki_speech import SpeechError, WordMark
from scripted import BAD, ENTRIES, IN_RANGE, ScriptedModel

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.gateway import AnkiUnavailable
from franki_reader.languages import Code
from franki_reader.status import DeckDue, DueStatus, LearningLater, StudyDay
from franki_reader.store import Settings
from franki_reader.tts import Spoken

NOW = datetime(2026, 10, 19, 9, 0)
AUTH = {"Authorization": "Bearer open sesame"}


_open: list[TestClient] = []


@pytest.fixture(autouse=True)
def _close_clients() -> Iterator[None]:
    yield
    while _open:
        _open.pop().__exit__(None, None, None)


def started(app: Any) -> TestClient:
    # Entered, so the event loop (and the background writes started on it) outlives each request.
    c = TestClient(app)
    c.__enter__()
    _open.append(c)
    return c


def client(
    model: ScriptedModel | None = None, passphrase: str | None = "open sesame"
) -> TestClient:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    model = model or ScriptedModel(IN_RANGE)
    engine = Engine(conn, model.ask_for, None, lambda: NOW, random.Random(1))
    return started(create_app(engine, passphrase))


def next_text(c: TestClient, topic_id: int) -> Any:
    """What the app does: ask, and while the answer is 202, ask again shortly."""
    deadline = time.time() + 10
    while True:
        response = c.post(f"/api/topics/{topic_id}/next", headers=AUTH)
        if response.status_code != 202 or time.time() > deadline:
            return response
        time.sleep(0.02)


def test_health_needs_no_passphrase() -> None:
    assert client().get("/health").json() == {"status": "ok"}


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer nope"}, {"Authorization": "x"}])
def test_api_routes_refuse_a_missing_or_wrong_passphrase(headers: dict[str, str]) -> None:
    c = client()
    assert c.get("/api/check", headers=headers).status_code == 401
    assert c.get("/api/topics", headers=headers).status_code == 401


def test_the_right_passphrase_checks_out() -> None:
    assert client().get("/api/check", headers=AUTH).status_code == 204


def test_no_passphrase_configured_refuses_everything() -> None:
    c = client(passphrase=None)
    response = c.get("/api/check", headers={"Authorization": "Bearer "})
    assert response.status_code == 503
    assert response.json()["detail"] == "The server has no passphrase set."


def test_adding_a_topic_writes_nothing_until_asked() -> None:
    model = ScriptedModel(IN_RANGE)
    c = client(model)

    added = c.post("/api/topics", json={"name": "  Food   stall "}, headers=AUTH).json()

    assert added["name"] == "Food stall"
    # Nothing is written unasked, the shelf included.
    assert c.get("/api/topics", headers=AUTH).json()[0]["ready"] == 0
    assert model.calls == 0


def test_adding_the_same_topic_twice_returns_the_first() -> None:
    c = client()
    first = c.post("/api/topics", json={"name": "Taxi"}, headers=AUTH).json()
    second = c.post("/api/topics", json={"name": "taxi"}, headers=AUTH).json()
    assert first["id"] == second["id"]


def test_next_text_returns_the_server_split_lines() -> None:
    c = client()
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()

    text = next_text(c, topic["id"]).json()

    assert text["title"] == "At the stall"
    first_line = text["lines"][0]
    assert first_line["speaker"] == "A"
    assert [w["text"] for w in first_line["words"]][:3] == ["ฉัน", "อยาก", "กิน"]
    assert text["stretch"] == ["ข้าวเหนียวมะม่วง"]


def test_next_text_explains_a_failed_generation() -> None:
    c = client(ScriptedModel(BAD))
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    response = next_text(c, topic["id"])
    assert response.status_code == 503
    assert "Couldn't write a text" in response.json()["detail"]
    assert c.get("/api/topics", headers=AUTH).json()[0]["state"] == "failed"


def test_next_text_for_a_missing_topic_is_404() -> None:
    assert client().post("/api/topics/99/next", headers=AUTH).status_code == 404


def test_logging_a_reading() -> None:
    c = client()
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    text = next_text(c, topic["id"]).json()

    response = c.post(
        f"/api/texts/{text['id']}/reading",
        json={
            "rating": "about_right",
            "finished": True,
            "words_glossed": ["กิน"],
            "words_flagged": ["ครับ"],
            "audio_speed": 0.8,
            "seconds": 95,
        },
        headers=AUTH,
    )

    assert response.status_code == 204
    assert c.post("/api/texts/999/reading", json={}, headers=AUTH).status_code == 404
    assert (
        c.post(f"/api/texts/{text['id']}/reading", json={"rating": "meh"}, headers=AUTH).status_code
        == 422
    )


def speaking_client(tmp_path: Path, timed: bool = False) -> TestClient:
    from franki_reader.tts import AudioCache

    async def voice(text: str, name: str, language: str) -> Spoken:
        # Timed: the whole line as one word, so every word in it is spoken from 0 to 1000 ms.
        return Spoken(b"ID3" + text.encode(), [WordMark(text, 0, 1000)] if timed else None)

    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(
        conn,
        ScriptedModel(IN_RANGE).ask_for,
        None,
        lambda: NOW,
        random.Random(1),
        synthesize=voice,
        audio=AudioCache(tmp_path),
    )
    return started(create_app(engine, "open sesame"))


def test_lines_say_whether_they_have_audio() -> None:
    c = client()  # no text to speech set up
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    text = next_text(c, topic["id"]).json()
    assert [line["audio"] for line in text["lines"]] == [False, False]


def test_each_word_says_when_its_spoken_once_its_line_is_recorded_with_timings(
    tmp_path: Path,
) -> None:
    c = speaking_client(tmp_path, timed=True)
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    text = next_text(c, topic["id"]).json()
    words = [w for line in text["lines"] for w in line["words"]]
    assert all(w["time"] == [0, 1000] for w in words if w["status"] is not None)
    assert all("time" not in w for w in words if w["status"] is None)

    untimed = speaking_client(tmp_path / "untimed")
    topic = untimed.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    text = next_text(untimed, topic["id"]).json()
    assert all("time" not in w for line in text["lines"] for w in line["words"])


def test_a_lines_audio_is_served_as_mp3(tmp_path: Path) -> None:
    c = speaking_client(tmp_path)
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    text = next_text(c, topic["id"]).json()
    assert all(line["audio"] for line in text["lines"])

    response = c.get(f"/api/texts/{text['id']}/lines/0/audio", headers=AUTH)

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.content.startswith(b"ID3")
    assert c.get(f"/api/texts/{text['id']}/lines/0/audio").status_code == 401
    assert c.get(f"/api/texts/{text['id']}/lines/9/audio", headers=AUTH).status_code == 404
    assert c.get("/api/texts/999/lines/0/audio", headers=AUTH).status_code == 404


def test_a_topic_with_nothing_ready_answers_202_then_the_text() -> None:
    c = client()
    topic = c.post("/api/topics", json={"name": "Taxi"}, headers=AUTH).json()
    assert topic["state"] == "idle"

    first = c.post(f"/api/topics/{topic['id']}/next", headers=AUTH)
    assert first.status_code == 202
    assert first.json() == {"writing": True}

    text = next_text(c, topic["id"])
    assert text.status_code == 200
    assert text.json()["title"] == "At the stall"


def test_topics_report_their_state() -> None:
    c = client()
    c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH)
    c.post("/api/topics", json={"name": "Taxi"}, headers=AUTH)
    food = c.get("/api/topics", headers=AUTH).json()[0]
    next_text(c, food["id"])  # a text written for it waits to be read
    states = {t["name"]: t["state"] for t in c.get("/api/topics", headers=AUTH).json()}
    assert states == {"Food stall": "ready", "Taxi": "idle"}


def test_a_passphrase_with_non_ascii_characters_works() -> None:
    conn = store.connect(":memory:")
    engine = Engine(conn, None, None, lambda: NOW)
    c = started(create_app(engine, "pässword"))
    utf8 = "Bearer pässword".encode()  # the bytes a phone sends
    assert c.get("/api/check", headers={b"Authorization": utf8}).status_code == 204
    assert c.get("/api/check", headers={"Authorization": "Bearer password"}).status_code == 401


def test_a_repeated_reading_is_accepted_but_counted_once() -> None:
    c = client()
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    text = next_text(c, topic["id"]).json()
    body = {"rating": "too_hard", "finished": True}
    assert c.post(f"/api/texts/{text['id']}/reading", json=body, headers=AUTH).status_code == 204
    assert c.post(f"/api/texts/{text['id']}/reading", json=body, headers=AUTH).status_code == 204


# Each language's deck, as the settings report it when none was chosen.
DECKS = {
    "th": "👅 Languages::🐘 ภาษาไทย",
    "es": "👅 Languages::🌮 Español",
    "de": "👅 Languages::🥨 Deutsch",
    "fr": "👅 Languages::🥐 Français",
    "ru": "👅 Languages::🐻 Русский",
    "el": "👅 Languages::🏝️ Ελληνικά",
    "pl": "👅 Languages::💈 Polski",
    "nb": "👅 Languages::🐟 Norsk",
    "ja": "👅 Languages::🍥 日本語",
    "en": "👅 Languages::🗽 English",
}
# How many common words each language counts as known when none was chosen (not Thai: deck only).
COMMON = {
    "es": 10000,
    "de": 3000,
    "fr": 3000,
    "ru": 3000,
    "el": 3000,
    "pl": 250,
    "nb": 1000,
    "ja": 2000,
    "en": 5000,
}
# Each language's voice for each slot (the first of a gender where it has no second), the same.
VOICES = {
    "th": {
        "male": "th-TH-NiwatNeural",
        "male2": "th-TH-NiwatNeural",
        "female": "th-TH-PremwadeeNeural",
        "female2": "th-TH-AcharaNeural",
    },
    "es": {
        "male": "es-MX-JorgeNeural",
        "male2": "es-MX-CecilioNeural",
        "female": "es-MX-DaliaNeural",
        "female2": "es-MX-BeatrizNeural",
    },
    "de": {
        "male": "de-DE-ConradNeural",
        "male2": "de-DE-BerndNeural",
        "female": "de-DE-KatjaNeural",
        "female2": "de-DE-AmalaNeural",
    },
    "fr": {
        "male": "fr-FR-HenriNeural",
        "male2": "fr-FR-AlainNeural",
        "female": "fr-FR-DeniseNeural",
        "female2": "fr-FR-BrigitteNeural",
    },
    "ru": {
        "male": "ru-RU-DmitryNeural",
        "male2": "ru-RU-DmitryNeural",
        "female": "ru-RU-SvetlanaNeural",
        "female2": "ru-RU-DariyaNeural",
    },
    "el": {
        "male": "el-GR-NestorasNeural",
        "male2": "el-GR-NestorasNeural",
        "female": "el-GR-AthinaNeural",
        "female2": "el-GR-AthinaNeural",
    },
    "pl": {
        "male": "pl-PL-MarekNeural",
        "male2": "pl-PL-MarekNeural",
        "female": "pl-PL-ZofiaNeural",
        "female2": "pl-PL-AgnieszkaNeural",
    },
    "nb": {
        "male": "nb-NO-FinnNeural",
        "male2": "nb-NO-FinnNeural",
        "female": "nb-NO-PernilleNeural",
        "female2": "nb-NO-IselinNeural",
    },
    "ja": {
        "male": "ja-JP-KeitaNeural",
        "male2": "ja-JP-DaichiNeural",
        "female": "ja-JP-NanamiNeural",
        "female2": "ja-JP-AoiNeural",
    },
    "en": {
        "male": "en-US-GuyNeural",
        "male2": "en-US-DavisNeural",
        "female": "en-US-JennyNeural",
        "female2": "en-US-AriaNeural",
    },
}


def test_the_stretch_setting_can_be_read_and_changed() -> None:
    c = client()
    assert c.get("/api/settings", headers=AUTH).json() == {
        "stretch_words": "topic",
        "lines": 8,
        "form": "dialogue",
        "language": "th",
        "decks": DECKS,
        "voices": VOICES,
        "common": COMMON,
    }
    changed = c.patch("/api/settings", headers=AUTH, json={"stretch_words": "any"})
    assert changed.json() == {
        "stretch_words": "any",
        "lines": 8,
        "form": "dialogue",
        "language": "th",
        "decks": DECKS,
        "voices": VOICES,
        "common": COMMON,
    }
    assert c.get("/api/settings", headers=AUTH).json() == {
        "stretch_words": "any",
        "lines": 8,
        "form": "dialogue",
        "language": "th",
        "decks": DECKS,
        "voices": VOICES,
        "common": COMMON,
    }
    assert (
        c.patch("/api/settings", headers=AUTH, json={"stretch_words": "loose"}).status_code == 422
    )
    assert c.get("/api/settings").status_code == 401


def test_a_removed_topic_leaves_the_list_and_comes_back_when_added_again() -> None:
    c = client()
    topic = c.post("/api/topics", json={"name": "Taxi"}, headers=AUTH).json()

    assert c.delete(f"/api/topics/{topic['id']}", headers=AUTH).status_code == 204
    assert c.get("/api/topics", headers=AUTH).json() == []
    assert c.post(f"/api/topics/{topic['id']}/next", headers=AUTH).status_code == 404
    assert c.delete(f"/api/topics/{topic['id']}", headers=AUTH).status_code == 404

    again = c.post("/api/topics", json={"name": "taxi"}, headers=AUTH).json()
    assert again["id"] == topic["id"]
    assert [t["name"] for t in c.get("/api/topics", headers=AUTH).json()] == ["Taxi"]


def read(c: TestClient, rating: str | None, flagged: list[str], finished: bool = True) -> None:
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    text = next_text(c, topic["id"]).json()
    body = {"rating": rating, "finished": finished, "words_flagged": flagged}
    assert c.post(f"/api/texts/{text['id']}/reading", json=body, headers=AUTH).status_code == 204


def test_progress_counts_finished_texts_and_says_how_hard_the_next_is() -> None:
    c = client()
    empty = c.get("/api/progress", headers=AUTH).json()
    assert empty["finished"] == 0
    assert empty["median_coverage"] is None
    assert empty["next"] == {"floor": 0.92, "stretch": 2}

    read(c, "about_right", [])
    read(c, "too_hard", [])
    read(c, None, [], finished=False)  # backed out of: not counted

    progress = c.get("/api/progress", headers=AUTH).json()
    assert progress["days"] == 14
    assert progress["finished"] == 2
    assert progress["median_coverage"] == 0.95
    assert progress["ratings"] == {"too_easy": 0, "about_right": 1, "too_hard": 1, "none": 0}
    assert progress["next"] == {"floor": 0.93, "stretch": 1}
    assert c.get("/api/progress").status_code == 401


def test_costs_count_every_text_written_and_what_each_read_one_cost() -> None:
    c = client()
    empty = c.get("/api/costs", headers=AUTH).json()
    assert empty["days"] == 30 and empty["languages"] == []
    assert empty["total"]["texts"] == 0 and empty["total"]["per_read_text_usd"] is None

    read(c, "about_right", [])
    read(c, None, [])
    costs = c.get("/api/costs", params={"days": 7}, headers=AUTH).json()
    assert costs["days"] == 7
    [thai] = costs["languages"]
    assert (thai["language"], thai["name"], thai["read"]) == ("th", "Thai", 2)
    # Texts written and not read count too.
    assert thai["texts"] == thai["read"] + thai["waiting"] + thai["dropped"] >= 2
    assert thai["cost_usd"] > 0
    assert thai["per_read_text_usd"] == pytest.approx(thai["cost_usd"] / 2, abs=1e-4)
    assert costs["total"]["cost_usd"] == thai["cost_usd"]
    # No text to speech here, so no audio: the totals are Claude's alone.
    assert thai["audio_chars"] == 0 and thai["azure_usd"] == 0
    assert thai["total_usd"] == thai["cost_usd"]
    assert c.get("/api/costs", params={"days": 0}, headers=AUTH).status_code == 422
    assert c.get("/api/costs").status_code == 401


def test_costs_add_azures_audio_estimated_from_the_characters_spoken() -> None:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1))
    c = started(create_app(engine, "open sesame"))
    read(c, "about_right", [])
    read(c, None, [])
    conn.execute("UPDATE texts SET audio_chars = 500000 WHERE id = 1")
    conn.commit()

    costs = c.get("/api/costs", headers=AUTH).json()
    [thai] = costs["languages"]

    assert thai["audio_chars"] == 500000
    assert thai["azure_usd"] == 7.5  # $15 per million characters
    assert thai["total_usd"] == pytest.approx(thai["cost_usd"] + 7.5, abs=1e-3)
    assert thai["total_per_read_text_usd"] == pytest.approx(thai["total_usd"] / 2, abs=1e-3)
    assert costs["total"]["azure_usd"] == 7.5


def test_marked_words_are_listed_with_glosses_until_cleared() -> None:
    c = client()
    read(c, None, ["ครับ"])
    read(c, None, ["ครับ", "ข้าวเหนียวมะม่วง"])

    words = c.get("/api/words", headers=AUTH).json()
    assert [(w["word"], w["times"], w["status"]) for w in words] == [
        ("ครับ", 2, "known"),
        ("ข้าวเหนียวมะม่วง", 1, "known"),
    ]
    assert words[0]["gloss"] == "polite particle (male)"
    assert words[0]["deck"] is True

    assert c.post("/api/words/clear", json={"word": "ครับ"}, headers=AUTH).status_code == 204
    assert [w["word"] for w in c.get("/api/words", headers=AUTH).json()] == ["ข้าวเหนียวมะม่วง"]
    assert c.get("/api/words").status_code == 401


def test_the_length_setting_can_be_changed_to_a_length_offered() -> None:
    c = client()
    changed = c.patch("/api/settings", headers=AUTH, json={"lines": 12})
    assert changed.json() == {
        "stretch_words": "topic",
        "lines": 12,
        "form": "dialogue",
        "language": "th",
        "decks": DECKS,
        "voices": VOICES,
        "common": COMMON,
    }
    assert c.patch("/api/settings", headers=AUTH, json={"lines": 30}).status_code == 422


def test_past_texts_lists_texts_read_to_the_end_and_serves_them_again() -> None:
    c = client()
    assert c.get("/api/texts", headers=AUTH).json() == []
    read(c, "about_right", [])
    read(c, None, [], finished=False)

    [past] = c.get("/api/texts", headers=AUTH).json()
    assert (past["topic"], past["title"], past["rating"]) == (
        "Food stall",
        "At the stall",
        "about_right",
    )

    again = c.get(f"/api/texts/{past['id']}", headers=AUTH).json()
    assert again["title"] == "At the stall"
    assert [w["text"] for w in again["lines"][0]["words"]][:3] == ["ฉัน", "อยาก", "กิน"]
    assert c.get("/api/texts/999", headers=AUTH).status_code == 404
    assert c.get("/api/texts").status_code == 401


def test_suggestions_leave_out_topics_already_added_or_removed() -> None:
    c = client()
    first = c.get("/api/suggestions", headers=AUTH).json()
    assert {"name", "fit"} <= set(first[0])

    taken = c.post("/api/topics", json={"name": first[0]["name"]}, headers=AUTH).json()
    removed = c.post("/api/topics", json={"name": first[1]["name"]}, headers=AUTH).json()
    c.delete(f"/api/topics/{removed['id']}", headers=AUTH)

    names = [s["name"] for s in c.get("/api/suggestions", headers=AUTH).json()]
    assert taken["name"] not in names
    assert removed["name"] not in names
    # The shelf, filled in the background, takes ideas of its own as well.
    assert set(names) <= {s["name"] for s in first} - {taken["name"], removed["name"]}
    assert c.get("/api/suggestions").status_code == 401


def test_the_form_setting_can_be_set_to_story() -> None:
    c = client()
    changed = c.patch("/api/settings", headers=AUTH, json={"form": "story"})
    assert changed.json()["form"] == "story"
    assert c.patch("/api/settings", headers=AUTH, json={"form": "poem"}).status_code == 422


def test_a_text_says_what_form_it_is() -> None:
    c = client()
    read(c, "about_right", [])
    [past] = c.get("/api/texts", headers=AUTH).json()
    assert past["form"] == "dialogue"
    assert c.get(f"/api/texts/{past['id']}", headers=AUTH).json()["form"] == "dialogue"


def test_a_languages_deck_can_be_chosen_and_is_read_again_at_once() -> None:
    reads: list[str] = []

    async def read(language: Any) -> list[Any]:
        reads.append(language.notes_query)
        return list(ENTRIES)

    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, read, lambda: NOW, random.Random(1))
    c = started(create_app(engine, "open sesame"))

    changed = c.patch("/api/settings", headers=AUTH, json={"decks": {"th": "Thai::Words"}}).json()

    assert changed["decks"] == {**DECKS, "th": "Thai::Words"}
    assert c.get("/api/settings", headers=AUTH).json()["decks"]["th"] == "Thai::Words"
    # Read again straight away from the new deck, its consonant subdeck still left out.
    assert reads == ['"deck:Thai::Words" -"deck:Thai::Words::🏛 Consonant Classes"']

    # An empty name goes back to the default deck.
    back = c.patch("/api/settings", headers=AUTH, json={"decks": {"th": ""}}).json()
    assert back["decks"] == DECKS
    assert store.load_settings(conn).decks == {}


def test_how_many_common_words_count_can_be_chosen_for_each_language_but_thai() -> None:
    conn = store.connect(":memory:")
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1))
    c = started(create_app(engine, "open sesame"))
    changed = c.patch("/api/settings", headers=AUTH, json={"common": {"de": 5000, "pl": 1000}})
    assert changed.json()["common"] == {**COMMON, "de": 5000, "pl": 1000}
    assert c.get("/api/settings", headers=AUTH).json()["common"]["de"] == 5000
    # Choosing the default again stores nothing.
    c.patch("/api/settings", headers=AUTH, json={"common": {"de": 3000}})
    assert store.load_settings(conn).common == {"pl": 1000}
    # Only the counts offered, and never Thai's: only its deck counts.
    assert c.patch("/api/settings", headers=AUTH, json={"common": {"de": 4000}}).status_code == 422
    assert c.patch("/api/settings", headers=AUTH, json={"common": {"th": 1000}}).status_code == 422


def test_changing_a_deck_forgets_the_old_decks_words_until_the_new_one_is_read() -> None:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1))
    c = started(create_app(engine, "open sesame"))
    c.patch("/api/settings", headers=AUTH, json={"decks": {"th": "Thai::Words"}})
    assert store.load_snapshot(conn) == ([], None)
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    refused = c.post(f"/api/topics/{topic['id']}/next", headers=AUTH)
    assert refused.status_code == 503
    assert "no Thai word list" in refused.json()["detail"]


def test_next_takes_the_words_to_practice() -> None:
    c = client(ScriptedModel(IN_RANGE, IN_RANGE))
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    deadline = time.time() + 10
    while True:
        r = c.post(
            f"/api/topics/{topic['id']}/next", headers=AUTH, json={"words": ["ข้าวเหนียวมะม่วง"]}
        )
        if r.status_code != 202 or time.time() > deadline:
            break
        time.sleep(0.02)
    assert r.status_code == 200
    assert r.json()["stretch"] == ["ข้าวเหนียวมะม่วง"]


class FakeSpeech:
    """Azure, as the voice routes use it."""

    def __init__(self) -> None:
        self.spoken: list[tuple[str, str, float, str | None]] = []

    async def voices(self) -> list[dict[str, Any]]:
        return [
            {
                "voice": "th-TH-PremwadeeNeural",
                "locale": "th-TH",
                "name": "Premwadee",
                "gender": "Female",
            },
            {"voice": "th-TH-NiwatNeural", "locale": "th-TH", "name": "Niwat", "gender": "Male"},
            {
                "voice": "th-TH-AcharaNeural",
                "locale": "th-TH",
                "name": "Achara",
                "gender": "Female",
            },
            {"voice": "pl-PL-ZofiaNeural", "locale": "pl-PL", "name": "Zofia", "gender": "Female"},
            {"voice": "es-MX-DaliaNeural", "locale": "es-MX", "name": "Dalia", "gender": "Female"},
            {
                "voice": "es-ES-ElviraNeural",
                "locale": "es-ES",
                "name": "Elvira",
                "gender": "Female",
            },
            {
                "voice": "en-US-AvaMultilingualNeural",
                "locale": "en-US",
                "name": "Ava Multilingual",
                "gender": "Female",
            },
            {"voice": "en-US-AriaNeural", "locale": "en-US", "name": "Aria", "gender": "Female"},
        ]

    async def synthesize(
        self, text: str, voice: str, rate: float = 1.0, language: str | None = None
    ) -> bytes:
        self.spoken.append((text, voice, rate, language))
        return b"ID3" + text.encode()


def voice_client(speech: FakeSpeech | None) -> TestClient:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1))
    return started(create_app(engine, "open sesame", speech))


def test_lists_azures_voices_in_a_language_every_region_included() -> None:
    c = voice_client(FakeSpeech())
    es = c.get("/api/voices", params={"language": "es"}, headers=AUTH).json()["voices"]
    # The language's own voices first, then the Multilingual ones of other locales (not Aria).
    assert [v["voice"] for v in es] == [
        "es-ES-ElviraNeural",
        "es-MX-DaliaNeural",
        "en-US-AvaMultilingualNeural",
    ]
    pl = c.get("/api/voices", params={"language": "pl_PL"}, headers=AUTH).json()["voices"]
    assert [v["voice"] for v in pl] == ["pl-PL-ZofiaNeural", "en-US-AvaMultilingualNeural"]
    assert c.get("/api/voices", params={"language": "es"}).status_code == 401


def test_a_multilingual_voice_can_be_chosen_for_any_language_but_a_regular_one_cannot() -> None:
    c = voice_client(FakeSpeech())
    ok = c.patch(
        "/api/settings",
        headers=AUTH,
        json={"voices": {"el": {"female2": "en-US-AvaMultilingualNeural"}}},
    )
    assert ok.status_code == 200
    assert ok.json()["voices"]["el"]["female2"] == "en-US-AvaMultilingualNeural"
    refused = c.patch(
        "/api/settings", headers=AUTH, json={"voices": {"el": {"female2": "en-US-AriaNeural"}}}
    )
    assert refused.status_code == 400
    assert "not Greek" in refused.json()["detail"]


def test_speaks_a_cards_text_as_mp3() -> None:
    speech = FakeSpeech()
    c = voice_client(speech)
    r = c.post(
        "/api/speech",
        json={"text": " kot ", "voice": "pl-PL-ZofiaNeural", "rate": 0.9},
        headers=AUTH,
    )
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/mpeg"
    assert r.content == b"ID3kot"
    # An app from before the text's language was sent leaves it out.
    assert speech.spoken == [("kot", "pl-PL-ZofiaNeural", 0.9, None)]
    assert (
        c.post(
            "/api/speech", json={"text": "x" * 501, "voice": "pl-PL-ZofiaNeural"}, headers=AUTH
        ).status_code
        == 422
    )
    assert (
        c.post("/api/speech", json={"text": "kot", "voice": "Zofia"}, headers=AUTH).status_code
        == 400
    )


def test_a_cards_language_reaches_azure_as_a_locale() -> None:
    speech = FakeSpeech()
    c = voice_client(speech)
    ava = "en-US-AvaMultilingualNeural"
    for language in ["ja-JP", "ja_jp", "ja", "ko", "th-TH"]:
        r = c.post(
            "/api/speech",
            json={"text": "東京", "voice": ava, "language": language},
            headers=AUTH,
        )
        assert r.status_code == 200
    # A code of a language here is its locale; one with no region to name is left out.
    assert [s[3] for s in speech.spoken] == ["ja-JP", "ja-JP", "ja-JP", None, "th-TH"]
    bad = c.post(
        "/api/speech", json={"text": "x", "voice": ava, "language": "ja-JP'/>"}, headers=AUTH
    )
    assert bad.status_code == 400
    assert "isn't a language and region" in bad.json()["detail"]


def test_a_cards_recording_counts_in_the_costs_and_a_failed_one_doesnt() -> None:
    speech = FakeSpeech()
    c = voice_client(speech)
    empty = c.get("/api/costs", headers=AUTH).json()["recordings"]
    assert empty == {"recordings": 0, "audio_chars": 0, "azure_usd": 0}
    sentence = " kot" * 100  # 399 characters once trimmed
    c.post("/api/speech", json={"text": sentence, "voice": "pl-PL-ZofiaNeural"}, headers=AUTH)
    # Azure bills kana and kanji as two characters each (tts.billed_chars).
    c.post("/api/speech", json={"text": "猫", "voice": "ja-JP-NanamiNeural"}, headers=AUTH)

    async def down(text: str, voice: str, rate: float = 1.0, language: str | None = None) -> bytes:
        raise SpeechError("Azure didn't answer.")

    speech.synthesize = down  # type: ignore[method-assign]
    assert (
        c.post("/api/speech", json={"text": "pies", "voice": "pl-PL-ZofiaNeural"}, headers=AUTH)
    ).status_code == 503
    assert c.get("/api/costs", headers=AUTH).json()["recordings"] == {
        "recordings": 2,
        "audio_chars": 401,
        "azure_usd": 0.006,  # $15 per million characters
    }


def test_says_what_to_set_when_there_is_no_azure_key() -> None:
    c = voice_client(None)
    r = c.get("/api/voices", params={"language": "th"}, headers=AUTH)
    assert r.status_code == 503
    assert "AZURE_SPEECH_KEY" in r.json()["detail"]


def test_a_voice_can_be_chosen_and_reset_and_only_in_its_language() -> None:
    c = client()
    changed = c.patch(
        "/api/settings", headers=AUTH, json={"voices": {"es": {"female": "es-ES-ElviraNeural"}}}
    )
    assert changed.json()["voices"]["es"] == {**VOICES["es"], "female": "es-ES-ElviraNeural"}
    assert (
        c.get("/api/settings", headers=AUTH).json()["voices"]["es"]["female"]
        == "es-ES-ElviraNeural"
    )
    wrong = c.patch(
        "/api/settings", headers=AUTH, json={"voices": {"th": {"male": "es-MX-JorgeNeural"}}}
    )
    assert wrong.status_code == 400
    assert "not Thai" in wrong.json()["detail"]
    back = c.patch("/api/settings", headers=AUTH, json={"voices": {"es": {"female": ""}}}).json()
    assert back["voices"] == VOICES


def test_a_voice_for_speakers_a_and_b_is_no_longer_a_setting() -> None:
    c = client()
    refused = c.patch("/api/settings", headers=AUTH, json={"voices": {"th": {"A": "th-TH-X"}}})
    assert refused.status_code == 422


def test_voices_chosen_for_speakers_a_and_b_before_genders_are_dropped_on_load() -> None:
    conn = store.connect(":memory:")
    store.save_settings(
        conn,
        Settings(
            voices={
                "th": {"A": "th-TH-AcharaNeural", "female": "th-TH-AcharaNeural"},
                "es": {"B": "x"},
            }
        ),
    )
    assert store.load_settings(conn).voices == {"th": {"female": "th-TH-AcharaNeural"}}


def test_a_voice_of_the_other_gender_is_refused_for_a_slot() -> None:
    c = voice_client(FakeSpeech())
    refused = c.patch(
        "/api/settings", headers=AUTH, json={"voices": {"th": {"female": "th-TH-NiwatNeural"}}}
    )
    assert refused.status_code == 400
    assert "male voice" in refused.json()["detail"]
    ok = c.patch(
        "/api/settings", headers=AUTH, json={"voices": {"th": {"female2": "th-TH-AcharaNeural"}}}
    )
    assert ok.status_code == 200


def test_texts_waiting_to_be_read_are_spoken_again_in_new_voices(tmp_path: Path) -> None:
    from franki_reader.tts import AudioCache

    used: list[str] = []

    async def voice(text: str, name: str, language: str) -> Spoken:
        used.append(name)
        return Spoken(b"ID3" + name.encode())

    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(
        conn,
        ScriptedModel(IN_RANGE).ask_for,
        None,
        lambda: NOW,
        random.Random(1),
        synthesize=voice,
        audio=AudioCache(tmp_path),
    )
    c = started(create_app(engine, "open sesame"))

    def recorded() -> set[bytes]:
        return {p.read_bytes() for p in tmp_path.glob("*/*.mp3")}

    def wait_for(done: Any) -> None:
        deadline = time.time() + 10
        while not done() and time.time() < deadline:
            time.sleep(0.02)

    write_asked(c, "Food stall")  # a text is written and waits to be read
    # The scripted dialogues are two men, and Thai has one man's voice, so both read in it. The
    # scripted story has lines from A and B and no genders, which read as a man and a woman.
    both = {b"ID3th-TH-NiwatNeural", b"ID3th-TH-PremwadeeNeural"}
    wait_for(lambda: recorded() == both)
    assert recorded() == both

    c.patch(
        "/api/settings", headers=AUTH, json={"voices": {"th": {"female": "th-TH-AcharaNeural"}}}
    )
    changed = {b"ID3th-TH-NiwatNeural", b"ID3th-TH-AcharaNeural"}
    wait_for(lambda: recorded() == changed)
    assert recorded() == changed


def shelf_settled(c: TestClient, want: int) -> Any:
    """The shelf, asked for again until `want` texts are on it (they're written in the background)."""
    deadline = time.time() + 10
    while True:
        shelf = c.get("/api/shelf", headers=AUTH).json()
        if len(shelf["texts"]) >= want or time.time() > deadline:
            return shelf
        time.sleep(0.02)


def write_asked(c: TestClient, name: str = "Haggling", form: str = "story") -> None:
    answer = c.post("/api/shelf/write", json={"name": name, "form": form}, headers=AUTH)
    assert answer.status_code == 202 and answer.json() == {"writing": True, "topic": name}


def test_the_shelf_is_empty_until_a_text_is_asked_for_and_says_why_it_is_there() -> None:
    model = ScriptedModel(IN_RANGE)
    c = client(model)
    c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH)
    first = c.get("/api/shelf", headers=AUTH).json()
    assert first["language"] == "th" and first["story"] is None
    assert first["texts"] == [] and first["writing"] == []
    assert "themes" not in first
    assert [lang["code"] for lang in first["languages"]][:2] == ["th", "es"]
    assert model.calls == 0

    write_asked(c, "Food stall", "dialogue")
    shelf = shelf_settled(c, 1)
    assert [t["reason"] for t in shelf["texts"]] == ["asked"]
    card = shelf["texts"][0]
    assert {
        "id",
        "title",
        "topic",
        "topic_id",
        "form",
        "lines",
        "stretch",
        "coverage",
    } <= set(card)
    assert card["lines"] == 2 and card["topic"] == "Food stall"
    thai = next(lang for lang in shelf["languages"] if lang["code"] == "th")
    assert thai["ready"] == len(shelf["texts"])

    # Opened from the shelf, a text says its topic.
    text = c.get(f"/api/texts/{card['id']}", headers=AUTH).json()
    assert (text["topic"], text["reason"]) == ("Food stall", "asked")
    assert c.get("/api/shelf").status_code == 401
    assert model.calls == 1


def test_a_text_can_be_taken_off_the_shelf_once() -> None:
    c = client()
    write_asked(c)
    card = shelf_settled(c, 1)["texts"][0]
    assert c.post(f"/api/texts/{card['id']}/skip", headers=AUTH).status_code == 204
    assert c.post(f"/api/texts/{card['id']}/skip", headers=AUTH).status_code == 404
    assert c.get("/api/costs", headers=AUTH).json()["total"]["skipped"] == 1


def test_a_typed_topic_is_written_and_joins_the_shelf() -> None:
    c = client()
    write_asked(c)
    asked = shelf_settled(c, 1)["texts"][-1]
    assert (asked["topic"], asked["reason"], asked["form"]) == ("Haggling", "asked", "story")
    assert c.post("/api/shelf/write", json={"name": ""}, headers=AUTH).status_code == 422


def test_a_story_is_started_and_its_episodes_are_listed_once_read() -> None:
    model = ScriptedModel(
        {
            **IN_RANGE,
            "series": "Noi's stall",
            "cast": "Noi.",
            "recap": "Noi opens.",
            "recap_line": {"text": "ฉัน|กิน", "english": "I eat."},
        }
    )
    c = client(model)
    started_story = c.post("/api/story", json={"about": "a noodle stall"}, headers=AUTH)
    assert started_story.status_code == 202

    deadline = time.time() + 10
    while (story := c.get("/api/shelf", headers=AUTH).json()["story"])["next"] is None:
        assert time.time() < deadline
        time.sleep(0.02)
    assert (story["title"], story["about"], story["read"]) == ("Noi's stall", "a noodle stall", 0)
    episode = story["next"]
    assert episode["episode"] == 1 and episode["reason"] == "story"
    full = c.get(f"/api/texts/{episode['id']}", headers=AUTH).json()
    assert full["topic"] == "Noi's stall"
    # The card carries its practice words as the reader draws them, to open their popovers.
    in_text = {w["text"]: w for line in full["lines"] for w in line["words"] if w["status"]}
    assert [w["text"] for w in episode["practice"]] == [
        s for s in episode["stretch"] if s in in_text
    ]
    assert all(w == in_text[w["text"]] for w in episode["practice"])

    body = {"rating": None, "finished": True}
    c.post(f"/api/texts/{episode['id']}/reading", json=body, headers=AUTH)
    story = c.get("/api/shelf", headers=AUTH).json()["story"]
    assert (story["read"], story["last_recap"]) == (1, "Noi opens.")
    # The recap in the story's language, as words like a choice's, with that line's English.
    line = story["last_recap_line"]
    assert line["english"] == "I eat." and "".join(w["text"] for w in line["words"]) == "ฉันกิน"
    assert line["words"][0]["gloss"] == "I; me"
    past = c.get("/api/texts", params={"story": story["id"]}, headers=AUTH).json()
    assert [(t["topic"], t["episode"]) for t in past] == [("Noi's stall", 1)]

    # The first episode has no "Last time"; the next one carries the recap of the one before it,
    # to show above its text.
    assert "last_time" not in full
    deadline = time.time() + 10
    while (story := c.get("/api/shelf", headers=AUTH).json()["story"])["next"] is None:
        assert time.time() < deadline
        time.sleep(0.02)
    second = c.get(f"/api/texts/{story['next']['id']}", headers=AUTH).json()
    last_time = second["last_time"]
    assert last_time["recap"] == "Noi opens." and last_time["line"]["english"] == "I eat."


def test_a_story_episodes_choices_are_shown_and_the_pick_is_recorded_until_it_is_read() -> None:
    choices = [
        {"text": "ฉัน|กิน", "english": "I eat."},
        {"text": "อยาก|กิน", "english": "I want to eat."},
    ]
    model = ScriptedModel(
        {
            **IN_RANGE,
            "series": "Noi's stall",
            "cast": "Noi.",
            "recap": "Noi opens.",
            "choices": choices,
        }
    )
    c = client(model)
    c.post("/api/story", json={"about": "a noodle stall"}, headers=AUTH)
    deadline = time.time() + 10
    while (story := c.get("/api/shelf", headers=AUTH).json()["story"])["next"] is None:
        assert time.time() < deadline
        time.sleep(0.02)
    episode_id = story["next"]["id"]

    shown = c.get(f"/api/texts/{episode_id}", headers=AUTH).json()
    assert shown["chosen"] is None
    assert [ch["english"] for ch in shown["choices"]] == ["I eat.", "I want to eat."]
    assert "".join(w["text"] for w in shown["choices"][0]["words"]) == "ฉันกิน"
    assert shown["choices"][0]["words"][0]["gloss"] == "I; me"

    url = f"/api/texts/{episode_id}/choice"
    assert c.post(url, json={"choice": 1}, headers=AUTH).status_code == 204
    assert c.get(f"/api/texts/{episode_id}", headers=AUTH).json()["chosen"] == 1
    assert c.post(url, json={"choice": 2}, headers=AUTH).status_code == 404
    assert c.post(url, json={"choice": -1}, headers=AUTH).status_code == 422
    assert c.post("/api/texts/9999/choice", json={"choice": 0}, headers=AUTH).status_code == 404

    c.post(f"/api/texts/{episode_id}/reading", json={"finished": True}, headers=AUTH)
    assert c.post(url, json={"choice": 0}, headers=AUTH).status_code == 409
    # An episode written without a recap line shows only the English recap.
    assert c.get("/api/shelf", headers=AUTH).json()["story"]["last_recap_line"] is None
    assert c.get(f"/api/texts/{episode_id}", headers=AUTH).json()["chosen"] == 1


def test_a_text_with_no_choices_shows_none() -> None:
    c = client(ScriptedModel(IN_RANGE))
    topic = c.post("/api/topics", json={"name": "Food"}, headers=AUTH).json()
    text = c.post(f"/api/topics/{topic['id']}/next", headers=AUTH)
    deadline = time.time() + 10
    while text.status_code != 200:
        assert time.time() < deadline
        time.sleep(0.02)
        text = c.post(f"/api/topics/{topic['id']}/next", headers=AUTH)
    assert (text.json()["choices"], text.json()["chosen"]) == ([], None)


def test_a_time_sent_to_the_app_is_utc_whatever_the_servers_zone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from franki_reader.app import instant
    from franki_reader.engine import utc_now

    # The server's clock and stored times are naive UTC; TZ is there for Anki's study day alone.
    monkeypatch.setenv("TZ", "Asia/Bangkok")
    time.tzset()
    try:
        assert instant(NOW) == "2026-10-19T09:00:00+00:00"
        assert abs(utc_now() - datetime.now(UTC).replace(tzinfo=None)) < timedelta(seconds=5)
    finally:
        monkeypatch.undo()
        time.tzset()


def test_every_time_in_a_response_goes_through_instant() -> None:
    # A bare isoformat() sends a naive time, which the app reads as the phone's own zone.
    source = (Path(__file__).parent.parent / "src" / "franki_reader" / "app.py").read_text()
    assert source.count(".isoformat()") == 1, "send times with instant(), not .isoformat()"


# ---- /api/status ----

DUE = DueStatus(
    reviews=42,
    learning=3,
    decks=[DeckDue("Polski", 30, 1), DeckDue("Thai", 12, 2)],
    learning_later=[LearningLater(datetime(2026, 10, 19, 9, 30, tzinfo=UTC), 2)],
    day_ends_at=datetime(2026, 10, 20, 4, 0, tzinfo=UTC),
    study_days=[
        StudyDay(datetime(2026, 10, 18, 4, 0, tzinfo=UTC), 120, 1500),
        StudyDay(datetime(2026, 10, 19, 4, 0, tzinfo=UTC), 40, 600),
    ],
)
STATUS_KEY = {"Authorization": "Bearer status only"}


def status_client(read_due: Any = None, status_token: str | None = "status only") -> TestClient:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1))

    async def due() -> DueStatus:
        return DUE

    return started(
        create_app(engine, "open sesame", status_token=status_token, read_due=read_due or due)
    )


def test_status_says_whats_due_and_whether_a_text_is_waiting() -> None:
    body = status_client().get("/api/status", headers=STATUS_KEY).json()
    assert body == {
        "reviews": 42,
        "learning": 3,
        "learning_later": [{"at": "2026-10-19T09:30:00+00:00", "count": 2}],
        "decks": [
            {"name": "Polski", "reviews": 30, "learning": 1},
            {"name": "Thai", "reviews": 12, "learning": 2},
        ],
        "day_ends_at": "2026-10-20T04:00:00+00:00",
        "read_and_listen": {"language": "th", "name": "Thai", "waiting": 0, "last_read_at": None},
        "study_days": [
            {
                "starts_at": "2026-10-18T04:00:00+00:00",
                "cards": 120,
                "answer_seconds": 1500,
                "reading_seconds": 0,
            },
            {
                "starts_at": "2026-10-19T04:00:00+00:00",
                "cards": 40,
                "answer_seconds": 600,
                "reading_seconds": 0,
            },
        ],
        "franki": None,
    }


def test_status_counts_texts_waiting_and_the_last_one_read() -> None:
    c = status_client()
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    text = next_text(c, topic["id"]).json()
    c.post(f"/api/texts/{text['id']}/reading", json={"finished": True}, headers=AUTH)
    write_asked(c, "Haggling")  # one asked for, written in the background
    shelf_settled(c, 1)

    reading = c.get("/api/status", headers=STATUS_KEY).json()["read_and_listen"]

    assert reading["last_read_at"] == "2026-10-19T09:00:00+00:00"
    assert reading["waiting"] >= 1


def test_the_status_key_opens_status_and_nothing_else() -> None:
    c = status_client()
    assert c.get("/api/status", headers=STATUS_KEY).status_code == 200
    assert c.get("/api/status", headers=AUTH).status_code == 200
    assert c.get("/api/check", headers=STATUS_KEY).status_code == 401
    assert c.get("/api/topics", headers=STATUS_KEY).status_code == 401
    wrong = c.get("/api/status", headers={"Authorization": "Bearer nope"})
    assert wrong.status_code == 401
    assert wrong.json()["detail"] == "Wrong passphrase or status key."


def test_without_a_status_key_status_still_opens_with_the_passphrase() -> None:
    c = status_client(status_token=None)
    assert c.get("/api/status", headers=AUTH).status_code == 200
    assert c.get("/api/status", headers={"Authorization": "Bearer "}).status_code == 401


def test_status_says_when_anki_cant_be_read() -> None:
    async def down() -> DueStatus:
        raise AnkiUnavailable("Couldn't sync with the Anki sync server: refused")

    response = status_client(down).get("/api/status", headers=STATUS_KEY)
    assert response.status_code == 503
    assert response.json()["detail"] == (
        "Couldn't read Anki. Couldn't sync with the Anki sync server: refused"
    )


def test_status_without_anki_set_up_says_what_is_missing() -> None:
    conn = store.connect(":memory:")
    c = started(create_app(Engine(conn, None, None, lambda: NOW), "open sesame"))
    response = c.get("/api/status", headers=AUTH)
    assert response.status_code == 503
    assert "ANKI_SYNC_ENDPOINT" in response.json()["detail"]


def test_status_adds_reading_time_to_the_study_day_it_was_logged_on() -> None:
    c = status_client()
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    text = next_text(c, topic["id"]).json()
    body = {"finished": True, "seconds": 300}
    c.post(f"/api/texts/{text['id']}/reading", json=body, headers=AUTH)

    days = c.get("/api/status", headers=STATUS_KEY).json()["study_days"]

    # NOW is 09:00 on the 19th, in the study day that started at 04:00.
    assert [d["reading_seconds"] for d in days] == [0, 300]


def test_franki_reports_its_counts_and_status_shows_todays() -> None:
    c = status_client()
    assert c.put("/api/franki-counts", json={"due": 12, "new": 8}, headers=AUTH).status_code == 204

    reported = c.get("/api/status", headers=STATUS_KEY).json()["franki"]

    assert reported == {"due": 12, "new": 8, "reported_at": "2026-10-19T09:00:00+00:00"}


def test_counts_reported_before_todays_study_day_are_not_shown() -> None:
    conn = store.connect(":memory:")
    store.save_franki_counts(conn, store.FrankiCounts(3, 5, datetime(2026, 10, 19, 3, 0)))
    engine = Engine(conn, None, None, lambda: NOW)

    async def due() -> DueStatus:
        return DUE

    c = started(create_app(engine, "open sesame", status_token="status only", read_due=due))
    assert c.get("/api/status", headers=STATUS_KEY).json()["franki"] is None


def test_only_the_passphrase_reports_counts() -> None:
    c = status_client()
    body = {"due": 1, "new": 1}
    assert c.put("/api/franki-counts", json=body, headers=STATUS_KEY).status_code == 401
    assert c.put("/api/franki-counts", json={"due": -1, "new": 0}, headers=AUTH).status_code == 422


@pytest.mark.parametrize("hidden", ["ja", "en"])
def test_a_new_language_is_hidden_from_the_app_until_its_build_has_it(hidden: Code) -> None:
    # An app built before a language has no entry for it and crashes on one, so a saved setting
    # for it reads as Thai and the shelf doesn't list it (languages.HIDDEN_LANGUAGES).
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    store.save_settings(conn, Settings(language=hidden))
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1))
    c = started(create_app(engine, "open sesame"))
    assert c.get("/api/settings", headers=AUTH).json()["language"] == "th"
    shelf = c.get("/api/shelf", headers=AUTH).json()
    assert shelf["language"] == "th"
    assert hidden not in [language["code"] for language in shelf["languages"]]


def test_glosses_split_a_cards_sentences_in_the_order_sent() -> None:
    c = client()
    body = {
        "language": "th",
        "sentences": [{"text": "ฉันอยากกิน", "english": "I want to eat."}, {"text": "ทอนครับ"}],
    }
    out = c.post("/api/glosses", json=body, headers=AUTH).json()
    assert out["ready"] is True
    first, second = out["sentences"]
    assert [w["text"] for w in first] == ["ฉัน", "อยาก", "กิน"]
    assert first[2]["gloss"] == "eat" and first[2]["status"] == "known"
    assert "".join(w["text"] for w in second) == "ทอนครับ"


def test_glosses_arent_ready_for_a_language_whose_deck_hasnt_been_read() -> None:
    out = client().post(
        "/api/glosses",
        json={"language": "pl", "sentences": [{"text": "Dzień dobry"}]},
        headers=AUTH,
    )
    assert out.json() == {"ready": False, "sentences": []}
