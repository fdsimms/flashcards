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

import json
import shutil
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from franki_speech import SpeechClient, SpeechError, WordMark

DEFAULT_VOICES = {"male": "th-TH-NiwatNeural", "female": "th-TH-PremwadeeNeural"}


@dataclass(frozen=True)
class Spoken:
    """One line's recording: its MP3, and when each word Azure spoke starts and ends in it (None
    when there are no timings)."""

    audio: bytes
    marks: list[WordMark] | None = None


# Speaks one line in one voice.
Synthesize = Callable[[str, str], Coroutine[Any, Any, Spoken]]


class Speech(Protocol):
    """What the app's voice routes need from Azure: `franki_speech.SpeechClient`, or a fake in tests."""

    async def voices(self) -> list[dict[str, Any]]: ...

    async def synthesize(self, text: str, voice: str, rate: float = 1.0) -> bytes: ...


class TtsFailed(Exception):
    """Azure didn't return audio. The text is still served, without audio for that line."""


def azure_synthesize(client: SpeechClient) -> Synthesize:
    async def synthesize(text: str, voice: str) -> Spoken:
        try:
            return Spoken(*await client.speak(text, voice))
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


def _write_whole(path: Path, data: bytes) -> None:
    partial = path.with_name(path.name + ".part")
    partial.write_bytes(data)
    partial.replace(path)
