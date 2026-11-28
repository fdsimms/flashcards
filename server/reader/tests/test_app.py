import random
import re
import time
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from itertools import pairwise
from pathlib import Path
from typing import Any

import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from franki_speech import SpeechError, WordMark
from scripted import BAD, ENTRIES, IN_RANGE, ScriptedModel

from franki_reader import cast, store
from franki_reader.app import MAX_WRONG, client_source, create_app
from franki_reader.engine import Engine
from franki_reader.gateway import AnkiUnavailable
from franki_reader.languages import HIDDEN_LANGUAGES, LANGUAGES, SPEAKING_LANGUAGES, Code
from franki_reader.lexicon import Entry
from franki_reader.routes import health, own_texts, views
from franki_reader.routes import settings as settings_routes
from franki_reader.status import DeckDue, DueStatus, LearningLater, StudyDay
from franki_reader.store import Settings
from franki_reader.tts import SLOW_RATE, Spoken

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


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_the_schema_pages_are_not_served(path: str) -> None:
    assert client().get(path).status_code == 404


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
            "quiz_right": ["กิน"],
            "quiz_wrong": ["ครับ"],
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

    async def voice(text: str, name: str, language: str, rate: float = 1.0) -> Spoken:
        # Timed: the whole line as one word from 0 to 1000 ms, which the server shares out over
        # its words (a slow recording takes 1538: slower speech is longer).
        end = round(1000 / rate)
        tag = b"slow" if rate < 1 else b""
        return Spoken(b"ID3" + tag + text.encode(), [WordMark(text, 0, end)] if timed else None)

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


def shares_out(times: list[list[int] | None], end: int) -> bool:
    """Whether a line's word times, spoken as one word from 0 to `end`, run from 0 to `end` a word
    at a time in order."""
    timed = [t for t in times if t is not None]
    return (
        len(timed) > 1
        and timed[0][0] == 0
        and timed[-1][1] == end
        and all(a[1] == b[0] and a[0] < a[1] for a, b in pairwise(timed))
    )


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
    for line in text["lines"]:
        words = line["words"]
        assert shares_out([w.get("time") for w in words if w["status"] is not None], 1000)
        assert all("time" not in w for w in words if w["status"] is None)

    untimed = speaking_client(tmp_path / "untimed")
    topic = untimed.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    text = next_text(untimed, topic["id"]).json()
    assert all("time" not in w for line in text["lines"] for w in line["words"])


def test_a_slow_recording_is_made_when_asked_for_and_its_words_have_their_own_times(
    tmp_path: Path,
) -> None:
    c = speaking_client(tmp_path, timed=True)
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    text = next_text(c, topic["id"]).json()
    base = f"/api/texts/{text['id']}/lines/0"

    slow = c.get(f"{base}/audio?speed=slow", headers=AUTH)
    assert slow.status_code == 200 and slow.content.startswith(b"ID3slow")
    assert c.get(f"{base}/audio", headers=AUTH).content.startswith(b"ID3") is True
    assert not c.get(f"{base}/audio", headers=AUTH).content.startswith(b"ID3slow")
    assert c.get(f"{base}/audio?speed=fast", headers=AUTH).status_code == 422

    answer = c.get(f"/api/texts/{text['id']}/lines/1/slow", headers=AUTH).json()
    words = text["lines"][1]["words"]
    assert len(answer["times"]) == len(words)
    for word, when in zip(words, answer["times"], strict=True):
        assert (when is None) == (word["status"] is None)
    assert shares_out(answer["times"], round(1000 / SLOW_RATE))
    assert c.get(f"/api/texts/{text['id']}/lines/9/slow", headers=AUTH).status_code == 404
    assert c.get(f"{base}/slow").status_code == 401
    # The text's own words keep the normal recording's times.
    again = c.get(f"/api/texts/{text['id']}", headers=AUTH).json()
    assert shares_out([w.get("time") for w in again["lines"][1]["words"]], 1000)


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
    # The write has only just been started, so it may not have reached its first stage.
    assert first.json()["writing"] is True and first.json()["stage"] in (None, "writing")

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


def test_a_source_guessing_the_passphrase_is_refused_for_a_while() -> None:
    c = client()
    for _ in range(MAX_WRONG):
        assert c.get("/api/check", headers={"Authorization": "Bearer nope"}).status_code == 401
    # Refused now even with the right one, so a guess that's right can't be told from a wrong one.
    refused = c.get("/api/check", headers=AUTH)
    assert refused.status_code == 429
    assert (
        refused.json()["detail"]
        == "Too many wrong passphrases from your network. Try again in 15 minutes."
    )


def test_a_source_is_counted_by_its_address_and_an_ipv6_one_by_its_64() -> None:
    def source(host: str) -> str:
        return client_source(Request({"type": "http", "client": (host, 1)}))

    assert source("203.0.113.9") == "203.0.113.9"
    assert source("2001:db8:1:2:3:4:5:6") == source("2001:db8:1:2:ffff::1") == "2001:db8:1:2::/64"
    assert source("::ffff:203.0.113.9") == "203.0.113.9"


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
    "tok": "👅 Languages::🙂 toki pona",
}
# A hidden language's deck isn't reported either (languages.HIDDEN_LANGUAGES).
DECKS = {code: deck for code, deck in DECKS.items() if code not in HIDDEN_LANGUAGES}
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

# Every language rotates until chosen otherwise (read_plan.DEFAULT_MODE).
# Toki Pona has no daily task until one is chosen for it (read_plan.default_mode).
DAILY_TASKS = {
    code: "off" if code == "tok" else "rotate" for code in LANGUAGES if code not in HIDDEN_LANGUAGES
}

# What the first story character of each kind is given in each language when nothing was chosen.
CAST = {
    code: {
        kind: {"voice": p.voice, "pitch": p.pitch} for kind, p in cast.presets(voices, {}).items()
    }
    for code, voices in VOICES.items()
}


def test_the_register_setting_defaults_to_everyday_and_can_be_changed() -> None:
    c = client()
    assert c.get("/api/settings", headers=AUTH).json()["register"] == "everyday"
    changed = c.patch("/api/settings", headers=AUTH, json={"register": "formal"})
    assert changed.json()["register"] == "formal"
    assert c.get("/api/settings", headers=AUTH).json()["register"] == "formal"
    assert c.patch("/api/settings", headers=AUTH, json={"register": "slang"}).status_code == 422


