"""
Recorded audio for cards. Azure is called through the server's shared client (server/speech,
`franki_speech`, which Read & Listen uses too); what's here is only the MCP's own part.
"""

from __future__ import annotations

import hashlib

from franki_speech import SpeechClient, SpeechError, locale_of, ssml

__all__ = ["SpeechClient", "SpeechError", "audio_filename", "locale_of", "ssml"]


def audio_filename(text: str, voice: str, rate: float) -> str:
    """The same text in the same voice and speed gets the same file, so asking again adds nothing."""
    digest = hashlib.sha1(f"{voice}\n{rate}\n{text}".encode()).hexdigest()[:16]
    return f"franki-tts-{digest}.mp3"
