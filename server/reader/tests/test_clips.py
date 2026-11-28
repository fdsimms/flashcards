"""A text's line as it was said (routes/clips.py): a podcast's line cut from the episode, a written
text's own recording, and none for a video's."""

import asyncio
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from test_app import speaking_client
from test_own_text import AUTH, Translator, settle
from test_podcast import FEED, FEED_BODY, Web, engine, source
from test_video import ID, THAI_CUES

from franki_reader import podcast, podcast_store
from franki_reader.app import create_app
from franki_reader.podcast import PodcastRefused, clip_window, episode_clipper
from franki_reader.routes import clips
from franki_reader.video import Captions


class Cutter:
    """The episode clipper, scripted: each clip names what it was cut from."""

    def __init__(self, fail: str = "") -> None:
        self.asked: list[tuple[str, int, int]] = []
        self.fail = fail

    async def __call__(self, url: str, start_ms: int, end_ms: int) -> bytes:
        self.asked.append((url, start_ms, end_ms))
        if self.fail:
            raise PodcastRefused(self.fail)
        return f"ID3 {url} {start_ms}-{end_ms}".encode()


async def leveled(audio: bytes, *, sample_rate: int = 24000) -> bytes:
    return b"leveled " + audio


def test_a_clip_starts_and_ends_a_little_outside_its_line_and_a_long_line_is_cut_short() -> None:
    assert clip_window(4000, 6000) == (3.85, 2.3)
    assert clip_window(50, 900) == (0, 1.05)
    begin, length = clip_window(0, 60_000)
    assert begin == 0 and length == (podcast.MAX_CLIP_MS + podcast.CLIP_MARGIN_MS) / 1000


def test_the_episode_is_only_read_from_a_public_address() -> None:
    def site(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://192.168.1.4/ep.mp3"})

    clip = episode_clipper(httpx.AsyncClient(transport=httpx.MockTransport(site)), "test")

    async def cut(url: str) -> bytes:
        return await clip(url, 0, 1000)

    with pytest.raises(PodcastRefused, match="public internet"):
        asyncio.run(cut("https://cdn.example.com/new.mp3"))
    with pytest.raises(PodcastRefused, match="isn't a web address"):
        asyncio.run(cut("file:///etc/passwd"))


def podcast_text(tmp_path: Path, cutter: Cutter | None) -> tuple[TestClient, int]:
    e = engine()
    p = source(Web(FEED_BODY))
    body = {"language": "pl", "feed": FEED, "guid": "new"}
    with TestClient(create_app(e, "open sesame", None, podcasts=p)) as c:
        added = c.post("/api/podcasts", json=body, headers=AUTH)
        assert added.status_code == 202
    asyncio.run(settle(e))
    app = create_app(
        e, "open sesame", None, podcasts=p, clip_episode=cutter, clips_dir=tmp_path / "clips"
    )
    return TestClient(app), added.json()["id"]


def test_a_podcasts_line_is_cut_from_the_episode_leveled_and_kept(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(clips, "normalize_loudness", leveled)
    cutter = Cutter()
    c, text_id = podcast_text(tmp_path, cutter)
    with c:
        got = c.get(f"/api/texts/{text_id}/lines/1/clip", headers=AUTH)
        assert got.status_code == 200 and got.headers["content-type"] == "audio/mpeg"
        assert got.content == b"leveled ID3 https://cdn.example.com/new.mp3 4000-6000"
        again = c.get(f"/api/texts/{text_id}/lines/1/clip", headers=AUTH)
        assert again.content == got.content and len(cutter.asked) == 1
        assert c.get(f"/api/texts/{text_id}/lines/1/clip").status_code == 401
        assert c.get(f"/api/texts/{text_id}/lines/9/clip", headers=AUTH).status_code == 404
        assert c.get("/api/texts/999/lines/0/clip", headers=AUTH).status_code == 404


def test_a_clip_that_cant_be_cut_says_why(tmp_path: Path) -> None:
    c, text_id = podcast_text(tmp_path, Cutter("The episode's site answered 404. Try again later."))
    with c:
        failed = c.get(f"/api/texts/{text_id}/lines/0/clip", headers=AUTH)
        assert failed.status_code == 503 and "answered 404" in failed.json()["detail"]
    c, text_id = podcast_text(tmp_path, None)
    with c:
        off = c.get(f"/api/texts/{text_id}/lines/0/clip", headers=AUTH)
        assert off.status_code == 503 and "can't cut" in off.json()["detail"]


def test_a_written_texts_line_is_its_own_recording(tmp_path: Path) -> None:
    c = speaking_client(tmp_path)
    topic = c.post("/api/topics", json={"name": "Food stall"}, headers=AUTH).json()
    from test_app import next_text

    text = next_text(c, topic["id"]).json()
    got = c.get(f"/api/texts/{text['id']}/lines/0/clip", headers=AUTH)
    assert got.status_code == 200 and got.content.startswith(b"ID3")


def test_a_videos_line_has_no_clip(tmp_path: Path) -> None:
    e = engine()
    e.write_translation = Translator()

    async def add() -> int:
        text_id = e.add_video("th", Captions(ID, "ข้าวเหนียว", "Thai Street", True, THAI_CUES))
        await settle(e)
        return text_id

    text_id = asyncio.run(add())
    assert podcast_store.of(e.conn, text_id) is None
    app = create_app(e, "open sesame", None, clip_episode=Cutter(), clips_dir=tmp_path)
    with TestClient(app) as c:
        got = c.get(f"/api/texts/{text_id}/lines/0/clip", headers=AUTH)
        assert got.status_code == 404 and "YouTube" in got.json()["detail"]
