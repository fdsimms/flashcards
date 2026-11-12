"""Text to speech: one MP3 per line, made once at normal speed and cached on the volume. Slower
playback is the player's rate on the phone (docs/read-and-listen/architecture.md, Audio), so there's one file per
line whatever speed is chosen.

Azure is called through the server's shared client (server/speech, `franki_speech`, which the MCP
uses too); its module docstring says which parts of Azure's API are confirmed. The voices can be
changed with AZURE_VOICE_A and AZURE_VOICE_B without a code change.
"""

from collections.abc import Callable, Coroutine
from pathlib import Path
from typing import Any

from franki_speech import SpeechClient, SpeechError

DEFAULT_VOICES = {"A": "th-TH-NiwatNeural", "B": "th-TH-PremwadeeNeural"}

# Speaks one line in one voice and returns the MP3 bytes.
Synthesize = Callable[[str, str], Coroutine[Any, Any, bytes]]


class TtsFailed(Exception):
    """Azure didn't return audio. The text is still served, without audio for that line."""


def azure_synthesize(client: SpeechClient) -> Synthesize:
    async def synthesize(text: str, voice: str) -> bytes:
        try:
            return await client.synthesize(text, voice)
        except SpeechError as e:
            raise TtsFailed(str(e)) from e

    return synthesize


class AudioCache:
    """`<dir>/<text id>/<line index>.mp3`. A file is written whole or not at all."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def path(self, text_id: int, line: int) -> Path:
        return self.root / str(text_id) / f"{line}.mp3"

    def has(self, text_id: int, line: int) -> bool:
        return self.path(text_id, line).is_file()

    def write(self, text_id: int, line: int, audio: bytes) -> None:
        path = self.path(text_id, line)
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_suffix(".part")
        partial.write_bytes(audio)
        partial.replace(path)
