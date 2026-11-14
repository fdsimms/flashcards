"""Score it (docs/read-and-listen/architecture.md, Speaking): a take the owner recorded of themselves
(Record yourself), scored against the text it should say by Azure's pronunciation assessment, through
the shared client (`franki_speech.SpeechClient.assess`). Only on the owner's tap, and only while
Answer by speaking is on in the app. The take isn't kept: it's sent to Azure and forgotten.

Nothing here grades a card. What Azure says is turned into what the app draws: three scores, each
word's score and error, its weakest syllable, and a band per word (good, close, again) that the app
colors.
"""

import base64
import binascii
from collections.abc import Awaitable, Callable
from typing import Any

from franki_speech import Assessment

# A take is at most a minute (the app stops one at 60 seconds), 16 kHz 16-bit mono: under 2 MB.
MAX_WAV_BYTES = 2_100_000
WAV_BYTES_PER_SECOND = 16_000 * 2
# Azure's speech to text, which pronunciation assessment is billed as, at about $1 an hour for the
# standard tier. Open risk: from memory, not Microsoft's page (which wasn't reachable when this was
# written); assessment may cost more. Check the Azure pricing calculator and change it here.
AZURE_STT_USD_PER_HOUR = 1.0
GOOD, CLOSE = 80.0, 60.0  # a word at or over GOOD is said well; over CLOSE, nearly

Assess = Callable[[bytes, str, str], Awaitable[Assessment]]


class TakeRefused(Exception):
    """Written to be shown as it is."""


def wav_of(encoded: str) -> bytes:
    """The take's WAV bytes from its base64, refused when it isn't one or is too long."""
    try:
        wav = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as e:
        raise TakeRefused("The recording couldn't be read. Record it again.") from e
    if wav[:4] != b"RIFF" or wav[8:12] != b"WAVE":
        raise TakeRefused("The recording isn't in a format Azure scores. Record it again.")
    if len(wav) > MAX_WAV_BYTES:
        raise TakeRefused("The recording is too long to score. Keep it under a minute.")
    return wav


def seconds_of(wav: bytes) -> float:
    return max(0, len(wav) - 44) / WAV_BYTES_PER_SECOND


def azure_stt_usd(seconds: float) -> float:
    return seconds * AZURE_STT_USD_PER_HOUR / 3600


def band(score: float) -> str:
    return "good" if score >= GOOD else "close" if score >= CLOSE else "again"


def result(a: Assessment) -> dict[str, Any]:
    """The assessment as the app draws it. A word Azure says was left out or added keeps its
    error ("Omission", "Insertion") and is marked "again" whatever its score."""
    words: list[dict[str, Any]] = []
    for w in a.words:
        weakest = min(w.syllables, key=lambda s: s[1]) if w.syllables else None
        error = w.error if w.error not in ("None", "") else None
        words.append(
            {
                "word": w.word,
                "accuracy": round(w.accuracy),
                "band": "again" if error in ("Omission", "Insertion") else band(w.accuracy),
                "error": error,
                "syllables": [{"text": t, "accuracy": round(s)} for t, s in w.syllables],
                "weakest": {"text": weakest[0], "accuracy": round(weakest[1])}
                if weakest and len(w.syllables) > 1
                else None,
            }
        )
    return {
        "accuracy": round(a.accuracy),
        "fluency": round(a.fluency),
        "completeness": round(a.completeness),
        "heard": a.heard,
        "words": words,
    }
