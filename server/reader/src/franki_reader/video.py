"""Videos (docs/read-and-listen/architecture.md, "Videos"): a YouTube video's subtitles in the
language, read as a text while the video plays. The app turns this on in Settings (off until then);
the server contacts YouTube only when the learner adds a video.

The subtitles come through youtube-transcript-api, which reads them the way YouTube's own page does:
an unofficial route that YouTube can change, so a failure says so plainly. Subtitles the channel
wrote are used first, YouTube's automatic ones only when there are none, and the text says which.
Each cue becomes a line with its times, except that cues too short to read alone (an automatic
subtitle's fragments) are joined until a line is long enough or a sentence ends. The title and the
channel come from YouTube's oEmbed. Nothing here grades a card or writes the collection.
"""

import asyncio
import html
import re
from collections.abc import Callable, Coroutine, Iterable
from dataclasses import dataclass
from typing import Any

import httpx

from franki_reader.languages import LANGUAGES, Code

# The longest video added at once, in seconds of subtitles: a long talk. Longer is refused.
MAX_SECONDS = 60 * 60
# A line shorter than this, not ending a sentence, takes the next cue too.
MIN_LINE_CHARS = 40
# Nor does a joined line grow past this.
MAX_LINE_CHARS = 140
# Thai and Japanese pack more into a character.
_MIN_LINE_CHARS = {"th": 18, "ja": 14}
_MAX_LINE_CHARS = {"th": 70, "ja": 60}

# A video's id from the links people share: watch?v=, youtu.be/, /shorts/, /embed/, /live/, and
# the mobile and music sites; or an id on its own.
_ID = r"([A-Za-z0-9_-]{11})"
_LINKS = (
    re.compile(rf"^(?:https?://)?(?:www\.|m\.|music\.)?youtube\.com/watch\?(?:[^#]*&)?v={_ID}"),
    re.compile(rf"^(?:https?://)?(?:www\.|m\.)?youtube\.com/(?:shorts|embed|live|v)/{_ID}"),
    re.compile(rf"^(?:https?://)?youtu\.be/{_ID}"),
    re.compile(rf"^{_ID}$"),
)
# Sound cues and speaker marks automatic and some written subtitles carry: [Music], (laughs), ♪, >>.
_NOISE = re.compile(r"\[[^\]]*\]|\([^)]*\)|[♪♫]+|^\s*>>\s*|\s>>\s")
_SENTENCE_END = re.compile(r"[.!?…。！？]['\"”’»)\]」』]*$")
# YouTube's codes for each language, the first the most usual. Norwegian is "no" as often as "nb".
_CODES: dict[Code, tuple[str, ...]] = {"nb": ("nb", "no", "nn")}


class VideoRefused(ValueError):
    """The video can't be added, and why, written for the learner."""


@dataclass(frozen=True)
class Cue:
    start_ms: int
    end_ms: int
    text: str


@dataclass(frozen=True)
class Captions:
    video_id: str
    title: str
    channel: str
    # YouTube's automatic subtitles rather than the channel's own.
    generated: bool
    cues: tuple[Cue, ...]

    @property
    def seconds(self) -> int:
        return round(self.cues[-1].end_ms / 1000) if self.cues else 0


FetchCaptions = Callable[[str, Code], Coroutine[Any, Any, Captions]]


def video_id(link: str) -> str | None:
    """The video's id from a link someone shared or pasted, or None when it isn't a YouTube video's."""
    text = link.strip()
    for pattern in _LINKS:
        found = pattern.search(text)
        if found:
            return found.group(1)
    return None


def codes_for(language: Code) -> tuple[str, ...]:
    return _CODES.get(language, (language,))


def matches(code: str, language: Code) -> bool:
    """Whether YouTube's language code is the language's (es-419 is Spanish, pt-BR isn't Polish)."""
    base = code.split("-")[0].lower()
    return base in codes_for(language)


def clean_cue(text: str) -> str:
    """A cue's words: entities read, sound cues and speaker marks gone, on one line."""
    plain = html.unescape(text).replace("\n", " ")
    return " ".join(_NOISE.sub(" ", plain).split())


