"""The Commons lookup against a scripted Lingua Libre and Commons: no network needed."""

import json
import re
import urllib.parse
from typing import Any

import httpx
import pytest

from franki_speech import commons as commons_module
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


def asked_spellings(request: httpx.Request) -> list[str]:
    """The spellings a Lingua Libre query's VALUES names, in order."""
    query = urllib.parse.parse_qs(request.content.decode())["query"][0]
    return re.findall(r'"((?:[^"\\]|\\.)*)"', query.split("VALUES ?t {", 1)[1])


def record(n: int, spelling: str, file: str) -> dict[str, Any]:
    """A row as Lingua Libre's query answers it: the record, the spelling it matched, the file."""
    return {
        "r": {"type": "uri", "value": f"https://lingualibre.org/entity/Q{n}"},
        "t": {"type": "literal", "value": spelling},
        "file": {"type": "uri", "value": file},
    }


class Script:
    """Answers Lingua Libre's query and Commons' API, and records every request. `ll` is the
    files Lingua Libre has, each answered with the first spelling the query asks for, unless it's
    a row already (`record`)."""

    def __init__(self, ll: list[Any], commons: dict[str, Any], audio: bytes = b"RIFF") -> None:
        self.ll, self.commons, self.audio = ll, commons, audio
        self.seen: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.seen.append(request)
        if request.url.host == "lingualibre.org":
            first = asked_spellings(request)[0]
            rows = [
                f if isinstance(f, dict) else record(i + 1, first, f) for i, f in enumerate(self.ll)
            ]
            asked = set(asked_spellings(request))
            rows = [r for r in rows if r["t"]["value"] in asked]
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


def ll_file(name: str) -> str:
    return "http://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(name)


class Library:
    """Lingua Libre and Commons holding the given files: answers a query for any spellings and a
    request for any titles, as the real services do, and records every request."""

    def __init__(self, records: list[dict[str, Any]], files: dict[str, dict[str, Any]]) -> None:
        self.records, self.files = records, files
        self.seen: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.seen.append(request)
        if request.url.host == "lingualibre.org":
            asked = set(asked_spellings(request))
            rows = [r for r in self.records if r["t"]["value"] in asked]
            return httpx.Response(200, json={"results": {"bindings": rows}})
        titles = dict(request.url.params)["titles"].split("|")
        assert len(titles) <= commons_module.TITLES_PER_REQUEST
        found = [self.files[t] for t in titles if t in self.files]
        missing = tuple(t for t in titles if t not in self.files)
        return httpx.Response(200, json=pages(*found, missing=missing))

    def hosts(self) -> list[str]:
        return [r.url.host for r in self.seen]


async def test_many_words_are_looked_up_in_one_query_and_one_request_as_if_alone() -> None:
    hund = "LL-Q188 (deu)-Natschi-Hund.wav"
    rot_a, rot_b = "LL-Q188 (deu)-A-rot.wav", "LL-Q188 (deu)-B-Rot.wav"
    files = {
        f"File:{n}": info(f"File:{n}", f"Speaker: {n.split('-')[2]}", "CC BY-SA 4.0")
        for n in (hund, rot_a, rot_b)
    } | {"File:De-Vogel.ogg": info("File:De-Vogel.ogg", "Thogo", "CC BY 3.0")}
    # In the service's order, not the records': a query for several words can answer in another
    # order than one for a word alone, which answers in record order.
    records = [
        record(9, "rot", ll_file(rot_a)),
        record(4, "Hund", ll_file(hund)),
        record(3, "Rot", ll_file(rot_b)),
    ]
    library = Library(records, files)
    words = ["Hund", "rot", "Vogel", "Katze"]
    found = await commons(library).find_many("de", words)
    assert library.hosts() == ["lingualibre.org", "commons.wikimedia.org"]
    assert [r.speaker for r in found["Hund"]] == ["Natschi"]
    assert [r.speaker for r in found["rot"]] == ["B", "A"]
    assert [(r.source, r.speaker) for r in found["Vogel"]] == [("wiktionary", "Thogo")]
    assert found["Katze"] == []
    for word in words:
        assert await commons(Library(records, files)).find("de", word) == found[word]


async def test_a_spelling_two_words_share_finds_the_file_for_both() -> None:
    title = "File:LL-Q188 (deu)-Natschi-Hund.wav"
    library = Library([record(1, "hund", LL_FILE)], {title: info(title, "Natschi", "CC0")})
    found = await commons(library).find_many("de", ["Hund", "hund"])
    assert [r.title for r in found["Hund"]] == [title] == [r.title for r in found["hund"]]
    assert asked_spellings(library.seen[0]) == ["Hund", "hund"]


async def test_a_long_list_is_split_at_each_services_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(commons_module, "WORDS_PER_QUERY", 2)
    monkeypatch.setattr(commons_module, "TITLES_PER_REQUEST", 4)
    library = Library([], {})
    found = await commons(library).find_many("pl", ["kot", "pies", "dom"])
    assert found == {"kot": [], "pies": [], "dom": []}
    # Two queries (two words, then one), then their six titles in two requests.
    assert library.hosts() == ["lingualibre.org"] * 2 + ["commons.wikimedia.org"] * 2
    assert [asked_spellings(r) for r in library.seen[:2]] == [
        ["kot", "Kot", "pies", "Pies"],
        ["dom", "Dom"],
    ]
