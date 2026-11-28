"""The Commons lookup against a scripted Lingua Libre and Commons: no network needed."""

import json
import urllib.parse
from typing import Any

import httpx
import pytest

from franki_speech.commons import (
    MIN_INTERVAL,
    Commons,
    CommonsUnavailable,
    Recording,
    spellings,
)

pytestmark = pytest.mark.anyio

LL_FILE = "http://commons.wikimedia.org/wiki/Special:FilePath/LL-Q188%20(deu)-Natschi-Hund.wav"


def info(title: str, artist: str, license: str, url: str = "") -> dict[str, Any]:
    return {
        "title": title,
        "imageinfo": [
            {
                "url": f"https://upload.wikimedia.org/x/{title[5:]}",
                "extmetadata": {
                    "Artist": {"value": artist},
                    "LicenseShortName": {"value": license},
                    "LicenseUrl": {"value": url},
                },
            }
        ],
    }


def pages(*items: dict[str, Any], missing: tuple[str, ...] = ()) -> dict[str, Any]:
    out: dict[str, Any] = {str(i): p for i, p in enumerate(items)}
    for j, t in enumerate(missing):
        out[str(-1 - j)] = {"title": t, "missing": ""}
    return {"query": {"pages": out}}


class Script:
    """Answers Lingua Libre's query and Commons' API, and records every request."""

    def __init__(self, ll: list[str], commons: dict[str, Any], audio: bytes = b"RIFF") -> None:
        self.ll, self.commons, self.audio = ll, commons, audio
        self.seen: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.seen.append(request)
        if request.url.host == "lingualibre.org":
            rows = [{"file": {"value": f}} for f in self.ll]
            return httpx.Response(200, json={"results": {"bindings": rows}})
        if request.url.host == "upload.wikimedia.org":
            return httpx.Response(200, content=self.audio)
        return httpx.Response(200, json=self.commons)


class Clock:
    def __init__(self) -> None:
        self.now = 100.0
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


def commons(script: Any, clock: Clock | None = None) -> Commons:
    clock = clock or Clock()
    return Commons("test-agent", httpx.MockTransport(script), clock, clock.sleep)


def test_spellings_cover_case_once() -> None:
    assert spellings("Hund") == ["Hund", "hund"]
    assert spellings(" kot ") == ["kot", "Kot"]
    assert spellings("ไม่") == ["ไม่"]


async def test_lingua_libre_first_then_older_files_each_with_its_own_license() -> None:
    script = Script(
        [LL_FILE],
        pages(
            info("File:De-Hund.ogg", '<a href="x">Thogo</a>', "CC BY 3.0", "https://cc/by/3.0"),
            info(
                "File:LL-Q188 (deu)-Natschi-Hund.wav",
                "",
                "CC BY-SA 4.0",
                "https://creativecommons.org/licenses/by-sa/4.0",
            ),
            missing=("File:De-hund.ogg",),
        ),
    )
    found = await commons(script).find("de", "Hund")
    assert [(r.source, r.speaker, r.license) for r in found] == [
        ("lingualibre", "Natschi", "CC BY-SA 4.0"),
        ("wiktionary", "Thogo", "CC BY 3.0"),
    ]
    sparql = script.seen[0]
    assert sparql.headers["User-Agent"] == "test-agent"
    query = urllib.parse.unquote_plus(sparql.content.decode())
    assert "entity/Q24" in query and '"Hund"' in query and '"hund"' in query
    titles = dict(script.seen[1].url.params)["titles"].split("|")
    assert titles == ["File:LL-Q188 (deu)-Natschi-Hund.wav", "File:De-Hund.ogg", "File:De-hund.ogg"]