def test_the_stretch_setting_can_be_read_and_changed() -> None:
    c = client()
    assert c.get("/api/settings", headers=AUTH).json() == {
        "stretch_words": "topic",
        "lines": 8,
        "form": "dialogue",
        "language": "th",
        "decks": DECKS,
        "voices": VOICES,
        "cast": CAST,
        "common": COMMON,
        "daily_tasks": DAILY_TASKS,
        "daily_rotate_count": 1,
        "register": "everyday",
    }
    changed = c.patch("/api/settings", headers=AUTH, json={"stretch_words": "any"})
    assert changed.json() == {
        "stretch_words": "any",
        "lines": 8,
        "form": "dialogue",
        "language": "th",
        "decks": DECKS,
        "voices": VOICES,
        "cast": CAST,
        "common": COMMON,
        "daily_tasks": DAILY_TASKS,
        "daily_rotate_count": 1,
        "register": "everyday",
    }
    assert c.get("/api/settings", headers=AUTH).json() == {
        "stretch_words": "any",
        "lines": 8,
        "form": "dialogue",
        "language": "th",
        "decks": DECKS,
        "voices": VOICES,
        "cast": CAST,
        "common": COMMON,
        "daily_tasks": DAILY_TASKS,
        "daily_rotate_count": 1,
        "register": "everyday",
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


def read(
    c: TestClient,
    rating: str | None,
    flagged: list[str],
    finished: bool = True,
    glossed: list[str] | None = None,
) -> None:
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    text = next_text(c, topic["id"]).json()
    body = {
        "rating": rating,
        "finished": finished,
        "words_flagged": flagged,
        "words_glossed": glossed or [],
    }
    assert c.post(f"/api/texts/{text['id']}/reading", json=body, headers=AUTH).status_code == 204


def test_progress_counts_finished_texts_and_says_how_hard_the_next_is() -> None:
    c = client()
    empty = c.get("/api/progress", headers=AUTH).json()
    assert empty["finished"] == 0
    assert empty["median_coverage"] is None
    assert empty["next"] == {"floor": 0.95, "stretch": 2}

    read(c, "about_right", [])
    read(c, "too_hard", [])
    read(c, None, [], finished=False)  # backed out of: not counted

    progress = c.get("/api/progress", headers=AUTH).json()
    assert progress["days"] == 14
    assert progress["finished"] == 2
    assert progress["median_coverage"] == 0.95
    assert progress["ratings"] == {"too_easy": 0, "about_right": 1, "too_hard": 1, "none": 0}
    # A rating (an older app still sends one) is counted but moves nothing.
    assert progress["next"] == {"floor": 0.95, "stretch": 2}
    assert c.get("/api/progress").status_code == 401


def test_input_time_lists_each_language_read_with_its_week() -> None:
    c = client()
    assert c.get("/api/input-time").status_code == 401
    assert c.get("/api/input-time", headers=AUTH).json() == {"days": 7, "languages": []}
    read(c, None, [])
    got = c.get("/api/input-time", headers=AUTH).json()["languages"]
    assert [g["language"] for g in got] == ["th"]
    # The helper logs no time; the totals themselves are tested with the store (test_engine.py).
    assert got[0]["reading_seconds"] == 0 and got[0]["listening_seconds"] == 0
    assert got[0]["last_read_at"].endswith("+00:00")


def test_progress_reports_how_well_the_known_words_were_recognized() -> None:
    c = client()
    assert c.get("/api/progress", headers=AUTH).json()["recognition"] is None
    # ฉัน is known and in the text; ทอน isn't known, so looking it up doesn't count.
    read(c, "about_right", [], glossed=["ฉัน", "ทอน"])
    r = c.get("/api/progress", headers=AUTH).json()["recognition"]
    assert r["texts"] == 1
    assert r["looked_up_types"] == 1 and r["known_types"] > 1
    assert 0 < r["effective"] < r["verified"] <= 1


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
    # A marked word carries its IPA like a token in a text does.
    assert words[0]["ipa"] and words[0]["ipa_source"] == "wiktionary"
    assert words[0]["kanji"] is None  # only Japanese words have kanji (kanji.py)

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
        "cast": CAST,
        "common": COMMON,
        "daily_tasks": DAILY_TASKS,
        "daily_rotate_count": 1,
        "register": "everyday",
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
        self.readings: list[str | None] = []
        self.ipas: list[str | None] = []

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
        self,
        text: str,
        voice: str,
        rate: float = 1.0,
        language: str | None = None,
        reading: str | None = None,
        ipa: str | None = None,
    ) -> bytes:
        self.spoken.append((text, voice, rate, language))
        self.readings.append(reading)
        self.ipas.append(ipa)
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


def test_a_japanese_card_is_recorded_from_its_reading_where_sudachi_reads_it_otherwise() -> None:
    speech = FakeSpeech()
    c = voice_client(speech)
    nanami = "ja-JP-NanamiNeural"
    for text, reading in [("今日", "こんにち"), ("今日", "きょう"), ("今日", None)]:
        body = {"text": text, "voice": nanami, **({"reading": reading} if reading else {})}
        assert c.post("/api/speech", json=body, headers=AUTH).status_code == 200
    # Another language's voice ignores a reading.
    body = {"text": "kot", "voice": "pl-PL-ZofiaNeural", "reading": "こんにち"}
    c.post("/api/speech", json=body, headers=AUTH)
    assert speech.readings == ["こんにち", None, None, None]


def test_a_word_can_be_said_from_its_ipa() -> None:
    speech = FakeSpeech()
    c = voice_client(speech)
    dmitry = "ru-RU-DmitryNeural"
    body = {"text": "замок", "voice": dmitry, "ipa": "zɐˈmok"}
    assert c.post("/api/speech", json=body, headers=AUTH).status_code == 200
    c.post("/api/speech", json={"text": "замок", "voice": dmitry}, headers=AUTH)
    assert speech.ipas == ["zɐˈmok", None]
    # The text is still what's billed and what the voice is given around the IPA.
    assert speech.spoken[0][0] == "замок"
    too_long = {"text": "замок", "voice": dmitry, "ipa": "z" * 201}
    assert c.post("/api/speech", json=too_long, headers=AUTH).status_code == 422


