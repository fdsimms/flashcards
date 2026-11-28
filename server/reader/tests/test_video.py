"""Videos (video.py): a YouTube video's subtitles added as a text to read along with it."""

import asyncio
import random
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from scripted import ENTRIES
from test_own_text import AUTH, NOW, THAI, Translator, settle

from franki_reader import store, video, video_store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.languages import Code
from franki_reader.video import Captions, Cue, VideoRefused

ID = "dQw4w9WgXcQ"


def test_reads_the_id_out_of_the_links_people_share() -> None:
    for link in (
        f"https://www.youtube.com/watch?v={ID}",
        f"https://m.youtube.com/watch?feature=share&v={ID}&t=30",
        f"https://youtu.be/{ID}?si=abc",
        f"https://www.youtube.com/shorts/{ID}",
        f"youtube.com/live/{ID}",
        f"https://music.youtube.com/watch?v={ID}",
        f"  {ID} ",
    ):
        assert video.video_id(link) == ID, link
    assert video.video_id("https://vimeo.com/12345") is None
    assert video.video_id("https://www.youtube.com/@channel") is None


def test_cues_lose_sound_marks_and_end_when_the_next_begins() -> None:
    cues = video.timed(
        [
            (2.0, 3.0, "&gt;&gt; Dzień dobry,\nco podać?"),
            (0.5, 1.0, "[Muzyka]"),
            (4.0, 2.5, "Poproszę kawę ♪"),
        ]
    )
    assert cues == [Cue(2000, 4000, "Dzień dobry, co podać?"), Cue(4000, 6500, "Poproszę kawę")]


def test_fragments_join_into_lines_until_a_sentence_ends() -> None:
    cues = [
        Cue(0, 1000, "no i wtedy"),
        Cue(1000, 2000, "poszliśmy do"),
        Cue(2000, 3000, "sklepu po chleb."),
        Cue(3000, 9000, "To był bardzo długi dzień w pracy i wszyscy byli zmęczeni."),
    ]
    assert video.lines_of(cues, "pl") == [
        Cue(0, 3000, "no i wtedy poszliśmy do sklepu po chleb."),
        cues[3],
    ]
    # Japanese is joined with no space.
    assert (
        video.lines_of([Cue(0, 1, "今日は"), Cue(1, 2, "いい天気。")], "ja")[0].text
        == "今日はいい天気。"
    )


def test_an_empty_or_too_long_video_is_refused_saying_why() -> None:
    with pytest.raises(VideoRefused, match="no words"):
        video.checked(Captions(ID, "t", "c", False, ()))
    long = Captions(ID, "t", "c", False, (Cue(0, (video.MAX_SECONDS + 60) * 1000, "a"),))
    with pytest.raises(VideoRefused, match="61 minutes"):
        video.checked(long)


def test_matches_youtubes_language_codes() -> None:
    assert video.matches("es-419", "es") and video.matches("no", "nb") and video.matches("PL", "pl")
    assert not video.matches("pt-BR", "pl")


class Transcript:
    def __init__(self, code: str, generated: bool, text: str) -> None:
        self.language_code, self.is_generated, self.text = code, generated, text

    def fetch(self) -> list[Any]:
        class Snippet:
            start, duration, text = 1.0, 2.0, self.text

        return [Snippet()]


