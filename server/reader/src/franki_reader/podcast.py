"""Podcasts (docs/read-and-listen/architecture.md, "Podcasts"): an episode that publishes its own
transcript (the podcast namespace's <podcast:transcript>, as WebVTT, SRT or JSON), read as a text
while the episode plays, as a video's subtitles are (video.py). The app turns this on in Settings
(off until then); the server contacts Apple's podcast directory and a show's feed only when the
learner searches for or opens a show.

Shows are found in Apple's directory (the iTunes Search API, which needs no key), from a feed's
link, or from an Apple Podcasts link (looked up to its feed, and its episode when the link names
one). A feed is read with defusedxml, so a hostile one can't expand entities, and only from a public
web address, never one on the server's own network. Feeds and transcripts are size-capped. An
episode without a transcript with timings can't be added: there'd be nothing to read along with.
Nothing here grades a card or writes the collection.
"""

import asyncio
import ipaddress
import json
import re
import shutil
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
from defusedxml import ElementTree
from franki_speech.transcribe import Transcription

from franki_reader.languages import Code
from franki_reader.video import Cue, clean_cue

MAX_FEED_BYTES = 15_000_000
MAX_TRANSCRIPT_BYTES = 5_000_000
# Search results whose feeds are read to say whether they have transcripts; the rest say nothing.
CHECKED_RESULTS = 8
SEARCH_RESULTS = 20
# A feed read this recently is used again, so the episode list and adding an episode don't ask twice.
FEED_KEEP_SECONDS = 30 * 60
TIMEOUT = 15.0

# Apple's directory is searched in the language's own storefront, so its shows come first.
_COUNTRIES: dict[str, str] = {
    "th": "th", "pl": "pl", "ru": "ru", "de": "de", "fr": "fr", "es": "es", "el": "gr",
    "nb": "no", "ja": "jp", "en": "us",
}  # fmt: skip
_ITUNES = re.compile(r"\bid(\d+)\b")
_PODCAST_NS = "https://podcastindex.org/namespace/1.0"
_ITUNES_NS = "http://www.itunes.com/dtds/podcast-1.0.dtd"
# A transcript's kind, from its MIME type or failing that its address; HTML has no timings.
_KINDS = {
    "text/vtt": "vtt",
    "application/x-subrip": "srt",
    "application/srt": "srt",
    "text/srt": "srt",
    "application/json": "json",
}
_TIMESTAMP = re.compile(r"(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})")
_ARROW = re.compile(rf"({_TIMESTAMP.pattern})\s*-->\s*({_TIMESTAMP.pattern})")
_TAG = re.compile(r"<[^>]+>")


# Azure's speech-to-text for an episode with no transcript (Transcribe): its audio's address and
# the language's locale (pl-PL), giving the words heard with their times.
Transcribe = Callable[[str, str], Awaitable[Transcription]]


def cues_of(found: Transcription) -> list[Cue]:
    """Azure's phrases as cues, cleaned as a transcript's are."""
    return [Cue(p.start_ms, p.end_ms, t) for p in found.phrases if (t := clean_cue(p.text))]


class PodcastRefused(ValueError):
    """What can't be done, and why, written for the learner."""


# A line of an episode cut out as its own clip (a card's SourceAudio, a shadowed line's pitch line):
# the episode's address and the line's start and end in milliseconds, giving MP3.
ClipEpisode = Callable[[str, int, int], Awaitable[bytes]]

# A clip starts and ends a little outside its line, since a cue's times are a transcript's guess.
CLIP_MARGIN_MS = 150
# A longer line is cut at this length: a card's clip is one sentence, and the pitch line reads 8 s.
MAX_CLIP_MS = 20_000
CLIP_TIMEOUT_SECONDS = 60


async def _final_url(client: httpx.AsyncClient, url: str, user_agent: str) -> str:
    """Where the episode's audio really is, following redirects only to public addresses (as
    `_read`), so ffmpeg is handed an address already checked."""
    target = public_url(url)
    for _ in range(8):
        async with client.stream(
            "GET",
            target,
            headers={"User-Agent": user_agent, "Range": "bytes=0-0"},
            timeout=TIMEOUT,
        ) as r:
            if r.is_redirect and "location" in r.headers:
                target = public_url(str(r.url.join(r.headers["location"])))
                continue
            if r.status_code not in (200, 206):
                raise PodcastRefused(
                    f"The episode's site answered {r.status_code}. Try again later."
                )
            return target
    raise PodcastRefused("The episode's address redirects too many times.")


