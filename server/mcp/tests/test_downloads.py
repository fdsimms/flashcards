"""Recordings fetched from a link (add_audio_from_url), against a faked network: what's fetched,
what's refused and why, and that a recording reaches another device."""

from __future__ import annotations

import shutil
import subprocess

import httpx
import pytest
from mcp import Client

from conftest import call, call_error
from franki_mcp.downloads import MAX_BYTES, AudioFetcher, DownloadError, linked_filename
from franki_mcp.server import build_server
from franki_mcp.speech import TARGET_LUFS, measure_loudness

pytestmark = pytest.mark.anyio

WATER = 1794408858015  # Basic (and reversed card): Front "<b>น้ำ</b>"
BOOK = 1794408858013   # Front "หนังสือ"

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")

ADDRESSES = {"words.example": ["93.184.216.34"], "mirror.example": ["2606:2800:220:1::1"],
             "inside.example": ["10.0.0.5"], "half.example": ["93.184.216.35", "127.0.0.1"]}


def tone(volume: float) -> bytes:
    return subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=1.5", "-af", f"volume={volume}",
         "-ar", "44100", "-ac", "1", "-f", "mp3", "pipe:1"], check=True, capture_output=True).stdout


class FakeWeb:
    """The web as the tests need it: each link's answer, and every request made."""

    def __init__(self):
        self.pages: dict[str, httpx.Response] = {}
        self.requests: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(str(request.url))
        return self.pages.get(str(request.url), httpx.Response(404))

    def audio(self, url: str, data: bytes, kind: str = "audio/mpeg") -> None:
        self.pages[url] = httpx.Response(200, content=data, headers={"content-type": kind})


async def fake_resolve(host: str, port: int) -> list[str]:
    if host[0].isdigit() or ":" in host:  # an address written in the link resolves to itself
        return [host]
    if host not in ADDRESSES:
        raise OSError("not found")
    return ADDRESSES[host]


@pytest.fixture
def web():
    return FakeWeb()


@pytest.fixture
def fetcher(web):
    return AudioFetcher(http=httpx.AsyncClient(transport=httpx.MockTransport(web)), resolve=fake_resolve)


@pytest.fixture
async def client(cm, fetcher):
    async with Client(build_server(cm, downloads=fetcher)) as c:
        yield c


# ---- the fetcher ----

async def test_fetches_audio_and_follows_a_redirect_to_a_public_host(web, fetcher):
    web.pages["https://words.example/jan.mp3"] = httpx.Response(302, headers={"location": "https://mirror.example/a/jan.mp3"})
    web.audio("https://mirror.example/a/jan.mp3", b"ID3 jan", "audio/mpeg; charset=binary")
    got = await fetcher.fetch("https://words.example/jan.mp3")
    assert (got.data, got.kind, got.url) == (b"ID3 jan", "audio/mpeg", "https://mirror.example/a/jan.mp3")


async def test_refuses_links_that_could_reach_the_servers_own_network(web, fetcher):
    async def refused(url: str) -> str:
        with pytest.raises(DownloadError) as e:
            await fetcher.fetch(url)
        return str(e.value)

    assert "Only https" in await refused("http://words.example/jan.mp3")
    assert "Only https" in await refused("file:///etc/passwd")
    assert "private network" in await refused("https://inside.example/jan.mp3")
    assert "private network" in await refused("https://half.example/jan.mp3")  # one private address is enough
    assert "private network" in await refused("https://127.0.0.1/jan.mp3")
    assert "private network" in await refused("https://[::1]/jan.mp3")
    assert "couldn't be found" in await refused("https://nowhere.example/jan.mp3")
    # A redirect is checked like the link itself, before it's followed.
    web.pages["https://words.example/sneaky.mp3"] = httpx.Response(301, headers={"location": "https://inside.example/x"})
    assert "private network" in await refused("https://words.example/sneaky.mp3")
    assert web.requests == ["https://words.example/sneaky.mp3"]
    web.pages["https://words.example/loop.mp3"] = httpx.Response(302, headers={"location": "/loop.mp3"})
    assert "redirects more than" in await refused("https://words.example/loop.mp3")


async def test_refuses_what_isnt_audio_or_is_too_big(web, fetcher):
    async def refused(url: str) -> str:
        with pytest.raises(DownloadError) as e:
            await fetcher.fetch(url)
        return str(e.value)

    web.pages["https://words.example/page"] = httpx.Response(200, text="<html>", headers={"content-type": "text/html"})
    assert "isn't audio: it's text/html" in await refused("https://words.example/page")
    web.audio("https://words.example/big.mp3", b"x" * (MAX_BYTES + 1))
    assert "over 5 MB" in await refused("https://words.example/big.mp3")
    web.audio("https://words.example/empty.mp3", b"")
    assert "empty file" in await refused("https://words.example/empty.mp3")
    assert "answered 404" in await refused("https://words.example/missing.mp3")


