"""Podcasts (podcast.py): an episode's published transcript added as a text to read along with it."""

import asyncio
import json
import random
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from scripted import ENTRIES
from test_own_text import AUTH, NOW, Translator, settle

from franki_reader import podcast, podcast_store, store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.podcast import PodcastRefused, Podcasts, Transcript
from franki_reader.video import Cue

FEED = "https://feeds.example.com/polski.xml"
VTT = """WEBVTT

1
00:00:01.000 --> 00:00:03.500 align:start
<v Ania>Dzień dobry, co podać?

00:00:04.000 --> 00:00:06.000
Poproszę kawę z mlekiem.
"""
SRT = """1
00:00:01,000 --> 00:00:03,500
Dzień dobry,
co podać?

2
00:00:04,000 --> 00:00:06,000
Poproszę kawę.
"""


def rss(*items: str) -> bytes:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:podcast="https://podcastindex.org/namespace/1.0">
<channel><title>Polski z Anią</title><itunes:author>Ania</itunes:author>
<itunes:image href="https://img.example.com/a.jpg"/>{"".join(items)}</channel></rss>""".encode()


def item(guid: str, date: str, transcript: str = "", duration: str = "12:10") -> str:
    return f"""<item><title>Odcinek {guid}</title><guid>{guid}</guid><pubDate>{date}</pubDate>
<itunes:duration>{duration}</itunes:duration>
<enclosure url="https://cdn.example.com/{guid}.mp3" type="audio/mpeg"/>{transcript}</item>"""


VTT_TAG = '<podcast:transcript url="https://cdn.example.com/a.vtt" type="text/vtt"/>'
HTML_TAG = '<podcast:transcript url="https://cdn.example.com/a.html" type="text/html"/>'
JSON_TAG = '<podcast:transcript url="https://cdn.example.com/a.json" type="application/json"/>'


def test_only_public_web_addresses_are_read() -> None:
    assert (
        podcast.public_url(" https://feeds.example.com/a.xml ") == "https://feeds.example.com/a.xml"
    )
    for bad in (
        "file:///etc/passwd",
        "http://localhost/x",
        "http://10.0.0.5/f",
        "http://192.168.1.2/f",
        "http://[::1]/f",
        "http://reader:8000/x",
        "ftp://example.com/f",
    ):
        with pytest.raises(PodcastRefused):
            podcast.public_url(bad)


def test_reads_an_apple_podcasts_links_show_and_episode() -> None:
    assert podcast.apple_ids(
        "https://podcasts.apple.com/pl/podcast/polski/id123456?i=1000654321"
    ) == ("123456", "1000654321")
    assert podcast.apple_ids("https://podcasts.apple.com/us/podcast/x/id42") == ("42", None)
    assert podcast.apple_ids(FEED) is None


def test_a_feeds_episodes_newest_first_with_the_best_transcript() -> None:
    feed = podcast.parse_feed(
        rss(
            item("old", "Mon, 03 Nov 2026 08:00:00 GMT", VTT_TAG),
            item("new", "Mon, 24 Nov 2026 08:00:00 GMT", VTT_TAG + JSON_TAG),
            item("none", "Mon, 10 Nov 2026 08:00:00 GMT", HTML_TAG, duration="1860"),
        ),
        FEED,
    )
    assert (feed.title, feed.author, feed.artwork) == (
        "Polski z Anią",
        "Ania",
        "https://img.example.com/a.jpg",
    )
    assert [e.guid for e in feed.episodes] == ["new", "none", "old"]
    assert feed.episodes[0].transcript == Transcript("https://cdn.example.com/a.json", "json")
    # HTML has no times, so it doesn't count.
    assert feed.episodes[1].transcript is None and feed.episodes[1].seconds == 1860
    assert (
        feed.episodes[2].seconds == 730
        and feed.episodes[2].audio == "https://cdn.example.com/old.mp3"
    )
    assert podcast.transcripts_share(feed) == "most"


def test_a_hostile_or_broken_feed_is_refused() -> None:
    bomb = b'<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><rss><channel><title>&b;</title></channel></rss>'
    with pytest.raises(PodcastRefused):
        podcast.parse_feed(bomb, FEED)
    with pytest.raises(PodcastRefused):
        podcast.parse_feed(b"<html>not a feed", FEED)


def test_reads_webvtt_srt_and_json_transcripts() -> None:
    expected = [
        Cue(1000, 3500, "Dzień dobry, co podać?"),
        Cue(4000, 6000, "Poproszę kawę z mlekiem."),
    ]
    assert podcast.parse_timed(VTT) == expected
    assert podcast.parse_timed(SRT)[0] == Cue(1000, 3500, "Dzień dobry, co podać?")
    segments = {
        "segments": [
            {"startTime": 4.0, "endTime": 6, "body": "Poproszę"},
            {"startTime": 1, "endTime": 3.5, "body": "Dzień dobry"},
            {"body": ""},
        ]
    }
    assert podcast.parse_json(json.dumps(segments)) == [
        Cue(1000, 3500, "Dzień dobry"),
        Cue(4000, 6000, "Poproszę"),
    ]


class Web:
    """Apple's directory, a feed and its transcripts, scripted; records what was asked."""

    def __init__(self, feed: bytes) -> None:
        self.feed = feed
        self.asked: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.asked.append(url)
        if request.url.host == "itunes.apple.com":
            if request.url.path == "/search":
                return httpx.Response(
                    200,
                    json={
                        "results": [
                            {
                                "collectionName": "Polski z Anią",
                                "artistName": "Ania",
                                "feedUrl": FEED,
                                "artworkUrl600": "https://img.example.com/a.jpg",
                            },
                            {"collectionName": "No feed"},
                        ]
                    },
                )
            return httpx.Response(
                200,
                json={
                    "results": [
                        {"wrapperType": "track", "kind": "podcast", "feedUrl": FEED},
                        {"trackId": 99, "episodeGuid": "new"},
                    ]
                },
            )
        if url == "https://feeds.example.com/moved":
            return httpx.Response(301, headers={"location": "http://10.0.0.5/feed"})
        if url == FEED:
            return httpx.Response(200, content=self.feed)
        if url.endswith(".vtt"):
            return httpx.Response(200, text=VTT)
        return httpx.Response(404)