def clip_window(start_ms: int, end_ms: int) -> tuple[float, float]:
    """Where a line's clip starts in the episode and how long it is, in seconds."""
    begin = max(0, start_ms - CLIP_MARGIN_MS)
    stop = min(max(end_ms, start_ms), start_ms + MAX_CLIP_MS) + CLIP_MARGIN_MS
    return begin / 1000, (stop - begin) / 1000


def episode_clipper(client: httpx.AsyncClient, user_agent: str) -> ClipEpisode:
    """Cuts a line out of an episode with ffmpeg, which seeks into the remote file with range
    requests rather than downloading the whole episode. The clip comes back as it is in the
    episode; the route levels it."""

    async def clip(url: str, start_ms: int, end_ms: int) -> bytes:
        try:
            final = await _final_url(client, url, user_agent)
        except httpx.HTTPError as e:
            raise PodcastRefused("Couldn't reach the episode's site. Try again later.") from e
        exe = shutil.which("ffmpeg")
        if exe is None:
            raise PodcastRefused("ffmpeg isn't installed on the server, so a line can't be cut.")
        begin, length = clip_window(start_ms, end_ms)
        proc = await asyncio.create_subprocess_exec(
            exe,
            *("-hide_banner", "-nostats", "-loglevel", "error"),
            *("-user_agent", user_agent, "-ss", f"{begin:.3f}", "-i", final),
            *("-t", f"{length:.3f}", "-vn", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k"),
            *("-f", "mp3", "pipe:1"),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), CLIP_TIMEOUT_SECONDS)
        except TimeoutError as e:
            proc.kill()
            raise PodcastRefused("Cutting the line from the episode took too long.") from e
        if proc.returncode != 0 or not out:
            tail = err.decode(errors="replace").strip().splitlines()[-1:] or ["no message"]
            raise PodcastRefused(f"Couldn't cut the line from the episode ({tail[0]}).")
        return out

    return clip


@dataclass(frozen=True)
class Transcript:
    url: str
    kind: str  # "vtt", "srt" or "json"


@dataclass(frozen=True)
class Episode:
    guid: str
    title: str
    published: datetime | None
    seconds: int | None
    audio: str
    transcript: Transcript | None


@dataclass(frozen=True)
class Feed:
    url: str
    title: str
    author: str
    artwork: str
    episodes: tuple[Episode, ...]

    def episode(self, guid: str) -> Episode | None:
        return next((e for e in self.episodes if e.guid == guid), None)


@dataclass(frozen=True)
class Show:
    title: str
    author: str
    feed: str
    artwork: str
    # How many of its latest episodes have a transcript: "most", "some", "none", or None unread.
    transcripts: str | None = None


def public_url(url: str) -> str:
    """`url` if it's a web address on the public internet; `PodcastRefused` for anything else (a
    file, or an address on the server's own network), so a feed can't be used to read the server."""
    parts = urlparse(url.strip())
    host = (parts.hostname or "").lower()
    if parts.scheme not in ("http", "https") or not host:
        raise PodcastRefused(
            "That isn't a web address. Paste the podcast's feed or its Apple Podcasts link."
        )
    if host == "localhost" or host.endswith((".local", ".internal", ".lan")) or "." not in host:
        raise PodcastRefused("That address isn't on the public internet.")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return url.strip()
    if not ip.is_global:
        raise PodcastRefused("That address isn't on the public internet.")
    return url.strip()


def apple_ids(link: str) -> tuple[str, str | None] | None:
    """An Apple Podcasts link's show id and its episode's (`?i=`), or None for any other link."""
    parts = urlparse(link.strip())
    if (parts.hostname or "").lower() not in ("podcasts.apple.com", "itunes.apple.com"):
        return None
    show = _ITUNES.search(parts.path)
    if not show:
        return None
    episode = parse_qs(parts.query).get("i", [None])[0]
    return show.group(1), episode


def _text(node: Any, tag: str) -> str:
    found = node.find(tag)
    return (found.text or "").strip() if found is not None and found.text else ""


def _seconds(raw: str) -> int | None:
    """itunes:duration: seconds, or H:MM:SS / MM:SS."""
    if not raw:
        return None
    try:
        parts = [int(float(p)) for p in raw.strip().split(":")]
    except ValueError:
        return None
    total = 0
    for p in parts:
        total = total * 60 + p
    return total


def _date(raw: str) -> datetime | None:
    try:
        return parsedate_to_datetime(raw).replace(tzinfo=None) if raw else None
    except (TypeError, ValueError):
        return None