def test_conjugates_japanese_verbs_for_the_forms_field() -> None:
    c = voice_client(FakeSpeech())
    body = {"verbs": [{"entry": "帰る", "reading": "かえる"}, {"entry": "劇団"}]}
    forms = c.post("/api/conjugations", json=body, headers=AUTH).json()["forms"]
    assert "past · plain: 帰った / かえった" in forms[0] and forms[1] is None
    assert c.post("/api/conjugations", json=body).status_code == 401


def test_pronunciations_for_the_pronunciation_field() -> None:
    c = voice_client(FakeSpeech())
    body = {
        "entries": [
            {"language": "ru", "entry": "дом"},
            {"language": "ru", "entry": "дом и сад"},
            {"language": "ja", "entry": "大人", "reading": "おとな"},
        ]
    }
    found = c.post("/api/pronunciations", json=body, headers=AUTH).json()["pronunciations"]
    assert found[0]["ipa"] and found[0]["source"] == "wiktionary"
    assert found[1] is None
    assert found[2]["source"] == "rules"
    assert c.post("/api/pronunciations", json=body).status_code == 401


def test_lists_the_reading_each_japanese_word_is_recorded_from() -> None:
    c = voice_client(FakeSpeech())
    words = [{"text": "今日", "reading": "こんにち"}, {"text": "劇団", "reading": "げきだん"}]
    r = c.post("/api/readings", json={"words": words}, headers=AUTH)
    assert r.json() == {"readings": ["こんにち", None]}
    assert c.post("/api/readings", json={"words": words}).status_code == 401
    too_many = {"words": words * 26}
    assert c.post("/api/readings", json=too_many, headers=AUTH).status_code == 422


def test_a_cards_recording_counts_in_the_costs_and_a_failed_one_doesnt() -> None:
    speech = FakeSpeech()
    c = voice_client(speech)
    empty = c.get("/api/costs", headers=AUTH).json()["recordings"]
    assert empty == {"recordings": 0, "audio_chars": 0, "azure_usd": 0}
    sentence = " kot" * 100  # 399 characters once trimmed
    c.post("/api/speech", json={"text": sentence, "voice": "pl-PL-ZofiaNeural"}, headers=AUTH)
    # Azure bills kana and kanji as two characters each (tts.billed_chars).
    c.post("/api/speech", json={"text": "猫", "voice": "ja-JP-NanamiNeural"}, headers=AUTH)

    async def down(
        text: str,
        voice: str,
        rate: float = 1.0,
        language: str | None = None,
        reading: str | None = None,
        ipa: str | None = None,
    ) -> bytes:
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


def test_calls_with_no_section_of_their_own_are_counted_in_other_calls() -> None:
    from typing import get_args

    assert store.REPORTED_FEATURES <= set(get_args(store.CallFeature))
    conn = store.connect(":memory:")
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1))
    c = started(create_app(engine, "open sesame"))
    store.save_call_cost(conn, "word_lookup", "de", NOW, 0.25)
    store.save_call_cost(conn, "word_lookup", "es", NOW, 0.25)
    store.save_call_cost(conn, "rare_words", "en", NOW, 1.0)
    store.save_call_cost(conn, "cram_themes", "de", NOW, 9.0)  # has its own section
    # A grammar lesson: Claude writes it (one call), then each example is recorded as a clip with
    # no Claude call, which is Azure's audio and not another call.
    store.save_call_cost(conn, "grammar_lessons", "th", NOW, 0.125)
    store.save_call_cost(conn, "grammar_lessons", "th", NOW, 0.0, 300_000)
    store.save_call_cost(conn, "grammar_lessons", "th", NOW, 0.0, 100_000)
    costs = c.get("/api/costs", headers=AUTH).json()
    assert costs["other_calls"] == {
        "asked": 4,
        "cost_usd": 1.625,
        "audio_chars": 400_000,
        "azure_usd": 6.0,  # $15 per million characters
        "features": [
            # Most expensive first, Azure included: 0.125 + 6.0.
            {
                "feature": "grammar_lessons",
                "asked": 1,
                "cost_usd": 0.125,
                "audio_chars": 400_000,
                "azure_usd": 6.0,
            },
            {
                "feature": "rare_words",
                "asked": 1,
                "cost_usd": 1.0,
                "audio_chars": 0,
                "azure_usd": 0,
            },
            {
                "feature": "word_lookup",
                "asked": 2,
                "cost_usd": 0.5,
                "audio_chars": 0,
                "azure_usd": 0,
            },
        ],
    }
    assert costs["cram_themes"] == {"asked": 1, "cost_usd": 9.0}


def test_a_feature_with_only_clips_in_other_calls_shows_their_audio_and_no_calls() -> None:
    conn = store.connect(":memory:")
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1))
    c = started(create_app(engine, "open sesame"))
    # The lesson was written before the window; only its examples were recorded in it.
    store.save_call_cost(conn, "grammar_lessons", "th", NOW - timedelta(days=60), 0.125)
    store.save_call_cost(conn, "grammar_lessons", "th", NOW, 0.0, 2_000)
    other = c.get("/api/costs", headers=AUTH).json()["other_calls"]
    assert other["asked"] == 0 and other["audio_chars"] == 2_000 and other["azure_usd"] == 0.03
    assert other["features"] == [
        {
            "feature": "grammar_lessons",
            "asked": 0,
            "cost_usd": 0.0,
            "audio_chars": 2_000,
            "azure_usd": 0.03,
        }
    ]


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


def test_the_genre_asked_for_reaches_the_prompt_and_a_bad_one_is_refused() -> None:
    model = ScriptedModel(IN_RANGE)
    c = client(model)
    asked = c.post("/api/shelf/write", json={"name": "Haggling", "genre": "mystery"}, headers=AUTH)
    assert asked.status_code == 202
    shelf_settled(c, 1)
    assert "Genre: write a mystery" in str(model.messages_seen[0])
    bad = c.post("/api/shelf/write", json={"name": "x", "genre": "nonsense"}, headers=AUTH)
    assert bad.status_code == 422