def fetcher(
    monkeypatch: pytest.MonkeyPatch, listed: list[Transcript], oembed: int = 200
) -> video.FetchCaptions:
    import youtube_transcript_api

    class Api:
        def list(self, _: str) -> list[Transcript]:
            return listed

    monkeypatch.setattr(youtube_transcript_api, "YouTubeTranscriptApi", Api)

    def answer(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "www.youtube.com"
        return httpx.Response(oembed, json={"title": "Kawa", "author_name": "Easy Polish"})

    return video.youtube_captions(httpx.AsyncClient(transport=httpx.MockTransport(answer)), "test")


def test_the_channels_own_subtitles_come_first(monkeypatch: pytest.MonkeyPatch) -> None:
    fetch = fetcher(
        monkeypatch,
        [
            Transcript("pl", True, "auto"),
            Transcript("en", False, "en"),
            Transcript("pl", False, "own"),
        ],
    )
    got = asyncio.run(fetch(ID, "pl"))
    assert (got.title, got.channel, got.generated) == ("Kawa", "Easy Polish", False)
    assert [c.text for c in got.cues] == ["own"]
    only_auto = fetcher(monkeypatch, [Transcript("pl", True, "auto")], oembed=404)
    got = asyncio.run(only_auto(ID, "pl"))
    assert got.generated and got.title == "A video" and got.channel == ""


def test_a_video_without_subtitles_in_the_language_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fetch = fetcher(monkeypatch, [Transcript("en", False, "Hello")])
    with pytest.raises(VideoRefused, match="no Polish subtitles"):
        asyncio.run(fetch(ID, "pl"))


THAI_CUES = tuple(
    Cue(i * 3000, i * 3000 + 2500, line)
    for i, line in enumerate(THAI.replace("\n\n", " ").split(" "))
)


class Fetch:
    def __init__(self, refuse: str = "") -> None:
        self.asked: list[tuple[str, Code]] = []
        self.refuse = refuse

    async def __call__(self, video_id: str, language: Code) -> Captions:
        self.asked.append((video_id, language))
        if self.refuse:
            raise VideoRefused(self.refuse)
        return Captions(video_id, "ข้าวเหนียว", "Thai Street", True, THAI_CUES)


def engine(translator: Translator | None) -> Engine:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    return Engine(conn, None, None, lambda: NOW, random.Random(1), write_translation=translator)


def test_adding_makes_one_unrecorded_text_with_each_lines_times() -> None:
    e = engine(Translator())

    async def scenario() -> None:
        text_id = e.add_video("th", Captions(ID, "ข้าวเหนียว", "Thai Street", True, THAI_CUES))
        await settle(e)
        [text] = store.own_texts(e.conn, "th")
        assert text.id == text_id and text.title == "ข้าวเหนียว"
        assert [ln.english for ln in text.lines][:2] == ["English 0", "English 1"]
        kept = video_store.of(e.conn, text_id)
        assert kept is not None and kept.video_id == ID and kept.generated
        assert len(kept.times) == len(text.lines) and kept.times[0][0] == 0
        assert not e.has_audio(text_id, 0)

    asyncio.run(scenario())


def test_the_routes_preview_add_and_send_the_video_with_the_text() -> None:
    e = engine(Translator())
    fetch = Fetch()
    body = {"language": "th", "link": f"https://youtu.be/{ID}"}
    with TestClient(create_app(e, "open sesame", None, fetch_captions=fetch)) as c:
        preview = c.post("/api/videos/preview", json=body, headers=AUTH)
        assert preview.status_code == 200, preview.json()
        p = preview.json()
        assert p["video_id"] == ID and p["generated"] and p["channel"] == "Thai Street"
        assert p["seconds"] > 0 and 0 < p["coverage"] <= 1 and p["cost_usd"] >= 0
        added = c.post("/api/videos", json=body, headers=AUTH)
        assert added.status_code == 202
        # The subtitles fetched for the preview are used again.
        assert len(fetch.asked) == 1
        not_a_link = c.post(
            "/api/videos/preview", json={"language": "th", "link": "hello"}, headers=AUTH
        )
        assert not_a_link.status_code == 422 and "isn't a link" in not_a_link.json()["detail"]
        assert c.post("/api/videos", json=body).status_code == 401
    asyncio.run(settle(e))
    with TestClient(create_app(e, "open sesame", None, fetch_captions=fetch)) as c:
        shelf = c.get("/api/shelf?language=th", headers=AUTH).json()
        assert shelf["own"][0]["video"] == {"id": ID, "channel": "Thai Street", "generated": True}
        text = c.get(f"/api/texts/{shelf['own'][0]['id']}", headers=AUTH).json()
        assert text["video"]["id"] == ID and len(text["video"]["times"]) == len(text["lines"])
        assert not any(line["audio"] for line in text["lines"])


def test_a_refusal_says_why_and_no_fetcher_is_a_503() -> None:
    e = engine(Translator())
    body = {"language": "th", "link": ID}
    with TestClient(
        create_app(
            e, "open sesame", None, fetch_captions=Fetch("This video has subtitles turned off.")
        )
    ) as c:
        r = c.post("/api/videos/preview", json=body, headers=AUTH)
        assert r.status_code == 422 and r.json()["detail"] == "This video has subtitles turned off."
    with TestClient(create_app(e, "open sesame", None)) as c:
        assert c.post("/api/videos/preview", json=body, headers=AUTH).status_code == 503
