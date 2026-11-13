"""
Recorded audio for cards. Azure is called through the server's shared client (server/speech,
`franki_speech`, which Read & Listen uses too); what's here is only the MCP's own part.
"""

from __future__ import annotations

import hashlib

from franki_speech import SpeechClient, SpeechError, locale_of, ssml
from franki_speech.loudness import (
    TARGET_LUFS,
    TOLERANCE_LU,
    LoudnessError,
    measure_loudness,
    normalize_loudness,
)

__all__ = [
    "TARGET_LUFS",
    "TOLERANCE_LU",
    "LoudnessError",
    "SpeechClient",
    "SpeechError",
    "audio_filename",
    "leveled_filename",
    "locale_of",
    "measure_loudness",
    "normalize_loudness",
    "ssml",
]


def audio_filename(text: str, voice: str, rate: float) -> str:
    """The same text in the same voice and speed gets the same file, so asking again adds nothing."""
    digest = hashlib.sha1(f"{voice}\n{rate}\n{text}".encode()).hexdigest()[:16]
    return f"franki-tts-{digest}.mp3"


def leveled_filename(original: bytes) -> str:
    """The leveled copy of a clip is named from the clip's own bytes, so leveling it again adds nothing."""
    return f"franki-level-{hashlib.sha1(original).hexdigest()[:16]}.mp3"
