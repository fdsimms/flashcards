import base64
import random
from typing import Any

import pytest
from fastapi.testclient import TestClient
from franki_speech import AssessedWord as Word
from franki_speech import Assessment, SpeechError
from scripted import ENTRIES, IN_RANGE, ScriptedModel
from test_app import AUTH, NOW, started

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.pronunciation import (
    MAX_WAV_BYTES,
    TakeRefused,
    azure_stt_usd,
    band,
    result,
    seconds_of,
    wav_of,
)

# A WAV header and one second of 16 kHz 16-bit mono silence.
WAV = b"RIFF" + b"\0" * 4 + b"WAVE" + b"\0" * 32 + b"\0" * 32_000
ASSESSED = Assessment(
    82.4,
    90.0,
    100.0,
    (
        Word("Poproszę", 95.0, "None"),
        Word("z", 70.0, "None"),
        Word("mlekiem", 48.0, "Mispronunciation", (("mle", 70.0), ("kiem", 30.0))),
        Word("kawę", 90.0, "Omission"),
    ),
    "Poproszę z mlekiem.",
)


def test_a_take_is_read_from_base64_and_refused_when_it_isnt_a_wav_or_is_too_long() -> None:
    assert wav_of(base64.b64encode(WAV).decode()) == WAV
    with pytest.raises(TakeRefused, match="couldn't be read"):
        wav_of("not base64!")
    with pytest.raises(TakeRefused, match="format"):
        wav_of(base64.b64encode(b"ID3mp3" + b"\0" * 20).decode())
    with pytest.raises(TakeRefused, match="too long"):
        wav_of(base64.b64encode(WAV[:44] + b"\0" * MAX_WAV_BYTES).decode())


def test_a_take_is_timed_and_priced_by_its_length() -> None:
    assert seconds_of(WAV) == 1.0
    assert azure_stt_usd(3600) == pytest.approx(1.0)


def test_words_are_banded_and_an_omission_is_always_again() -> None:
    assert [band(s) for s in (95, 80, 79, 60, 59)] == ["good", "good", "close", "close", "again"]
    out = result(ASSESSED)
    assert (out["accuracy"], out["fluency"], out["completeness"]) == (82, 90, 100)
    assert [(w["word"], w["band"], w["error"]) for w in out["words"]] == [
        ("Poproszę", "good", None),
        ("z", "close", None),
        ("mlekiem", "again", "Mispronunciation"),
        ("kawę", "again", "Omission"),
    ]
    assert out["words"][2]["weakest"] == {"text": "kiem", "accuracy": 30}
    assert out["words"][0]["weakest"] is None


def client(assess: Any = None) -> TestClient:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1))
    return started(create_app(engine, "open sesame", assess=assess))


BODY = {
    "language": "pl",
    "reference": "Poproszę kawę z mlekiem.",
    "audio": base64.b64encode(WAV).decode(),
}


def test_scores_a_take_against_its_text_and_counts_azures_cost() -> None:
    seen: list[tuple[bytes, str, str]] = []

    async def assess(wav: bytes, reference: str, locale: str) -> Assessment:
        seen.append((wav, reference, locale))
        return ASSESSED

    app = client(assess)
    got = app.post("/api/pronunciation", json=BODY, headers=AUTH)
    assert got.status_code == 200 and got.json()["accuracy"] == 82
    assert seen == [(WAV, "Poproszę kawę z mlekiem.", "pl-PL")]
    costs = app.get("/api/costs", headers=AUTH).json()["pronunciation"]
    assert costs["scored"] == 1 and costs["azure_usd"] == round(azure_stt_usd(1.0), 4)


def test_a_language_azure_wont_score_says_so() -> None:
    async def assess(wav: bytes, reference: str, locale: str) -> Assessment:
        raise SpeechError("no", 400)

    got = client(assess).post("/api/pronunciation", json={**BODY, "language": "th"}, headers=AUTH)
    assert got.status_code == 422 and "may not score Thai" in got.json()["detail"]


def test_without_azure_or_a_wav_or_the_passphrase() -> None:
    assert client().post("/api/pronunciation", json=BODY, headers=AUTH).status_code == 503

    async def assess(wav: bytes, reference: str, locale: str) -> Assessment:
        return ASSESSED

    bad = {**BODY, "audio": base64.b64encode(b"nope" * 20).decode()}
    assert client(assess).post("/api/pronunciation", json=bad, headers=AUTH).status_code == 422
    assert client(assess).post("/api/pronunciation", json=BODY).status_code == 401