def test_a_text_is_written_by_the_model_asked_for_and_the_shelf_says_which() -> None:
    model = ScriptedModel(IN_RANGE)
    c = client(model)
    c.post(
        "/api/shelf/write",
        json={"name": "Haggling", "form": "dialogue", "model": "claude-haiku-5-5"},
        headers=AUTH,
    )
    shelf = shelf_settled(c, 1)
    assert model.models_seen == ["claude-haiku-5-5"]
    assert shelf["texts"][0]["model"]  # what the API reported, kept with the text
    # the card's release date, with its offset
    assert shelf["texts"][0]["created_at"].endswith("+00:00")
    write_asked(c, "Market", "dialogue")  # an app from before the choice sends none: Sonnet
    shelf_settled(c, 2)
    assert model.models_seen[-1] == "claude-sonnet-5-5"
    bad = c.post("/api/shelf/write", json={"name": "x", "model": "claude-opus-5-5"}, headers=AUTH)
    assert bad.status_code == 422


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


def test_another_languages_shelf_is_read_without_switching_or_writing() -> None:
    model = ScriptedModel(IN_RANGE)
    c = client(model)
    write_asked(c, "Food stall", "dialogue")
    assert len(shelf_settled(c, 1)["texts"]) == 1
    calls = model.calls

    polish = c.get("/api/shelf?language=pl", headers=AUTH).json()
    assert polish["language"] == "pl" and polish["texts"] == [] and polish["writing"] == []
    thai = c.get("/api/shelf?language=th", headers=AUTH).json()
    assert [t["topic"] for t in thai["texts"]] == ["Food stall"]
    # The reader's own language is unchanged, and nothing was written for the other one.
    assert c.get("/api/shelf", headers=AUTH).json()["language"] == "th"
    assert model.calls == calls
    assert c.get("/api/shelf?language=xx", headers=AUTH).status_code == 422


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
    # The card places the episode in its season, with the season's length.
    assert (story["season"], story["season_episode"], story["season_length"]) == (1, 1, 8)
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
    # The series' recaps so far, with the days since an episode was last finished (the app opens its
    # Welcome back recap after a week away), on the episode and on the story's card.
    so_far = {"recaps": [{"episode": 1, "recap": "Noi opens."}], "away_days": 0, "characters": []}
    assert second["so_far"] == so_far
    assert story["so_far"] == so_far
    assert "so_far" not in full


def test_the_shelf_and_stories_answer_writing_when_a_story_has_no_episode_waiting() -> None:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1))
    story = store.start_story(conn, "th", "", NOW)
    c = started(create_app(engine, "open sesame"))
    # The first answer already says it's being written, not that it isn't yet.
    shelf = c.get("/api/shelf", headers=AUTH).json()["story"]
    assert shelf["next"] is None and shelf["writing"] is True
    deadline = time.time() + 10
    while c.get(f"/api/stories/{story.id}", headers=AUTH).json()["next"] is None:
        assert time.time() < deadline
        time.sleep(0.02)
    listed = c.get("/api/stories", headers=AUTH).json()["stories"]
    assert [(s["id"], s["writing"]) for s in listed] == [(story.id, False)]


def test_a_series_keeps_the_genre_it_was_started_with_for_its_episodes() -> None:
    model = ScriptedModel(
        {**IN_RANGE, "series": "Noi's stall", "cast": "Noi.", "recap": "Noi opens.", "choices": []}
    )
    c = client(model)
    started = c.post("/api/story", json={"about": "", "genre": "horror"}, headers=AUTH)
    assert started.status_code == 202
    deadline = time.time() + 10
    while c.get("/api/shelf", headers=AUTH).json()["story"]["next"] is None:
        assert time.time() < deadline
        time.sleep(0.02)
    assert "Genre: write a mild horror story" in str(model.messages_seen[0])
    plain = c.post("/api/story", json={"about": "a noodle stall"}, headers=AUTH)
    assert plain.status_code == 202
    assert c.post("/api/story", json={"genre": "nonsense"}, headers=AUTH).status_code == 422


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
    from franki_reader.engine import utc_now
    from franki_reader.routes.views import instant

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
    package = Path(__file__).parent.parent / "src" / "franki_reader"
    files = [package / "app.py", *sorted((package / "routes").glob("*.py"))]
    source = "".join(f.read_text() for f in files)
    assert source.count(".isoformat()") == 1, "send times with instant(), not .isoformat()"


def test_no_route_answers_502() -> None:
    # The app reads any 502 as Caddy's (src/reader/api.ts, errorMessage): "Read & Listen isn't
    # running", whatever the detail says. A failure of the server's own goes out as 503.
    package = Path(__file__).parent.parent / "src" / "franki_reader"
    for f in [package / "app.py", *sorted((package / "routes").glob("*.py"))]:
        assert not re.search(r"HTTPException\(\s*502|status_code\s*=\s*502", f.read_text()), (
            f"{f.name} answers 502: use 503"
        )


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
        "read_and_listen_languages": [
            {"language": code, "name": LANGUAGES[code].name, "waiting": 0, "last_read_at": None}
            for code in LANGUAGES
            if code not in HIDDEN_LANGUAGES
        ],
        "study_days": [
            {
                "starts_at": "2026-10-18T04:00:00+00:00",
                "cards": 120,
                "answer_seconds": 1500,
                "reading_seconds": 0,
                "reading_seconds_by_language": {},
            },
            {
                "starts_at": "2026-10-19T04:00:00+00:00",
                "cards": 40,
                "answer_seconds": 600,
                "reading_seconds": 0,
                "reading_seconds_by_language": {},
            },
        ],
        "read_and_listen_today": [],
        "franki": None,
        "franki_crams": None,
    }


def test_status_counts_texts_waiting_and_the_last_one_read() -> None:
    c = status_client()
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    text = next_text(c, topic["id"]).json()
    c.post(f"/api/texts/{text['id']}/reading", json={"finished": True}, headers=AUTH)
    write_asked(c, "Haggling")  # one asked for, written in the background
    shelf_settled(c, 1)

    body = c.get("/api/status", headers=STATUS_KEY).json()
    reading = body["read_and_listen"]

    assert reading["last_read_at"] == "2026-10-19T09:00:00+00:00"
    assert reading["waiting"] >= 1
    # The same read, for every language: the current one agrees with the single field above.
    thai = next(x for x in body["read_and_listen_languages"] if x["language"] == "th")
    assert thai == {
        "language": "th",
        "name": "Thai",
        **{k: reading[k] for k in ("waiting", "last_read_at")},
    }
    assert all(
        x["waiting"] == 0 for x in body["read_and_listen_languages"] if x["language"] != "th"
    )


