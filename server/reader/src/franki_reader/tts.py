"""Text to speech: one MP3 per line, made once at normal speed and cached on the volume. Slower
playback is the player's rate on the phone (docs/read-and-listen/architecture.md, Audio), so there's one file per
line whatever speed is chosen.

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
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Protocol

from franki_speech import SpeechClient, SpeechError, WordMark

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


# Speaks one line in one voice: the text, the voice, and the text's locale (th-TH).
Synthesize = Callable[[str, str, str], Coroutine[Any, Any, Spoken]]


class Speech(Protocol):
    """What the app's voice routes need from Azure: `franki_speech.SpeechClient`, or a fake in tests."""

    async def voices(self) -> list[dict[str, Any]]: ...

    async def synthesize(
        self, text: str, voice: str, rate: float = 1.0, language: str | None = None
    ) -> bytes: ...


class TtsFailed(Exception):
    """Azure didn't return audio. The text is still served, without audio for that line."""


def azure_synthesize(client: SpeechClient) -> Synthesize:
    async def synthesize(text: str, voice: str, language: str) -> Spoken:
        try:
            return Spoken(*await client.speak(text, voice, language=language))
        except SpeechError as e:
            raise TtsFailed(str(e)) from e

    return synthesize


class AudioCache:
    """`<dir>/<text id>/<line index>.mp3`, and the line's word timings as `<line index>.json` when
    it has them. A file is written whole or not at all, and the timings before the audio, so a line
    with audio has its timings too."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def path(self, text_id: int, line: int) -> Path:
        return self.root / str(text_id) / f"{line}.mp3"

    def has(self, text_id: int, line: int) -> bool:
        return self.path(text_id, line).is_file()

    def drop(self, text_id: int) -> None:
        """Forgets a text's audio, so each line is spoken again (in the voices chosen now)."""
        shutil.rmtree(self.root / str(text_id), ignore_errors=True)

    def write(self, text_id: int, line: int, spoken: Spoken) -> None:
        path = self.path(text_id, line)
        path.parent.mkdir(parents=True, exist_ok=True)
        times = path.with_suffix(".json")
        if spoken.marks is None:
            times.unlink(missing_ok=True)
        else:
            marks = [[m.text, m.start, m.end] for m in spoken.marks]
            _write_whole(times, json.dumps(marks, ensure_ascii=False).encode())
        _write_whole(path, spoken.audio)

    def has_marks(self, text_id: int, line: int) -> bool:
        return self.path(text_id, line).with_suffix(".json").is_file()

    def marks(self, text_id: int, line: int) -> list[WordMark] | None:
        """The line's word timings, or None when it was recorded without them."""
        try:
            raw = json.loads(self.path(text_id, line).with_suffix(".json").read_text())
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
        cutoff = (now - self.KEEP).timestamp()
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
