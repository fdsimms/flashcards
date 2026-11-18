"""Text to speech: one MP3 per line at normal speed, cached on the volume, and a second, slow one
(`SLOW_RATE`) made the first time a line is played slowly. Azure speaks the slow one, since a
recording stretched by the player sounds robotic (docs/read-and-listen/architecture.md, Audio).

Azure is called through the server's shared client (server/speech, `franki_speech`, which the MCP
uses too); its module docstring says which parts of Azure's API are confirmed. A speaker is read
in a voice for their gender (gender.py), chosen in the app (the `voices` setting);
AZURE_VOICE_MALE and AZURE_VOICE_FEMALE still set Thai's defaults.

Each line is recorded with when its words are spoken (`SpeechClient.speak`, through Azure's Speech
SDK), kept beside its MP3 as `<line>.json`, so the reader can light up each word as it's spoken
(timing.py matches Azure's words to the line's). A line recorded before that, or where the SDK
couldn't be used, has no timings and plays without them.
"""

import hashlib
import json
import re
import shutil
from collections.abc import Callable, Coroutine, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Protocol

from franki_speech import Part, SpeechClient, SpeechError, WordMark
from franki_speech.loudness import LoudnessError, trim_trailing_silence

# How fast Azure speaks the slow recording (1.0 is normal speed): SSML's prosody rate of -35%.
SLOW_RATE = 0.65

DEFAULT_VOICES = {"male": "th-TH-NiwatNeural", "female": "th-TH-PremwadeeNeural"}

# Azure bills speech by the character. Standard neural voices (the defaults here) are listed at
# about $15 per million characters in the US; a "HD" voice chosen in the app costs more, so the
# estimate runs low for one. Open risk: the figure comes from third-party price lists, since
# Microsoft's own page wouldn't load for it. Check it against the Azure pricing calculator and
# change it here if it differs. Chinese, Japanese and Korean characters are billed as two each
# (`billed_chars`).
AZURE_USD_PER_MILLION_CHARS = 15.0

# Kana, kanji and hangul, which Azure bills as two characters each.
_DOUBLE = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff々〆ー]")


def billed_chars(text: str) -> int:
    """How many characters Azure bills for speaking `text`."""
    return len(text) + len(_DOUBLE.findall(text))


def azure_usd(characters: int) -> float:
    """What `characters` of speech cost Azure, as an estimate (`AZURE_USD_PER_MILLION_CHARS`)."""
    return characters * AZURE_USD_PER_MILLION_CHARS / 1_000_000


@dataclass(frozen=True)
class Spoken:
    """One line's recording: its MP3, and when each word Azure spoke starts and ends in it (None
    when there are no timings)."""

    audio: bytes
    marks: list[WordMark] | None = None


# Speaks one line in one voice: the text, the voice, and the text's locale (th-TH). A caller that
# wants the slow recording passes `rate=SLOW_RATE` too, so the normal one is asked for as it always was.
Synthesize = Callable[..., Coroutine[Any, Any, Spoken]]


# Speaks one line in several voices, one after another (a story's quotations, cast.py): the parts
# and the text's locale, and `rate=SLOW_RATE` for the slow recording, as for `Synthesize`.
SynthesizeParts = Callable[..., Coroutine[Any, Any, Spoken]]


class Speech(Protocol):
    """What the app's voice routes need from Azure: `franki_speech.SpeechClient`, or a fake in tests."""

    async def voices(self) -> list[dict[str, Any]]: ...

    async def synthesize(
        self,
        text: str,
        voice: str,
        rate: float = 1.0,
        language: str | None = None,
        reading: str | None = None,
    ) -> bytes: ...


class TtsFailed(Exception):
    """Azure didn't return audio. The text is still served, without audio for that line."""


async def trimmed(spoken: Spoken) -> Spoken:
    """The line with the silence Azure leaves at its end cut short, so lines don't play with a long
    gap between them. Left as it was if ffmpeg can't do it (it still plays). Word times are starts
    measured from the beginning, so cutting the end leaves them right."""
    try:
        return Spoken(await trim_trailing_silence(spoken.audio), spoken.marks)
    except LoudnessError:
        return spoken


