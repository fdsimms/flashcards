"""
Azure's text to speech (the Speech service's REST API), shared by the MCP (server/mcp), which
records audio into notes, and Read & Listen (server/reader), which speaks each line of a text.
One client, so a fix to how Azure is called reaches both.

Open risk: the request shapes here (the region host, the SSML body, the output-format header,
the voices list) follow Azure's documented REST API as known when this was written. The host,
the `Ocp-Apim-Subscription-Key` header and the `audio-24khz-48kbitrate-mono-mp3` format name were
checked against Microsoft's own Speech SDK source; the `/cognitiveservices/v1` path, the
`X-Microsoft-OutputFormat` header and the voices list are unverified until the first call with a
live key. The endpoint is configurable (AZURE_SPEECH_ENDPOINT) in case a region or a custom domain
needs another host.

`speak` records through Azure's Speech SDK instead (sdk.py, the `timings` extra), for the word
timings the REST API doesn't return, and falls back to REST where the SDK can't be used.
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any
from xml.sax.saxutils import escape

import httpx

from franki_speech.sdk import SdkMissing, SdkResult, WordMark, speak_ssml

log = logging.getLogger(__name__)

OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3"
TIMEOUT_SECONDS = 30.0
# Azure answers 429 when requests come too fast (a burst of re-recorded lines, or tapping through
# voices). A request is retried this many times, after Retry-After seconds (capped) or a growing wait.
RATE_LIMIT_RETRIES = 3
MAX_RETRY_WAIT = 10.0
# The SDK's call has no deadline of its own that's certain to fire; one that never answers would
# hold the reader's topic lock and stop the shelf filling, so past this the line goes by REST.
SDK_TIMEOUT_SECONDS = 60.0
LOCALE = re.compile(r"^([a-z]{2,3}-[A-Z]{2})-")
# Thai has no commas or periods: a space after Thai text (or its ? or !) and before more Thai ends a
# clause or sentence. Each becomes an explicit pause, since a voice may run straight through a bare
# space. A space beside a Latin word ("OK ค่ะ") isn't a break and is left alone.
THAI_PAUSE = "<break time='200ms'/>"
_THAI_BREAK = re.compile(r"(?<=[\u0e00-\u0e7f?!])\s+(?=[\u0e00-\u0e7f])")

# Thai words Azure's voices misread, each with a respelling it reads correctly, spoken in the word's
# place with SSML's <sub alias>. Add a word here when a recording gets it wrong. The respellings are
# unverified against a live key: listen to the re-recorded line and adjust the alias if it's still off.
# Never put a space in an alias: in Thai the voice reads a space as the end of a clause and pauses
# (the "long gap" in มะ ม่วง). Split a word with a zero-width space, Thai's invisible word boundary.
THAI_PRONUNCIATIONS = {
    # Was read "ma mor" instead of "ma muang".
    "มะม่วง": "มะ\u200bม่วง",
}

__all__ = [
    "OUTPUT_FORMAT",
    "THAI_PAUSE",
    "THAI_PRONUNCIATIONS",
    "SpeechClient",
    "SpeechError",
    "WordMark",
    "locale_of",
    "ssml",
]


class SpeechError(Exception):
    """Azure refused or couldn't be reached; the message says which and why."""