def test_status_lists_the_languages_that_get_a_reading_task_today() -> None:
    c = status_client()
    # Nothing is waiting anywhere, so nothing is listed.
    assert c.get("/api/status", headers=STATUS_KEY).json()["read_and_listen_today"] == []
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    text = next_text(c, topic["id"]).json()
    c.post(f"/api/texts/{text['id']}/reading", json={"finished": True}, headers=AUTH)
    write_asked(c, "Haggling")
    shelf_settled(c, 1)

    listed = c.get("/api/status", headers=STATUS_KEY).json()["read_and_listen_today"]
    # Thai rotates by default, and is the one with a text waiting. It was read today, which counts.
    assert listed[0]["language"] == "th"
    assert listed[0]["mode"] == "rotate"
    assert listed[0]["done"] is True
    assert listed[0]["waiting"] >= 1


def test_the_daily_reading_task_settings_can_be_read_and_changed() -> None:
    c = client()
    first = c.get("/api/settings", headers=AUTH).json()
    assert first["daily_tasks"] == DAILY_TASKS
    assert first["daily_rotate_count"] == 1
    changed = c.patch(
        "/api/settings",
        headers=AUTH,
        json={"daily_tasks": {"th": "daily", "nb": "off"}, "daily_rotate_count": 2},
    ).json()
    assert changed["daily_tasks"] == {**DAILY_TASKS, "th": "daily", "nb": "off"}
    assert changed["daily_rotate_count"] == 2
    # A change names only the languages it changes.
    again = c.patch("/api/settings", headers=AUTH, json={"daily_tasks": {"de": "daily"}}).json()
    assert again["daily_tasks"] == {**DAILY_TASKS, "th": "daily", "nb": "off", "de": "daily"}
    assert again["daily_rotate_count"] == 2
    for bad in (
        {"daily_tasks": {"th": "sometimes"}},
        {"daily_rotate_count": 0},
        {"daily_rotate_count": 11},
    ):
        assert c.patch("/api/settings", headers=AUTH, json=bad).status_code == 422


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
    # The helper's topic is Thai: the split names the language the time was spent in.
    assert [d["reading_seconds_by_language"] for d in days] == [{}, {"th": 300}]


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


THAI_LESSON = {
    "id": "thai-lesson-2026-10-21",
    "name": "Thai lesson",
    "date": "2026-10-21",
    "ends_at": "2026-10-22T04:00:00-04:00",
    "practiced_at": "2026-10-19T08:30:00Z",
    "finished_at": None,
}


def test_status_has_no_crams_until_franki_reports_them() -> None:
    # null, not an empty list: dundundun leaves its cram tasks alone until Franki has said.
    assert status_client().get("/api/status", headers=STATUS_KEY).json()["franki_crams"] is None


def test_franki_reports_its_crams_and_status_shows_them() -> None:
    c = status_client()
    body = {"crams": [THAI_LESSON]}
    assert c.put("/api/franki-crams", json=body, headers=AUTH).status_code == 204

    reported = c.get("/api/status", headers=STATUS_KEY).json()["franki_crams"]

    assert reported == {
        "crams": [
            {
                **THAI_LESSON,
                "ends_at": "2026-10-22T08:00:00+00:00",
                "practiced_at": "2026-10-19T08:30:00+00:00",
            }
        ],
        "reported_at": "2026-10-19T09:00:00+00:00",
    }


def test_a_new_report_of_crams_replaces_the_last() -> None:
    c = status_client()
    c.put("/api/franki-crams", json={"crams": [THAI_LESSON]}, headers=AUTH)
    c.put("/api/franki-crams", json={"crams": []}, headers=AUTH)

    assert c.get("/api/status", headers=STATUS_KEY).json()["franki_crams"]["crams"] == []


def test_only_the_passphrase_reports_crams_and_a_bad_one_is_refused() -> None:
    c = status_client()
    body = {"crams": [THAI_LESSON]}
    assert c.put("/api/franki-crams", json=body, headers=STATUS_KEY).status_code == 401
    no_offset = {"crams": [{**THAI_LESSON, "ends_at": "2026-10-22T04:00:00"}]}
    assert c.put("/api/franki-crams", json=no_offset, headers=AUTH).status_code == 422
    bad_date = {"crams": [{**THAI_LESSON, "date": "21 October"}]}
    assert c.put("/api/franki-crams", json=bad_date, headers=AUTH).status_code == 422
    too_many = {"crams": [THAI_LESSON] * 51}
    assert c.put("/api/franki-crams", json=too_many, headers=AUTH).status_code == 422


def hide_languages(monkeypatch: pytest.MonkeyPatch, hidden: frozenset[Code]) -> None:
    """Sets languages.HIDDEN_LANGUAGES in every module that reads it."""
    for module in (store, views, settings_routes, health, own_texts):
        monkeypatch.setattr(module, "HIDDEN_LANGUAGES", hidden)


@pytest.mark.parametrize("hidden", ["ja", "en", "tok"])
def test_a_new_language_is_hidden_from_the_app_until_its_build_has_it(
    hidden: Code, monkeypatch: pytest.MonkeyPatch
) -> None:
    # An app built before a language has no entry for it and crashes on one, so a saved setting
    # for it reads as Thai, and neither the shelf nor the settings name it (languages.HIDDEN_LANGUAGES).
    hide_languages(monkeypatch, frozenset({hidden}))
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    store.save_settings(conn, Settings(language=hidden))
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1))
    c = started(create_app(engine, "open sesame"))
    settings = c.get("/api/settings", headers=AUTH).json()
    assert settings["language"] == "th"
    assert hidden not in settings["decks"]
    assert hidden not in settings["daily_tasks"]
    shelf = c.get("/api/shelf", headers=AUTH).json()
    assert shelf["language"] == "th"
    assert hidden not in [language["code"] for language in shelf["languages"]]


