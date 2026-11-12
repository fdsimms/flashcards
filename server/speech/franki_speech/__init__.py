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
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any
from xml.sax.saxutils import escape

import httpx

OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3"
TIMEOUT_SECONDS = 30.0
LOCALE = re.compile(r"^([a-z]{2,3}-[A-Z]{2})-")
# Thai has no commas or periods: a space after Thai text (or its ? or !) and before more Thai ends a
# clause or sentence. Each becomes an explicit pause, since a voice may run straight through a bare
# space. A space beside a Latin word ("OK ค่ะ") isn't a break and is left alone.
THAI_PAUSE = "<break time='300ms'/>"
_THAI_BREAK = re.compile(r"(?<=[\u0e00-\u0e7f?!])\s+(?=[\u0e00-\u0e7f])")

__all__ = ["OUTPUT_FORMAT", "THAI_PAUSE", "SpeechClient", "SpeechError", "locale_of", "ssml"]


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

    async def _send(self, method: str, path: str, **kw: Any) -> httpx.Response:
        try:
            r = await self.http.request(method, self.base + path, timeout=TIMEOUT_SECONDS, **kw)
        except httpx.HTTPError as e:
            raise SpeechError(f"Couldn't reach Azure Speech at {self.base}: {e}") from e
        if r.status_code in (401, 403):
            raise SpeechError(
                "Azure Speech refused the key. Check AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in server/.env."
            )
        if r.status_code == 400:
            raise SpeechError(f"Azure Speech refused the request. {self.voice_help}")
        if r.status_code == 429:
            raise SpeechError("Azure Speech is limiting requests. Wait a minute and try again.")
        if r.status_code >= 300:
            raise SpeechError(f"Azure Speech answered {r.status_code}: {r.text[:200]}")
        return r


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
    return (
        f"<speak version='1.0' xml:lang='{locale}'><voice name='{escape(voice)}'>"
        f"<prosody rate='{pct:+d}%'>{body}</prosody></voice></speak>"
    )