@dataclass
class SpeechClient:
    key: str
    region: str
    endpoint: str | None = None
    http: httpx.AsyncClient = field(
        default_factory=lambda: httpx.AsyncClient(timeout=TIMEOUT_SECONDS)
    )
    # Names the calling service in Azure's logs.
    user_agent: str = "franki"
    # What a refused request (usually a wrong voice name) tells the caller to check.
    voice_help: str = "Check the voice name."
    # Waits between rate-limit retries; tests pass a no-op.
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep
    # Makes the Speech SDK's call (`sdk.speak_ssml`: key, region, SSML), off the event loop; tests
    # pass a fake.
    sdk_speak: Callable[[str, str, str], Awaitable[SdkResult]] | None = None
    sdk_timeout: float = SDK_TIMEOUT_SECONDS
    _voices: list[dict[str, Any]] | None = None

    @property
    def base(self) -> str:
        return (self.endpoint or f"https://{self.region}.tts.speech.microsoft.com").rstrip("/")

    def _headers(self, **extra: str) -> dict[str, str]:
        return {"Ocp-Apim-Subscription-Key": self.key, "User-Agent": self.user_agent, **extra}

    async def voices(self) -> list[dict[str, Any]]:
        """Every voice Azure offers in this region, read once."""
        if self._voices is None:
            r = await self._send("GET", "/cognitiveservices/voices/list", headers=self._headers())
            self._voices = [
                {
                    "voice": v.get("ShortName"),
                    "locale": v.get("Locale"),
                    "language": v.get("LocaleName"),
                    "gender": v.get("Gender"),
                    "name": v.get("DisplayName"),
                }
                for v in r.json()
            ]
        return self._voices

    async def synthesize(self, text: str, voice: str, rate: float = 1.0) -> bytes:
        """The text spoken in `voice` at `rate` (1.0 is normal speed), as MP3 bytes."""
        r = await self._send(
            "POST",
            "/cognitiveservices/v1",
            headers=self._headers(
                **{
                    "Content-Type": "application/ssml+xml",
                    "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
                }
            ),
            content=ssml(text, voice, rate).encode(),
        )
        if not r.content:
            raise SpeechError(f"Azure returned no audio for {voice}.")
        return r.content

    async def speak(
        self, text: str, voice: str, rate: float = 1.0
    ) -> tuple[bytes, list[WordMark] | None]:
        """The text spoken as `synthesize` speaks it, with when each word starts and ends, which
        only the Speech SDK gives. The words are None when they can't be had (a custom endpoint,
        which the SDK isn't set up for here; the SDK not loading; Azure unreachable over its
        connection): the audio then comes from the REST API, as `synthesize` makes it."""
        if self.endpoint is None:
            body = ssml(text, voice, rate)
            for attempt in range(RATE_LIMIT_RETRIES + 1):
                try:
                    r = await asyncio.wait_for(
                        (self.sdk_speak or _sdk_in_thread)(self.key, self.region, body),
                        self.sdk_timeout,
                    )
                except SdkMissing as e:
                    log.warning("Speech SDK unavailable, recording without word timings: %s", e)
                    break
                except TimeoutError:
                    log.warning("Speech SDK gave no answer in %ss, trying REST", self.sdk_timeout)
                    break
                if r.error is None:
                    if not r.audio:
                        raise SpeechError(f"Azure returned no audio for {voice}.")
                    return r.audio, r.marks
                if r.error == "TooManyRequests" and attempt < RATE_LIMIT_RETRIES:
                    await self.sleep(2.0 * (attempt + 1))
                    continue
                if r.error in _SDK_UNREACHABLE:
                    log.warning("Speech SDK couldn't reach Azure (%s), trying REST", r.error)
                    break
                raise self._refused(_SDK_STATUS.get(r.error), f"{r.error}: {r.details[:200]}")
        return await self.synthesize(text, voice, rate), None

    async def _send(self, method: str, path: str, **kw: Any) -> httpx.Response:
        for attempt in range(RATE_LIMIT_RETRIES + 1):
            try:
                r = await self.http.request(method, self.base + path, timeout=TIMEOUT_SECONDS, **kw)
            except httpx.HTTPError as e:
                raise SpeechError(f"Couldn't reach Azure Speech at {self.base}: {e}") from e
            if r.status_code != 429 or attempt == RATE_LIMIT_RETRIES:
                break
            await self.sleep(_retry_wait(r, attempt))
        if r.status_code >= 300:
            raise self._refused(r.status_code, f"{r.status_code}: {r.text[:200]}")
        return r

    def _refused(self, status: int | None, what: str) -> SpeechError:
        """Azure's refusal as the error to show, by HTTP status (the SDK's error codes are mapped
        to the same, `_SDK_STATUS`); `what` is the raw answer, for anything else."""
        if status in (401, 403):
            return SpeechError(
                "Azure Speech refused the key. Check AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in server/.env."
            )
        if status == 400:
            return SpeechError(f"Azure Speech refused the request. {self.voice_help}")
        if status == 429:
            return SpeechError("Azure Speech is limiting requests. Wait a minute and try again.")
        return SpeechError(f"Azure Speech answered {what}")


# The SDK's `CancellationErrorCode`s that mean what these HTTP statuses do.
_SDK_STATUS = {
    "AuthenticationFailure": 401,
    "Forbidden": 403,
    "BadRequest": 400,
    "TooManyRequests": 429,
}
# Ones where the REST API may still get through.
_SDK_UNREACHABLE = {"ConnectionFailure", "ServiceTimeout", "ServiceUnavailable"}


async def _sdk_in_thread(key: str, region: str, body: str) -> SdkResult:
    return await asyncio.to_thread(speak_ssml, key, region, body)


def _retry_wait(r: httpx.Response, attempt: int) -> float:
    try:
        asked = float(r.headers["Retry-After"])
    except (KeyError, ValueError):
        asked = 2.0 * (attempt + 1)
    return min(max(asked, 0.0), MAX_RETRY_WAIT)


def locale_of(voice: str) -> str:
    """A voice's language, from its name: "th-TH-PremwadeeNeural" speaks th-TH."""
    m = LOCALE.match(voice)
    if not m:
        raise SpeechError(f'"{voice}" isn\'t an Azure voice name (like "th-TH-PremwadeeNeural").')
    return m.group(1)


def ssml(text: str, voice: str, rate: float = 1.0) -> str:
    pct = round((rate - 1) * 100)
    locale = locale_of(voice)
    body = escape(text)
    if locale.startswith("th-"):
        body = _THAI_BREAK.sub(THAI_PAUSE, body)
        for word, alias in THAI_PRONUNCIATIONS.items():
            body = body.replace(word, f"<sub alias='{alias}'>{word}</sub>")
    return (
        f"<speak version='1.0' xml:lang='{locale}'><voice name='{escape(voice)}'>"
        f"<prosody rate='{pct:+d}%'>{body}</prosody></voice></speak>"
    )