@pytest.mark.parametrize("shown", ["ja", "en"])
def test_japanese_and_english_are_shown_now_the_app_has_them(shown: Code) -> None:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    store.save_settings(conn, Settings(language=shown))
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1))
    c = started(create_app(engine, "open sesame"))
    assert c.get("/api/settings", headers=AUTH).json()["language"] == shown
    assert shown in [
        language["code"] for language in c.get("/api/shelf", headers=AUTH).json()["languages"]
    ]


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


def test_glosses_work_for_toki_pona_with_no_lemmatizer_voices_or_common_list() -> None:
    conn = store.connect(":memory:")
    entries = [Entry(1, "toki", "language; to say", "mature"), Entry(2, "pona", "good", "mature")]
    store.save_snapshot(conn, entries, NOW, "tok")
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1))
    c = started(create_app(engine, "open sesame"))
    body = {"language": "tok", "sentences": [{"text": "toki pona", "english": "good language"}]}
    out = c.post("/api/glosses", json=body, headers=AUTH).json()
    assert out["ready"] is True
    words = out["sentences"][0]
    assert [w["text"] for w in words] == ["toki", " ", "pona"]
    assert [w["gloss"] for w in words if w["status"]] == ["language; to say", "good"]
    assert all(w["status"] == "known" for w in words if w["status"])


def test_toki_pona_is_on_the_shelf_and_in_daily_tasks_but_has_no_voices_or_common_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hide_languages(monkeypatch, frozenset())
    c = client()
    settings = c.get("/api/settings", headers=AUTH).json()
    assert settings["decks"]["tok"] == "👅 Languages::🙂 toki pona"
    for key in ("voices", "cast", "common"):
        assert "tok" not in settings[key]
    assert settings["daily_tasks"]["tok"] == "off"
    shelf = c.get("/api/shelf", headers=AUTH).json()
    assert "tok" in [language["code"] for language in shelf["languages"]]
    assert c.patch("/api/settings", json={"language": "tok"}, headers=AUTH).status_code == 200
    for change, said in (
        ({"common": {"tok": 250}}, "always counts its particles"),
        ({"voices": {"tok": {"male": "en-US-GuyNeural"}}}, "has no voices"),
    ):
        refused = c.patch("/api/settings", json=change, headers=AUTH)
        assert refused.status_code == 422
        assert said in refused.json()["detail"]


def test_glosses_arent_ready_for_a_language_whose_deck_hasnt_been_read() -> None:
    out = client().post(
        "/api/glosses",
        json={"language": "pl", "sentences": [{"text": "Dzień dobry"}]},
        headers=AUTH,
    )
    assert out.json() == {"ready": False, "sentences": []}


def exposure_client(reviews: Any) -> TestClient:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1))
    return started(create_app(engine, "open sesame", read_reviews=reviews))


def test_the_exposure_effect_needs_anki_and_says_not_enough_with_little_to_compare() -> None:
    assert client().get("/api/exposure-effect", headers=AUTH).status_code == 503

    async def reviews(language: Any) -> list[Any]:
        return []

    c = exposure_client(reviews)
    body = c.get("/api/exposure-effect", headers=AUTH).json()
    assert body["verdict"] == "not_enough" and body["days"] == 90 and body["texts"] == 0
    assert c.get("/api/exposure-effect?days=3", headers=AUTH).status_code == 422
    assert c.get("/api/exposure-effect").status_code == 401


def test_a_failed_anki_read_is_a_503_that_says_so() -> None:
    from franki_reader.gateway import AnkiUnavailable

    async def reviews(language: Any) -> list[Any]:
        raise AnkiUnavailable("the sync server didn't answer")

    response = exposure_client(reviews).get("/api/exposure-effect", headers=AUTH)
    assert response.status_code == 503 and "didn't answer" in response.json()["detail"]


def relisten_client(now: list[datetime]) -> TestClient:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: now[0], random.Random(1))
    return started(create_app(engine, "open sesame"))


def test_a_finished_text_is_offered_to_hear_again_the_next_day_and_counted_once_heard() -> None:
    now = [NOW]
    c = relisten_client(now)
    read(c, "about_right", [])
    assert c.get("/api/relisten", headers=AUTH).json() == []  # read today

    now[0] = NOW + timedelta(days=1)
    offered = c.get("/api/relisten", headers=AUTH).json()
    assert [t["title"] for t in offered] == ["At the stall"]
    assert offered[0]["rating"] == "about_right" and "read_at" in offered[0]

    assert c.post(f"/api/texts/{offered[0]['id']}/listen", headers=AUTH).status_code == 204
    assert c.get("/api/relisten", headers=AUTH).json() == []  # its next listen is 3 days on
    now[0] = NOW + timedelta(days=4)
    assert len(c.get("/api/relisten", headers=AUTH).json()) == 1
    # Hearing it again isn't a reading: nothing about difficulty or the log changed.
    assert c.get("/api/progress", headers=AUTH).json()["finished"] == 1


def test_a_listen_sent_twice_under_one_key_is_counted_once() -> None:
    now = [NOW]
    c = relisten_client(now)
    read(c, "about_right", [])
    now[0] = NOW + timedelta(days=1)
    text_id = c.get("/api/relisten", headers=AUTH).json()[0]["id"]
    url = f"/api/texts/{text_id}/listen"
    for _ in range(2):
        assert c.post(url, json={"key": "m1x-abc"}, headers=AUTH).status_code == 204
    # Its next listen is 3 days on: counted twice, the one after (10 days) would be asked for instead.
    now[0] = NOW + timedelta(days=5)
    assert len(c.get("/api/relisten", headers=AUTH).json()) == 1
    # Another key, or none, is another listen.
    assert c.post(url, json={"key": "m1x-def"}, headers=AUTH).status_code == 204
    assert c.post(url, headers=AUTH).status_code == 204
    assert c.post(url, json={"key": ""}, headers=AUTH).status_code == 422