def transcript_of(item: Any) -> Transcript | None:
    """The item's transcript with timings, the best kind first (JSON, then VTT, then SRT)."""
    found: list[Transcript] = []
    for t in item.findall(f"{{{_PODCAST_NS}}}transcript"):
        url = (t.get("url") or "").strip()
        kind = _KINDS.get((t.get("type") or "").split(";")[0].strip().lower())
        if kind is None:
            path = urlparse(url).path.lower()
            kind = next(
                (
                    k
                    for ext, k in ((".vtt", "vtt"), (".srt", "srt"), (".json", "json"))
                    if path.endswith(ext)
                ),
                None,
            )
        if url and kind:
            found.append(Transcript(url, kind))
    order = {"json": 0, "vtt": 1, "srt": 2}
    return min(found, key=lambda t: order[t.kind]) if found else None


def parse_feed(body: bytes, url: str) -> Feed:
    """A show's feed: its title, author, artwork and episodes, newest first."""
    try:
        root = ElementTree.fromstring(body)
    except (
        Exception
    ) as e:  # defusedxml raises its own kinds for a hostile feed, ParseError for a broken one
        raise PodcastRefused("That address doesn't give a podcast feed Franki can read.") from e
    channel = root.find("channel")
    if channel is None:
        raise PodcastRefused("That address doesn't give a podcast feed Franki can read.")
    image = channel.find(f"{{{_ITUNES_NS}}}image")
    artwork = (image.get("href") if image is not None else None) or _text(channel, "image/url")
    episodes: list[Episode] = []
    for item in channel.findall("item"):
        enclosure = item.find("enclosure")
        audio = (enclosure.get("url") or "").strip() if enclosure is not None else ""
        if not audio:
            continue
        guid = _text(item, "guid") or audio
        episodes.append(
            Episode(
                guid=guid,
                title=_text(item, "title") or "An episode",
                published=_date(_text(item, "pubDate")),
                seconds=_seconds(_text(item, f"{{{_ITUNES_NS}}}duration")),
                audio=audio,
                transcript=transcript_of(item),
            )
        )
    episodes.sort(key=lambda e: e.published or datetime.min, reverse=True)
    return Feed(
        url=url,
        title=_text(channel, "title") or "A podcast",
        author=_text(channel, f"{{{_ITUNES_NS}}}author"),
        artwork=artwork,
        episodes=tuple(episodes),
    )


def transcripts_share(feed: Feed, latest: int = 10) -> str:
    """How many of its latest episodes have a transcript: "most", "some" or "none"."""
    recent = feed.episodes[:latest]
    n = sum(1 for e in recent if e.transcript)
    return "none" if n == 0 else "most" if n * 2 >= len(recent) else "some"


def _ms(match: tuple[str | None, str, str, str]) -> int:
    hours, minutes, seconds, fraction = match
    return (int(hours or 0) * 3600 + int(minutes) * 60 + int(seconds)) * 1000 + int(
        fraction.ljust(3, "0")
    )


def parse_timed(text: str) -> list[Cue]:
    """A WebVTT or SRT transcript's cues, in order, without speaker tags or styling."""
    cues: list[Cue] = []
    for block in re.split(r"\r?\n\s*\r?\n", text.replace("﻿", "")):
        lines = [ln for ln in block.strip().splitlines() if ln.strip()]
        for i, line in enumerate(lines):
            m = _ARROW.search(line)
            if m:
                g = m.groups()
                start, end = _ms((g[1], g[2], g[3], g[4])), _ms((g[6], g[7], g[8], g[9]))
                words = clean_cue(_TAG.sub("", " ".join(lines[i + 1 :])))
                if words:
                    cues.append(Cue(start, max(end, start), words))
                break
    return sorted(cues, key=lambda c: c.start_ms)


def parse_json(raw: str) -> list[Cue]:
    """A podcast namespace JSON transcript's segments as cues."""
    try:
        body = json.loads(raw)
    except ValueError as e:
        raise PodcastRefused("This episode's transcript couldn't be read.") from e
    cues: list[Cue] = []
    for s in body.get("segments", []) if isinstance(body, dict) else []:
        if not isinstance(s, dict):
            continue
        try:
            start, end = float(s.get("startTime", 0)), float(s.get("endTime", 0))
        except (TypeError, ValueError):
            continue
        words = clean_cue(str(s.get("body", "")))
        if words:
            cues.append(Cue(round(start * 1000), round(max(end, start) * 1000), words))
    return sorted(cues, key=lambda c: c.start_ms)


async def _read(client: httpx.AsyncClient, url: str, user_agent: str, most: int) -> bytes:
    """`url`'s body, up to `most` bytes, following redirects only to public addresses."""
    target = public_url(url)
    for _ in range(5):
        async with client.stream(
            "GET", target, headers={"User-Agent": user_agent}, timeout=TIMEOUT
        ) as r:
            if r.is_redirect and "location" in r.headers:
                target = public_url(str(r.url.join(r.headers["location"])))
                continue
            if r.status_code != 200:
                raise PodcastRefused(
                    f"The podcast's site answered {r.status_code}. Try again later."
                )
            chunks: list[bytes] = []
            size = 0
            async for chunk in r.aiter_bytes():
                size += len(chunk)
                if size > most:
                    raise PodcastRefused("The podcast's feed or transcript is too large to read.")
                chunks.append(chunk)
            return b"".join(chunks)
    raise PodcastRefused("The podcast's address redirects too many times.")


