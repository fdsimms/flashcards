"""Azure's fast transcription (speech to text): a recording's words with their times, for a podcast
episode that publishes no transcript of its own (server/reader podcast.py).

Azure fetches the audio itself from `audioUrl`, so nothing is downloaded here. Open risk: the request
shape (the region host, the api-version, the multipart `definition` with `audioUrl` and `locales`,
and the response's `phrases` with `offsetMilliseconds` and `durationMilliseconds`) is taken from
Microsoft's fast transcription page and unverified until the first call with a live key.
`USD_PER_HOUR` is an estimate for the screen, not read from a bill.
"""

import json
from dataclasses import dataclass
from typing import Any

import httpx

API_VERSION = "2025-10-15"
# What an hour of audio costs to transcribe, as an estimate (Azure's pricing page didn't show it).
USD_PER_HOUR = 1.0
# Azure's own limits: under five hours and 500 MB; a long episode takes a while.
TIMEOUT_SECONDS = 600.0


class TranscribeFailed(Exception):
    """Azure couldn't transcribe the recording, said for the learner."""


@dataclass(frozen=True)
class Phrase:
    start_ms: int
    end_ms: int
    text: str


@dataclass(frozen=True)
class Transcription:
    duration_ms: int
    phrases: tuple[Phrase, ...]


def cost_usd(seconds: float) -> float:
    """About what transcribing `seconds` of audio costs, rounded to the cent."""
    return round(max(0.0, seconds) / 3600 * USD_PER_HOUR, 2)


def parse(body: Any) -> Transcription:
    """Azure's answer: each phrase's text and its start and end, in order."""
    if not isinstance(body, dict):
        raise TranscribeFailed("Azure's transcription came back in a form Franki can't read.")
    phrases: list[Phrase] = []
    for p in body.get("phrases", []) or []:
        if not isinstance(p, dict):
            continue
        text = " ".join(str(p.get("text", "")).split())
        try:
            start = int(p.get("offsetMilliseconds", 0))
            length = int(p.get("durationMilliseconds", 0))
        except (TypeError, ValueError):
            continue
        if text:
            phrases.append(Phrase(start, start + max(0, length), text))
    phrases.sort(key=lambda p: p.start_ms)
    try:
        duration = int(body.get("durationMilliseconds") or (phrases[-1].end_ms if phrases else 0))
    except (TypeError, ValueError):
        duration = phrases[-1].end_ms if phrases else 0
    return Transcription(duration, tuple(phrases))


async def transcribe(
    http: httpx.AsyncClient,
    key: str,
    region: str,
    audio_url: str,
    locale: str,
    user_agent: str = "franki",
) -> Transcription:
    """The recording at `audio_url` transcribed in `locale` (pl-PL)."""
    url = (
        f"https://{region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe"
        f"?api-version={API_VERSION}"
    )
    definition = {"audioUrl": audio_url, "locales": [locale], "profanityFilterMode": "None"}
    try:
        r = await http.post(
            url,
            headers={"Ocp-Apim-Subscription-Key": key, "User-Agent": user_agent},
            files={"definition": (None, json.dumps(definition), "application/json")},
            timeout=TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as e:
        raise TranscribeFailed(
            "Couldn't reach Azure to transcribe the episode. Try again later."
        ) from e
    if r.status_code == 429:
        raise TranscribeFailed("Azure is busy transcribing. Try again in a minute.")
    if r.status_code in (401, 403):
        raise TranscribeFailed(
            "Azure refused the key. Check AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in server/.env."
        )
    if r.status_code != 200:
        reason = ""
        try:
            reason = str(r.json().get("message", "")).strip()
        except ValueError:
            pass
        raise TranscribeFailed(
            f"Azure couldn't transcribe the episode ({r.status_code}{': ' + reason if reason else ''})."
        )
    found = parse(r.json())
    if not found.phrases:
        raise TranscribeFailed("Azure heard no words in this episode in that language.")
    return found