def test_a_text_never_read_to_the_end_cannot_be_counted_as_heard() -> None:
    c = relisten_client([NOW])
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    unread = next_text(c, topic["id"]).json()
    assert c.post(f"/api/texts/{unread['id']}/listen", headers=AUTH).status_code == 404
    assert c.post("/api/texts/999/listen", headers=AUTH).status_code == 404
    assert c.post("/api/texts/1/listen").status_code == 401
    assert c.get("/api/relisten").status_code == 401


def test_the_listens_wanted_per_text_set_the_schedule() -> None:
    now = [NOW]
    c = relisten_client(now)
    read(c, "about_right", [])
    now[0] = NOW + timedelta(days=1)
    assert len(c.get("/api/relisten", headers=AUTH).json()) == 1  # three wanted: due the next day
    assert c.get("/api/relisten?listens=1", headers=AUTH).json() == []  # one wanted: due at 3 days
    assert c.get("/api/relisten?listens=0", headers=AUTH).json() == []
    now[0] = NOW + timedelta(days=3)
    assert len(c.get("/api/relisten?listens=1", headers=AUTH).json()) == 1
    assert c.get("/api/relisten?listens=2", headers=AUTH).status_code == 422


def test_text_difficulty_is_set_for_the_current_language() -> None:
    c = client()
    assert c.put("/api/difficulty", json={"level": "easier"}, headers=AUTH).json() == {
        "floor": 0.97,
        "stretch": 2,
    }
    assert c.get("/api/progress", headers=AUTH).json()["next"] == {"floor": 0.97, "stretch": 2}
    assert (
        c.put("/api/difficulty", json={"level": "standard"}, headers=AUTH).json()["floor"] == 0.95
    )
    assert c.put("/api/difficulty", json={"level": "hard"}, headers=AUTH).status_code == 422
    assert c.put("/api/difficulty", json={"level": "easier"}).status_code == 401


class RecordedParts:
    """Records what the Story characters screen had spoken, and gives back MP3 bytes."""

    def __init__(self) -> None:
        self.calls: list[tuple[list[Any], str]] = []

    async def __call__(self, parts: Any, language: str) -> Spoken:
        self.calls.append((list(parts), language))
        return Spoken(b"ID3cast")


def cast_client(parts: RecordedParts | None) -> TestClient:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(
        conn,
        ScriptedModel(IN_RANGE).ask_for,
        None,
        lambda: NOW,
        random.Random(1),
        synthesize_parts=parts,
    )
    return started(create_app(engine, "open sesame", FakeSpeech() if parts else None))


def test_a_story_characters_voice_and_pitch_can_be_chosen_and_reset() -> None:
    c = cast_client(RecordedParts())
    assert c.get("/api/settings", headers=AUTH).json()["cast"]["th"]["girl"] == CAST["th"]["girl"]
    pick = {"cast": {"th": {"girl": {"voice": "th-TH-AcharaNeural", "pitch": 24}}}}
    changed = c.patch("/api/settings", headers=AUTH, json=pick).json()
    assert changed["cast"]["th"]["girl"] == {"voice": "th-TH-AcharaNeural", "pitch": 24}
    assert changed["cast"]["th"]["woman"] == CAST["th"]["woman"]  # the rest stays the default
    assert c.get("/api/settings", headers=AUTH).json()["cast"] == changed["cast"]
    back = c.patch("/api/settings", headers=AUTH, json={"cast": {"th": {"girl": None}}}).json()
    assert back["cast"] == CAST


def test_a_story_characters_voice_is_checked_like_a_slots() -> None:
    c = cast_client(RecordedParts())

    def pick(kind: str, voice: str, pitch: int = 0) -> Any:
        body = {"cast": {"th": {kind: {"voice": voice, "pitch": pitch}}}}
        return c.patch("/api/settings", headers=AUTH, json=body)

    assert pick("girl", "es-MX-JorgeNeural").status_code == 400  # not a Thai voice
    refused = pick("boy", "th-TH-PremwadeeNeural")  # a woman's voice for a boy
    assert refused.status_code == 400 and "female voice" in refused.json()["detail"]
    assert pick("girl", "th-TH-AcharaNeural", 36).status_code == 422
    assert pick("girl", "th-TH-AcharaNeural", -31).status_code == 422
    assert pick("dragon", "th-TH-AcharaNeural").status_code == 422
    assert pick("girl", "en-US-AvaMultilingualNeural", -30).status_code == 200


def test_damaged_story_character_choices_are_dropped_on_load() -> None:
    conn = store.connect(":memory:")
    store.save_settings(
        conn,
        Settings(
            cast={
                "th": {
                    "girl": {"voice": "th-TH-AcharaNeural", "pitch": 18},
                    "boy": {"voice": "th-TH-NiwatNeural", "pitch": 99},
                    "dragon": {"voice": "x", "pitch": 0},
                },
                "es": {"man": {"voice": "", "pitch": 0}},
            }
        ),
    )
    assert store.load_settings(conn).cast == {
        "th": {"girl": {"voice": "th-TH-AcharaNeural", "pitch": 18}}
    }


def test_a_sample_is_a_line_in_the_voice_at_the_pitch() -> None:
    parts = RecordedParts()
    c = cast_client(parts)
    body = {"language": "ru", "voice": "ru-RU-DariyaNeural", "pitch": 18, "gender": "female"}
    r = c.post("/api/cast/sample", headers=AUTH, json=body)
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg"
    assert r.content == b"ID3cast"
    [(spoken, language)] = parts.calls
    assert language == "ru-RU"
    assert [(p.text, p.voice, p.pitch) for p in spoken] == [
        ("«Мама, туда нельзя!»", "ru-RU-DariyaNeural", 18)
    ]
    # Thai's polite ending is the speaker's.
    thai = {"language": "th", "voice": "th-TH-NiwatNeural", "gender": "male"}
    c.post("/api/cast/sample", headers=AUTH, json=thai)
    assert "ครับ" in parts.calls[1][0][0].text
    wrong = {"language": "ru", "voice": "es-MX-JorgeNeural"}
    assert c.post("/api/cast/sample", headers=AUTH, json=wrong).status_code == 400