def test_a_recording_is_named_from_its_bytes_and_keeps_its_type_until_leveled():
    assert linked_filename(b"a", "audio/ogg", "https://w.example/a", leveled=True).endswith(".mp3")
    assert linked_filename(b"a", "audio/ogg", "https://w.example/a", leveled=False).endswith(".ogg")
    assert linked_filename(b"a", "application/octet-stream", "https://w.example/a.wav", leveled=False).endswith(".wav")
    assert linked_filename(b"a", "audio/x-unknown", "https://w.example/a", leveled=False).endswith(".mp3")
    assert linked_filename(b"a", "audio/mpeg", "", True) == linked_filename(b"a", "audio/ogg", "x", True)


# ---- the tool ----

async def back(client, nid: int) -> str:
    return (await call(client, "get_notes", note_ids=[nid]))["notes"][0]["fields"]["Back"]


@needs_ffmpeg
async def test_puts_a_leveled_recording_in_the_field_and_it_reaches_another_device(client, cm, web, desktop):
    web.audio("https://words.example/nam.mp3", tone(0.03))
    out = await call(client, "add_audio_from_url", audio=[{"note_id": WATER, "url": "https://words.example/nam.mp3"}],
                     target_field="Back")
    assert out["added"] == 1 and "warning" not in out["results"][0]
    name = out["results"][0]["audio"]
    assert name.startswith("franki-link-") and name.endswith(".mp3")
    field = await back(client, WATER)
    assert field.endswith(f"[sound:{name}]") and field != f"[sound:{name}]"  # the meaning stays
    cm.wait_for_media()
    desktop.run("sync", "+", "media-sync")
    level = await measure_loudness((desktop.path.parent / "collection.media" / name).read_bytes())
    assert level is not None and abs(level - TARGET_LUFS) < 1.0


@needs_ffmpeg
async def test_skips_a_field_with_audio_unless_told_to_replace_it(client, web):
    web.audio("https://words.example/a.mp3", tone(0.03))
    web.audio("https://words.example/b.mp3", tone(0.05))
    link = [{"note_id": WATER, "url": "https://words.example/a.mp3"}]
    await call(client, "add_audio_from_url", audio=link, target_field="Back")
    again = await call(client, "add_audio_from_url", audio=link, target_field="Back")
    assert again["added"] == 0 and "already has audio" in again["results"][0]["error"]
    replaced = await call(client, "add_audio_from_url", audio=[{"note_id": WATER, "url": "https://words.example/b.mp3"}],
                          target_field="Back", overwrite=True)
    field = await back(client, WATER)
    assert field.count("[sound:") == 1 and replaced["results"][0]["audio"] in field


@needs_ffmpeg
async def test_a_link_that_cant_be_used_fails_only_its_own_note(client, web):
    web.audio("https://words.example/good.mp3", tone(0.03))
    web.audio("https://words.example/fake.mp3", b"not audio at all")
    out = await call(client, "add_audio_from_url", target_field="Back", audio=[
        {"note_id": WATER, "url": "https://words.example/good.mp3"},
        {"note_id": BOOK, "url": "https://words.example/fake.mp3"},
        {"note_id": WATER, "url": "https://words.example/good.mp3"},
        {"note_id": 5, "url": "https://words.example/good.mp3"},
    ])
    first, fake, twice, missing = out["results"]
    assert out["added"] == 1 and "audio" in first
    assert "isn't audio that can be played" in fake["error"]
    assert "in the list twice" in twice["error"] and "no note 5" in missing["error"]
    assert "[sound:" not in await back(client, BOOK)
    assert all("was" not in r for r in out["results"])


async def test_says_what_went_wrong(client):
    links = [{"note_id": WATER, "url": "https://words.example/a.mp3"}] * 51
    assert "Up to 50" in await call_error(client, "add_audio_from_url", audio=links, target_field="Back")
    out = await call(client, "add_audio_from_url", audio=[{"note_id": WATER, "url": "http://words.example/a.mp3"}],
                     target_field="Word")
    assert "has no field 'Word'" in out["results"][0]["error"]
    out = await call(client, "add_audio_from_url", audio=[{"note_id": WATER, "url": "http://words.example/a.mp3"}],
                     target_field="Back")
    assert out["added"] == 0 and "Only https" in out["results"][0]["error"]