FEED_BODY = rss(
    item("new", "Mon, 24 Nov 2026 08:00:00 GMT", VTT_TAG),
    item("bare", "Mon, 03 Nov 2026 08:00:00 GMT"),
)


def source(web: Web) -> Podcasts:
    return Podcasts(httpx.AsyncClient(transport=httpx.MockTransport(web)), "test")


def test_search_says_which_shows_have_transcripts_and_feeds_are_kept() -> None:
    web = Web(FEED_BODY)
    p = source(web)

    async def scenario() -> None:
        [show] = await p.search("polski", "pl")
        assert (show.title, show.feed, show.transcripts) == ("Polski z Anią", FEED, "most")
        await p.feed(FEED)

    asyncio.run(scenario())
    assert sum(1 for u in web.asked if u == FEED) == 1
    assert "country=pl" in web.asked[0]


def test_an_apple_episode_link_finds_its_episode_in_the_feed() -> None:
    p = source(Web(FEED_BODY))
    feed, picked = asyncio.run(p.from_link("https://podcasts.apple.com/pl/podcast/x/id5?i=99"))
    assert feed.title == "Polski z Anią" and picked == "new"


def test_a_redirect_to_the_servers_own_network_is_refused() -> None:
    p = source(Web(FEED_BODY))
    with pytest.raises(PodcastRefused, match="public internet"):
        asyncio.run(p.feed("https://feeds.example.com/moved"))


def test_a_feed_too_large_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(podcast, "MAX_FEED_BYTES", 100)
    with pytest.raises(PodcastRefused, match="too large"):
        asyncio.run(source(Web(FEED_BODY)).feed(FEED))


def engine() -> Engine:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW, "pl")
    return Engine(conn, None, None, lambda: NOW, random.Random(1), write_translation=Translator())


def test_the_routes_list_preview_add_and_send_the_episode_with_the_text() -> None:
    e = engine()
    p = source(Web(FEED_BODY))
    body: dict[str, Any] = {"language": "pl", "feed": FEED, "guid": "new"}
    with TestClient(create_app(e, "open sesame", None, podcasts=p)) as c:
        listed = c.post("/api/podcasts/episodes", json={"link": FEED}, headers=AUTH).json()
        assert [(x["guid"], x["transcript"]) for x in listed["episodes"]] == [
            ("new", True),
            ("bare", False),
        ]
        assert listed["show"]["title"] == "Polski z Anią" and listed["picked"] is None
        preview = c.post("/api/podcasts/preview", json=body, headers=AUTH)
        assert preview.status_code == 200, preview.json()
        assert preview.json()["lines"] == 2 and preview.json()["seconds"] == 6
        bare = c.post("/api/podcasts/preview", json=body | {"guid": "bare"}, headers=AUTH)
        assert bare.status_code == 422 and "no transcript" in bare.json()["detail"]
        assert c.post("/api/podcasts", json=body).status_code == 401
        added = c.post("/api/podcasts", json=body, headers=AUTH)
        assert added.status_code == 202
    asyncio.run(settle(e))
    kept = podcast_store.of(e.conn, added.json()["id"])
    assert kept is not None and kept.audio == "https://cdn.example.com/new.mp3"
    assert not e.has_audio(added.json()["id"], 0)
    with TestClient(create_app(e, "open sesame", None, podcasts=p)) as c:
        shelf = c.get("/api/shelf?language=pl", headers=AUTH).json()
        assert shelf["own"][0]["podcast"] == {
            "show": "Polski z Anią",
            "artwork": "https://img.example.com/a.jpg",
        }
        text = c.get(f"/api/texts/{shelf['own'][0]['id']}", headers=AUTH).json()
        assert text["podcast"]["audio"].endswith("new.mp3") and len(
            text["podcast"]["times"]
        ) == len(text["lines"])
        assert not any(line["audio"] for line in text["lines"])


def test_without_podcasts_set_up_it_says_so() -> None:
    with TestClient(create_app(engine(), "open sesame", None)) as c:
        assert c.get("/api/podcasts/search?language=pl&term=x", headers=AUTH).status_code == 503