def timed(starts: Iterable[tuple[float, float, str]]) -> list[Cue]:
    """Cues from (start, duration, text) in seconds, in order, without empty ones. A cue ends when
    the next begins if that's sooner: a duration is how long it stays on screen, and automatic
    subtitles overlap."""
    raw = sorted(((s, d, clean_cue(t)) for s, d, t in starts), key=lambda c: c[0])
    kept = [(s, d, t) for s, d, t in raw if t]
    cues: list[Cue] = []
    for i, (start, duration, text) in enumerate(kept):
        end = start + max(duration, 0.0)
        if i + 1 < len(kept):
            end = min(end, kept[i + 1][0]) if kept[i + 1][0] > start else end
        cues.append(Cue(round(start * 1000), round(max(end, start) * 1000), text))
    return cues


def lines_of(cues: Iterable[Cue], language: Code) -> list[Cue]:
    """The cues as lines to read: a cue too short to read alone, and not ending a sentence, is
    joined with the next, up to a longest line. Japanese and Thai are joined with no space."""
    shortest = _MIN_LINE_CHARS.get(language, MIN_LINE_CHARS)
    longest = _MAX_LINE_CHARS.get(language, MAX_LINE_CHARS)
    gap = "" if language == "ja" else " "
    lines: list[Cue] = []
    for cue in cues:
        last = lines[-1] if lines else None
        if (
            last is not None
            and len(last.text) < shortest
            and not _SENTENCE_END.search(last.text)
            and len(last.text) + len(cue.text) + len(gap) <= longest
        ):
            lines[-1] = Cue(
                last.start_ms, max(last.end_ms, cue.end_ms), f"{last.text}{gap}{cue.text}"
            )
        else:
            lines.append(cue)
    return lines


def checked(captions: Captions) -> Captions:
    """The captions as lines, or `VideoRefused` saying why the video can't be added."""
    if not captions.cues:
        raise VideoRefused("This video's subtitles have no words in them.")
    if captions.seconds > MAX_SECONDS:
        minutes = captions.seconds // 60
        raise VideoRefused(
            f"This video is {minutes} minutes long, and videos up to {MAX_SECONDS // 60} minutes"
            " can be added. Try a shorter one."
        )
    return captions


def youtube_captions(client: httpx.AsyncClient, user_agent: str) -> FetchCaptions:
    """Fetches a video's subtitles in the language from YouTube, and its title and channel."""

    async def fetch(video: str, language: Code) -> Captions:
        from youtube_transcript_api import YouTubeTranscriptApi
        from youtube_transcript_api._errors import (
            CouldNotRetrieveTranscript,
            IpBlocked,
            RequestBlocked,
            TranscriptsDisabled,
            VideoUnavailable,
        )

        name = LANGUAGES[language].name

        def read() -> tuple[bool, list[tuple[float, float, str]]]:
            listed = list(YouTubeTranscriptApi().list(video))
            own = [t for t in listed if matches(t.language_code, language)]
            chosen = sorted(own, key=lambda t: t.is_generated)
            if not chosen:
                raise VideoRefused(
                    f"This video has no {name} subtitles, so there's nothing to read along with."
                )
            fetched = chosen[0].fetch()
            return chosen[0].is_generated, [(s.start, s.duration, s.text) for s in fetched]

        try:
            generated, raw = await asyncio.to_thread(read)
        except VideoRefused:
            raise
        except (RequestBlocked, IpBlocked) as e:
            raise VideoRefused(
                "YouTube refused to give your server the subtitles. It sometimes blocks servers;"
                " try again later."
            ) from e
        except TranscriptsDisabled as e:
            raise VideoRefused("This video has subtitles turned off.") from e
        except VideoUnavailable as e:
            raise VideoRefused("YouTube says this video isn't available.") from e
        except CouldNotRetrieveTranscript as e:
            raise VideoRefused(
                "Couldn't get this video's subtitles from YouTube. Try again, or try another video."
            ) from e
        title, channel = "", ""
        try:
            got = await client.get(
                "https://www.youtube.com/oembed",
                params={"url": f"https://www.youtube.com/watch?v={video}", "format": "json"},
                headers={"User-Agent": user_agent},
                timeout=15,
            )
            if got.status_code == 200:
                body = got.json()
                title, channel = str(body.get("title", "")), str(body.get("author_name", ""))
        except (httpx.HTTPError, ValueError):
            pass  # the title is a nicety: the subtitles are what's needed
        return Captions(
            video, title.strip() or "A video", channel.strip(), generated, tuple(timed(raw))
        )

    return fetch
