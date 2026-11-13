"""Text to speech: one MP3 per line, made once at normal speed and cached on the volume. Slower
playback is the player's rate on the phone (docs/read-and-listen/architecture.md, Audio), so there's one file per
line whatever speed is chosen.

Azure is called through the server's shared client (server/speech, `franki_speech`, which the MCP
uses too); its module docstring says which parts of Azure's API are confirmed. A speaker is read
in a voice for their gender (gender.py), chosen in the app (the `voices` setting);
AZURE_VOICE_MALE and AZURE_VOICE_FEMALE still set Thai's defaults.
"""

import shutil
from collections.abc import Callable, Coroutine
from pathlib import Path
from typing import Any, Protocol

from franki_speech import SpeechClient, SpeechError

DEFAULT_VOICES = {"male": "th-TH-NiwatNeural", "female": "th-TH-PremwadeeNeural"}

# Azure bills speech by the character. Standard neural voices (the defaults here) are listed at
# about $15 per million characters in the US; a "HD" voice chosen in the app costs more, so the
# estimate runs low for one. Open risk: the figure comes from third-party price lists, since
# Microsoft's own page wouldn't load for it. Check it against the Azure pricing calculator and
# change it here if it differs. A language with Chinese, Japanese or Korean text (billed as two
# characters each) would need a rule too, but none of the app's languages is one.
AZURE_USD_PER_MILLION_CHARS = 15.0


def azure_usd(characters: int) -> float:
    """What `characters` of speech cost Azure, as an estimate (`AZURE_USD_PER_MILLION_CHARS`)."""
    return characters * AZURE_USD_PER_MILLION_CHARS / 1_000_000


# Speaks one line in one voice and returns the MP3 bytes.
Synthesize = Callable[[str, str], Coroutine[Any, Any, bytes]]


class Speech(Protocol):
    """What the app's voice routes need from Azure: `franki_speech.SpeechClient`, or a fake in tests."""

    async def voices(self) -> list[dict[str, Any]]: ...

    async def synthesize(self, text: str, voice: str, rate: float = 1.0) -> bytes: ...


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

    def drop(self, text_id: int) -> None:
        """Forgets a text's audio, so each line is spoken again (in the voices chosen now)."""
        shutil.rmtree(self.root / str(text_id), ignore_errors=True)

    def write(self, text_id: int, line: int, audio: bytes) -> None:
        path = self.path(text_id, line)
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_suffix(".part")
        partial.write_bytes(audio)
        partial.replace(path)