class Podcasts:
    """Apple's directory, feeds and transcripts, with feeds kept `FEED_KEEP_SECONDS`."""

    def __init__(self, client: httpx.AsyncClient, user_agent: str) -> None:
        self.client = client
        self.user_agent = user_agent
        self._feeds: dict[str, tuple[float, Feed]] = {}

    async def _get(self, url: str, most: int) -> bytes:
        try:
            return await _read(self.client, url, self.user_agent, most)
        except httpx.HTTPError as e:
            raise PodcastRefused("Couldn't reach the podcast's site. Try again later.") from e

    async def _itunes(self, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        try:
            r = await self.client.get(
                f"https://itunes.apple.com/{path}",
                params=params,
                headers={"User-Agent": self.user_agent},
                timeout=TIMEOUT,
            )
        except httpx.HTTPError as e:
            raise PodcastRefused(
                "Couldn't reach Apple's podcast directory. Try again later."
            ) from e
        if r.status_code != 200:
            raise PodcastRefused("Apple's podcast directory didn't answer. Try again later.")
        results = r.json().get("results", [])
        return [x for x in results if isinstance(x, dict)]

    async def feed(self, url: str) -> Feed:
        now = time.monotonic()
        kept = self._feeds.get(url)
        if kept and now - kept[0] < FEED_KEEP_SECONDS:
            return kept[1]
        feed = parse_feed(await self._get(url, MAX_FEED_BYTES), url)
        for key in [k for k, (at, _) in self._feeds.items() if now - at >= FEED_KEEP_SECONDS]:
            del self._feeds[key]
        self._feeds[url] = (now, feed)
        return feed

    async def search(self, term: str, language: Code) -> list[Show]:
        """Shows matching `term` in Apple's directory, in the language's storefront, the first few
        saying whether their recent episodes have transcripts."""
        found = await self._itunes(
            "search",
            {
                "term": term,
                "media": "podcast",
                "entity": "podcast",
                "limit": str(SEARCH_RESULTS),
                "country": _COUNTRIES.get(language, "us"),
            },
        )
        shows = [
            Show(
                str(x.get("collectionName", "")),
                str(x.get("artistName", "")),
                str(x["feedUrl"]),
                str(x.get("artworkUrl600") or x.get("artworkUrl100") or ""),
            )
            for x in found
            if x.get("feedUrl")
        ]

        async def checked(show: Show) -> Show:
            try:
                return Show(
                    show.title,
                    show.author,
                    show.feed,
                    show.artwork,
                    transcripts_share(await self.feed(show.feed)),
                )
            except PodcastRefused:
                return show

        head = await asyncio.gather(*(checked(s) for s in shows[:CHECKED_RESULTS]))
        return [*head, *shows[CHECKED_RESULTS:]]

    async def from_link(self, link: str) -> tuple[Feed, str | None]:
        """The show a link is for, and the episode it names if it names one: an Apple Podcasts
        link, looked up in Apple's directory, or a feed's own address."""
        ids = apple_ids(link)
        if ids is None:
            return await self.feed(public_url(link)), None
        show_id, episode_id = ids
        found = await self._itunes(
            "lookup", {"id": show_id, "entity": "podcastEpisode", "limit": "200"}
        )
        feed_url = next((str(x["feedUrl"]) for x in found if x.get("feedUrl")), None)
        if feed_url is None:
            raise PodcastRefused("Apple's podcast directory doesn't list this show's feed.")
        feed = await self.feed(feed_url)
        if episode_id is None:
            return feed, None
        apple = next((x for x in found if str(x.get("trackId")) == episode_id), None)
        if apple is None:
            return feed, None
        guid = str(apple.get("episodeGuid") or "")
        audio = str(apple.get("episodeUrl") or "")
        match = next(
            (e for e in feed.episodes if e.guid == guid or (audio and e.audio == audio)), None
        )
        return feed, match.guid if match else None

    async def cues(self, transcript: Transcript) -> list[Cue]:
        raw = (await self._get(transcript.url, MAX_TRANSCRIPT_BYTES)).decode("utf-8", "replace")
        cues = parse_json(raw) if transcript.kind == "json" else parse_timed(raw)
        if not cues:
            raise PodcastRefused(
                "This episode's transcript has no lines with times, so it can't follow along."
            )
        return cues