def azure_synthesize(client: SpeechClient) -> Synthesize:
    async def synthesize(text: str, voice: str, language: str, rate: float = 1.0) -> Spoken:
        try:
            return await trimmed(Spoken(*await client.speak(text, voice, rate, language=language)))
        except SpeechError as e:
            raise TtsFailed(str(e)) from e

    return synthesize


def azure_synthesize_parts(client: SpeechClient) -> SynthesizeParts:
    async def synthesize_parts(parts: Sequence[Part], language: str, rate: float = 1.0) -> Spoken:
        try:
            return await trimmed(Spoken(*await client.speak_parts(parts, rate, language=language)))
        except SpeechError as e:
            raise TtsFailed(str(e)) from e

    return synthesize_parts


class AudioCache:
    """`<dir>/<text id>/<line index>.mp3`, and the line's word timings as `<line index>.json` when
    it has them. The slow recording is `<line index>.slow.mp3` with `<line index>.slow.json`. A file
    is written whole or not at all, and the timings before the audio, so a line with audio has its
    timings too."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def path(self, text_id: int, line: int, slow: bool = False) -> Path:
        return self.root / str(text_id) / f"{line}{'.slow' if slow else ''}.mp3"

    def has(self, text_id: int, line: int, slow: bool = False) -> bool:
        return self.path(text_id, line, slow).is_file()

    def drop(self, text_id: int) -> None:
        """Forgets a text's audio, slow recordings too, so each line is spoken again (in the voices chosen now)."""
        shutil.rmtree(self.root / str(text_id), ignore_errors=True)

    def write(self, text_id: int, line: int, spoken: Spoken, slow: bool = False) -> None:
        path = self.path(text_id, line, slow)
        path.parent.mkdir(parents=True, exist_ok=True)
        times = path.with_suffix(".json")
        if spoken.marks is None:
            times.unlink(missing_ok=True)
        else:
            marks = [[m.text, m.start, m.end] for m in spoken.marks]
            _write_whole(times, json.dumps(marks, ensure_ascii=False).encode())
        _write_whole(path, spoken.audio)

    def has_marks(self, text_id: int, line: int, slow: bool = False) -> bool:
        return self.path(text_id, line, slow).with_suffix(".json").is_file()

    def marks(self, text_id: int, line: int, slow: bool = False) -> list[WordMark] | None:
        """The line's word timings, or None when it was recorded without them."""
        try:
            raw = json.loads(self.path(text_id, line, slow).with_suffix(".json").read_text())
            return [WordMark(str(t), int(s), int(e)) for t, s, e in raw]
        except (OSError, ValueError, TypeError):
            return None


class ClipCache:
    """Lines spoken outside a text (Situations): `<dir>/<key>.mp3`, the key a hash of the voice and
    the words, so the same line in the same voice is spoken once. Clips older than `KEEP` are
    dropped whenever one is written, since a conversation isn't kept."""

    KEEP = timedelta(days=2)

    def __init__(self, root: Path) -> None:
        self.root = root

    @staticmethod
    def key(text: str, voice: str) -> str:
        return hashlib.sha256(f"{voice}\n{text}".encode()).hexdigest()[:32]

    def path(self, key: str) -> Path | None:
        """The clip's file, or None for a key that isn't one of ours or a clip that isn't there."""
        if not re.fullmatch(r"[0-9a-f]{32}", key):
            return None
        path = self.root / f"{key}.mp3"
        return path if path.is_file() else None

    def write(self, key: str, audio: bytes, now: datetime) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        # The engine's clock is naive UTC; `.timestamp()` on a naive datetime would read it as local time.
        aware = now if now.tzinfo else now.replace(tzinfo=UTC)
        cutoff = (aware - self.KEEP).timestamp()
        for old in self.root.glob("*.mp3"):
            try:
                if old.stat().st_mtime < cutoff:
                    old.unlink()
            except OSError:
                pass
        _write_whole(self.root / f"{key}.mp3", audio)


def _write_whole(path: Path, data: bytes) -> None:
    partial = path.with_name(path.name + ".part")
    partial.write_bytes(data)
    partial.replace(path)