def test_the_scene_is_the_narrator_a_girl_and_a_woman_in_the_voices_a_story_would_give() -> None:
    parts = RecordedParts()
    c = cast_client(parts)
    c.patch(
        "/api/settings",
        headers=AUTH,
        json={"cast": {"ru": {"girl": {"voice": "ru-RU-DariyaNeural", "pitch": 24}}}},
    )
    r = c.post("/api/cast/scene", headers=AUTH, json={"language": "ru"})
    assert r.status_code == 200
    [(spoken, language)] = parts.calls
    assert language == "ru-RU"
    assert [(p.voice, p.pitch) for p in spoken] == [
        (VOICES["ru"]["male"], 0),
        ("ru-RU-DariyaNeural", 24),
        (CAST["ru"]["woman"]["voice"], CAST["ru"]["woman"]["pitch"]),
    ]
    assert "".join(p.text for p in spoken).startswith("На кухне горит свет")


def test_a_sample_or_scene_counts_as_a_recording_and_needs_azure() -> None:
    c = cast_client(RecordedParts())
    c.post("/api/cast/scene", headers=AUTH, json={"language": "ru"})
    assert c.get("/api/costs", headers=AUTH).json()["recordings"]["recordings"] == 1
    none = cast_client(None)
    assert none.post("/api/cast/scene", headers=AUTH, json={"language": "ru"}).status_code == 503
    assert c.post("/api/cast/scene", json={"language": "ru"}).status_code == 401


def test_every_speaking_language_has_a_scene() -> None:
    from franki_reader.cast_samples import SCENES, sample_line

    assert set(SCENES) == set(SPEAKING_LANGUAGES)
    assert all(all(line.strip() for line in lines) for lines in SCENES.values())
    assert sample_line("th", "male") != sample_line("th", "female")


def test_audit_lists_and_reads_a_shown_text_for_review() -> None:
    c = client()
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    text = next_text(c, topic["id"]).json()

    [listed] = c.get("/api/audit/texts", headers=AUTH).json()
    assert listed["id"] == text["id"]
    assert listed["language"] == "th" and listed["reads"] == 0
    assert c.get("/api/audit/texts?language=de", headers=AUTH).json() == []

    detail = c.get(f"/api/audit/texts/{text['id']}", headers=AUTH).json()
    assert detail["title"] == "At the stall"
    assert detail["practice_words"] == ["ข้าวเหนียวมะม่วง"]
    first = detail["lines"][0]
    assert first["speaker"] == "A" and first["text"].startswith("ฉันอยากกิน")
    assert first["english"] and isinstance(first["unknown"], list)
    assert first["quotes"] == []
    assert detail["readings"] == []


def test_audit_refuses_a_missing_text_and_a_wrong_passphrase() -> None:
    c = client()
    assert c.get("/api/audit/texts/99", headers=AUTH).status_code == 404
    assert c.get("/api/audit/texts").status_code == 401


def test_ranks_gives_each_words_place_in_the_common_list() -> None:
    c = client()
    from franki_reader.spaced import common_words

    first, second = common_words("es")[:2]
    response = c.post(
        "/api/ranks",
        json={"language": "es", "words": [second, first, "zzzzqx", second, "mantener a raya"]},
        headers=AUTH,
    )
    ranks = response.json()["ranks"]
    assert ranks == {second: 2, first: 1, "zzzzqx": None, "mantener a raya": None}
    assert response.json()["phrases"] == ["mantener a raya"]
    assert (
        c.post("/api/ranks", json={"language": "es", "words": []}, headers=AUTH).status_code == 422
    )
    assert c.post("/api/ranks", json={"language": "es", "words": ["a"]}).status_code == 401


def test_several_stories_run_and_any_running_one_can_be_pinned_to_the_card() -> None:
    c = client()
    first = c.post("/api/story", json={"about": ""}, headers=AUTH).json()["id"]
    second = c.post("/api/story", json={"about": "a haunted house"}, headers=AUTH).json()["id"]

    def settled() -> Any:
        deadline = time.time() + 10
        while True:
            listed = c.get("/api/stories", headers=AUTH).json()["stories"]
            if all(s["next"] for s in listed) or time.time() > deadline:
                return listed
            time.sleep(0.02)

    listed = settled()
    assert [(s["id"], s["running"], s["pinned"]) for s in listed] == [
        (second, True, False),
        (first, True, True),
    ]
    # The list leaves the card's recap and practice words to the card.
    assert listed[0]["last_recap_line"] is None and "practice" not in listed[0]["next"]
    assert c.get("/api/shelf", headers=AUTH).json()["story"]["id"] == first

    assert c.post(f"/api/stories/{second}/pin", headers=AUTH).status_code == 204
    assert c.get("/api/shelf", headers=AUTH).json()["story"]["id"] == second
    # One story's page has the card's practice words, whichever story it is.
    page = c.get(f"/api/stories/{first}", headers=AUTH).json()
    assert page["id"] == first and not page["pinned"] and "practice" in page["next"]
    assert c.get("/api/stories/999", headers=AUTH).status_code == 404

    assert c.post(f"/api/stories/{second}/end", headers=AUTH).status_code == 204
    assert c.post(f"/api/stories/{second}/end", headers=AUTH).status_code == 404
    assert c.post(f"/api/stories/{second}/pin", headers=AUTH).status_code == 404
    assert c.get("/api/shelf", headers=AUTH).json()["story"]["id"] == first

    assert c.post(f"/api/stories/{second}/continue", headers=AUTH).status_code == 204
    assert c.post(f"/api/stories/{second}/continue", headers=AUTH).status_code == 404
    assert [s["running"] for s in c.get("/api/stories", headers=AUTH).json()["stories"]] == [
        True,
        True,
    ]


def test_glosses_split_a_headword_into_its_parts_and_ask_for_the_meaning_of_each() -> None:
    c = client()
    body = {"language": "th", "sentences": [{"text": "ความคิด", "english": "idea", "parts": True}]}
    out = c.post("/api/glosses", json=body, headers=AUTH).json()
    assert out["ready"] is True
    assert [w["text"] for w in out["sentences"][0]] == ["ความ", "คิด"]
    # Without the flag it is segmented as a sentence is, which keeps a compound whole.
    whole = c.post(
        "/api/glosses", json={"language": "th", "sentences": [{"text": "ความคิด"}]}, headers=AUTH
    ).json()
    assert [w["text"] for w in whole["sentences"][0]] == ["ความคิด"]
