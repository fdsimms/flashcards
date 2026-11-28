import random
import shutil
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from franki_speech.commons import Commons
from scripted import IN_RANGE
from scripted import ScriptedModel as AppModel
from test_app import AUTH, started

from franki_reader import native_store, store
from franki_reader.app import create_app
from franki_reader.engine import Engine

NOW = datetime(2026, 11, 28, 9, 0)
LL = "http://commons.wikimedia.org/wiki/Special:FilePath/LL-Q188%20(deu)-Natschi-Hund.wav"
TITLE = "File:LL-Q188 (deu)-Natschi-Hund.wav"


class Clock:
    def __init__(self) -> None:
        self.now = NOW

    def __call__(self) -> datetime:
        return self.now


def tone() -> bytes:
    return subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "anullsrc=d=0.5", "-f", "lavfi", "-i",
         "sine=f=440:d=1", "-filter_complex", "[0][1]concat=n=2:v=0:a=1", "-f", "wav", "pipe:1"],
        capture_output=True, check=True,
    ).stdout  # fmt: skip


class Wikimedia:
    """Lingua Libre's query service and Commons, scripted; counts what was asked."""

    def __init__(self, found: bool = True) -> None:
        self.found = found
        self.asked: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.asked.append(request.url.host)
        if request.url.host == "lingualibre.org":
            rows = [{"file": {"value": LL}}] if self.found else []
            return httpx.Response(200, json={"results": {"bindings": rows}})
        if request.url.host == "upload.wikimedia.org":
            return httpx.Response(200, content=tone())
        pages: dict[str, Any] = {}
        if self.found:
            pages["1"] = {
                "title": TITLE,
                "imageinfo": [
                    {
                        "url": "https://upload.wikimedia.org/a/Hund.wav",
                        "extmetadata": {
                            "Artist": {"value": "Speaker: Natschi Recorder: Natschi"},
                            "LicenseShortName": {"value": "CC BY-SA 4.0"},
                            "LicenseUrl": {
                                "value": "https://creativecommons.org/licenses/by-sa/4.0"
                            },
                        },
                    }
                ],
            }
        return httpx.Response(200, json={"query": {"pages": pages}})


async def no_wait(_: float) -> None:
    return None


def client(
    wiki: Wikimedia | None, folder: Path, clock: Clock | None = None
) -> tuple[TestClient, Engine]:
    conn = store.connect(":memory:")
    engine = Engine(conn, AppModel(IN_RANGE).ask_for, None, clock or Clock(), random.Random(1))
    commons = Commons("test", httpx.MockTransport(wiki), lambda: 0.0, no_wait) if wiki else None
    app = create_app(engine, "open sesame", commons=commons, native_dir=folder)
    return started(app), engine


def test_a_word_is_looked_up_credited_and_kept(tmp_path: Path) -> None:
    wiki = Wikimedia()
    app, _ = client(wiki, tmp_path)
    got = app.post("/api/native/find", json={"language": "de", "words": ["Hund"]}, headers=AUTH)
    assert got.status_code == 200
    [word] = got.json()["results"]
    [rec] = word["recordings"]
    assert (word["word"], rec["speaker"], rec["license"], rec["source"]) == (
        "Hund",
        "Natschi",
        "CC BY-SA 4.0",
        "lingualibre",
    )
    assert rec["credit"].endswith("trimmed and loudness-evened")
    assert got.json()["pending"] == []
    asked = len(wiki.asked)
    # Asked again: answered from what was kept, with no request to Wikimedia.
    app.post("/api/native/find", json={"language": "de", "words": ["Hund"]}, headers=AUTH)
    assert len(wiki.asked) == asked


def test_a_word_with_none_is_asked_again_only_once_the_answer_is_old(tmp_path: Path) -> None:
    wiki, clock = Wikimedia(found=False), Clock()
    app, _ = client(wiki, tmp_path, clock)
    body = {"language": "de", "words": ["Quatsch"]}
    assert (
        app.post("/api/native/find", json=body, headers=AUTH).json()["results"][0]["recordings"]
        == []
    )
    asked = len(wiki.asked)
    clock.now = NOW + timedelta(days=native_store.NONE_DAYS - 1)
    app.post("/api/native/find", json=body, headers=AUTH)
    assert len(wiki.asked) == asked
    clock.now = NOW + timedelta(days=native_store.NONE_DAYS + 1)
    app.post("/api/native/find", json=body, headers=AUTH)
    assert len(wiki.asked) > asked


def test_many_words_beyond_the_first_few_are_looked_up_in_the_background(tmp_path: Path) -> None:
    wiki = Wikimedia(found=False)
    app, _ = client(wiki, tmp_path)
    words = [f"w{i}" for i in range(6)]
    first = app.post(
        "/api/native/find", json={"language": "de", "words": words}, headers=AUTH
    ).json()
    assert [r["word"] for r in first["results"]] == words[:3]
    assert first["pending"] == words[3:]
    # The background lookups ran after the answer: asked again, every word is there.
    again = app.post(
        "/api/native/find", json={"language": "de", "words": words}, headers=AUTH
    ).json()
    assert [r["word"] for r in again["results"]] == words and again["pending"] == []


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")
def test_the_audio_is_served_trimmed_and_kept_and_only_for_a_found_recording(
    tmp_path: Path,
) -> None:
    wiki = Wikimedia()
    app, _ = client(wiki, tmp_path)
    assert app.get("/api/native/audio", params={"title": TITLE}, headers=AUTH).status_code == 404
    app.post("/api/native/find", json={"language": "de", "words": ["Hund"]}, headers=AUTH)
    got = app.get("/api/native/audio", params={"title": TITLE}, headers=AUTH)
    assert got.status_code == 200 and got.headers["content-type"] == "audio/mpeg"
    assert len(list(tmp_path.glob("*.mp3"))) == 1
    downloads = wiki.asked.count("upload.wikimedia.org")
    app.get("/api/native/audio", params={"title": TITLE}, headers=AUTH)
    assert wiki.asked.count("upload.wikimedia.org") == downloads


def test_without_commons_or_the_passphrase_it_says_so(tmp_path: Path) -> None:
    app, _ = client(None, tmp_path)
    got = app.post("/api/native/find", json={"language": "de", "words": ["Hund"]}, headers=AUTH)
    assert got.status_code == 503
    app, _ = client(Wikimedia(), tmp_path)
    assert (
        app.post("/api/native/find", json={"language": "de", "words": ["Hund"]}).status_code == 401
    )


def test_commons_down_is_a_503_that_says_what_failed(tmp_path: Path) -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no", request=request)

    conn = store.connect(":memory:")
    engine = Engine(conn, AppModel(IN_RANGE).ask_for, None, Clock(), random.Random(1))
    commons = Commons("test", httpx.MockTransport(down), lambda: 0.0, no_wait)
    app = started(create_app(engine, "open sesame", commons=commons, native_dir=tmp_path))
    got = app.post("/api/native/find", json={"language": "de", "words": ["Hund"]}, headers=AUTH)
    assert got.status_code == 503 and "lingualibre.org" in got.json()["detail"]