async def test_a_file_whose_license_doesnt_allow_keeping_it_is_left_out() -> None:
    ll = "http://commons.wikimedia.org/wiki/Special:FilePath/LL-Q809%20(pol)-B-kot.wav"
    script = Script(
        [ll],
        pages(
            info("File:LL-Q809 (pol)-B-kot.wav", "B", ""),
            info("File:Pl-kot.ogg", "A", "GFDL"),
            info("File:Pl-Kot.ogg", "C", "Public domain"),
        ),
    )
    found = await commons(script).find("pl", "kot")
    assert [r.license for r in found] == ["Public domain"]


async def test_the_credit_names_who_the_license_the_file_and_the_change() -> None:
    rec = Recording(
        "File:LL-Q188 (deu)-Natschi-Hund.wav",
        "lingualibre",
        "Natschi",
        "CC BY-SA 4.0",
        "https://creativecommons.org/licenses/by-sa/4.0",
        "https://upload.wikimedia.org/a.wav",
    )
    assert rec.credit == (
        "Natschi (Lingua Libre), CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0, "
        "https://commons.wikimedia.org/wiki/File:LL-Q188_(deu)-Natschi-Hund.wav, "
        "trimmed and loudness-evened"
    )
    assert "—" not in rec.credit
    public = Recording("File:Ru-я.ogg", "wiktionary", "X", "Public domain", "", "https://u/a.ogg")
    assert public.credit.startswith("X (Wiktionary), Public domain, https://commons")


async def test_requests_are_spaced_and_a_429_is_waited_out() -> None:
    calls = {"n": 0}

    def busy(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, headers={"Retry-After": "7"})
        if request.url.host == "lingualibre.org":
            return httpx.Response(200, json={"results": {"bindings": []}})
        return httpx.Response(200, json=pages())

    clock = Clock()
    await commons(busy, clock).find("pl", "kot")
    assert 7.0 in clock.slept
    # Every request after the first waited out the interval since the one before.
    assert all(s >= MIN_INTERVAL - 1e-9 for s in clock.slept if s != 7.0)


async def test_an_unreachable_or_refusing_server_is_said_plainly() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    with pytest.raises(CommonsUnavailable, match="lingualibre.org"):
        await commons(down).find("pl", "kot")

    with pytest.raises(CommonsUnavailable, match="too many"):
        await commons(lambda r: httpx.Response(429)).find("pl", "kot")


async def test_a_language_with_neither_source_asks_nothing() -> None:
    script = Script([], pages())
    assert await commons(script).find("tok", "pona") == []
    assert script.seen == []


async def test_the_audio_comes_only_from_wikimedias_servers() -> None:
    script = Script([], pages(), audio=b"OggS")
    good = Recording(
        "File:a.ogg", "wiktionary", "X", "CC0", "", "https://upload.wikimedia.org/a.ogg"
    )
    assert await commons(script).audio(good) == b"OggS"
    elsewhere = Recording("File:a.ogg", "wiktionary", "X", "CC0", "", "https://example.com/a.ogg")
    with pytest.raises(CommonsUnavailable):
        await commons(script).audio(elsewhere)


def test_a_wikimedia_answer_is_json() -> None:
    # The scripted answers are what Commons sends: the parser reads `query.pages` by title.
    assert json.loads(json.dumps(pages(info("File:a.ogg", "A", "CC0"))))["query"]["pages"]["0"]


async def test_lingua_libres_speaker_is_named_and_its_test_account_skipped() -> None:
    files = [
        "http://commons.wikimedia.org/wiki/Special:FilePath/LL-Q188%20(deu)-Lucas-Hund.wav",
        "http://commons.wikimedia.org/wiki/Special:FilePath/LL-Q188%20(deu)-teste%20(Pamputt)-Hund.wav",
    ]
    script = Script(
        files,
        pages(
            info("File:LL-Q188 (deu)-Lucas-Hund.wav", "Speaker: Lucas W Recorder: Lucas W", "CC0"),
            info("File:LL-Q188 (deu)-teste (Pamputt)-Hund.wav", "Speaker: teste", "CC0"),
        ),
    )
    found = await commons(script).find("de", "Hund")
    assert [(r.speaker, r.license) for r in found] == [("Lucas W", "CC0")]
