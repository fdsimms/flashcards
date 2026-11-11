"""
Recorded audio for cards, from Azure's text-to-speech (the Speech service's REST API).

Open risk: the request shapes here (the region host, the SSML body, the output-format header,
the voices list) follow Azure's documented REST API as known when this was written; they
couldn't be checked against Azure's docs or a live key from where it was built. The endpoint is
configurable (AZURE_SPEECH_ENDPOINT) in case a region or a custom domain needs another host.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Any
from xml.sax.saxutils import escape

import httpx

OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3"
LOCALE = re.compile(r"^([a-z]{2,3}-[A-Z]{2})-")


class SpeechError(Exception):
    """Azure refused or couldn't be reached; the message says which and why."""


@dataclass
class SpeechClient:
    key: str
    region: str
    endpoint: str | None = None
    http: httpx.AsyncClient = field(default_factory=lambda: httpx.AsyncClient(timeout=30))
    _voices: list[dict[str, Any]] | None = None

    @property
    def base(self) -> str:
        return (self.endpoint or f"https://{self.region}.tts.speech.microsoft.com").rstrip("/")

    def _headers(self, **extra: str) -> dict[str, str]:
        return {"Ocp-Apim-Subscription-Key": self.key, "User-Agent": "franki-mcp", **extra}

    async def voices(self) -> list[dict[str, Any]]:
        if self._voices is None:
            r = await self._send("GET", "/cognitiveservices/voices/list", headers=self._headers())
            self._voices = [
                {"voice": v.get("ShortName"), "locale": v.get("Locale"), "language": v.get("LocaleName"),
                 "gender": v.get("Gender"), "name": v.get("DisplayName")}
                for v in r.json()
            ]
        return self._voices

    async def synthesize(self, text: str, voice: str, rate: float = 1.0) -> bytes:
        r = await self._send(
            "POST", "/cognitiveservices/v1",
            headers=self._headers(**{"Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": OUTPUT_FORMAT}),
            content=ssml(text, voice, rate).encode(),
        )
        if not r.content:
            raise SpeechError(f"Azure returned no audio for {voice}.")
        return r.content

    async def _send(self, method: str, path: str, **kw: Any) -> httpx.Response:
        try:
            r = await self.http.request(method, self.base + path, **kw)
        except httpx.HTTPError as e:
            raise SpeechError(f"Couldn't reach Azure Speech at {self.base}: {e}") from e
        if r.status_code in (401, 403):
            raise SpeechError("Azure Speech refused the key. Check AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in server/.env.")
        if r.status_code == 400:
            raise SpeechError("Azure Speech refused the request. Check the voice name with list_voices.")
        if r.status_code == 429:
            raise SpeechError("Azure Speech is limiting requests. Wait a minute and try again.")
        if r.status_code >= 300:
            raise SpeechError(f"Azure Speech answered {r.status_code}: {r.text[:200]}")
        return r


def locale_of(voice: str) -> str:
    """A voice's language, from its name: "th-TH-PremwadeeNeural" speaks th-TH."""
    m = LOCALE.match(voice)
    if not m:
        raise SpeechError(f'"{voice}" isn\'t an Azure voice name (like "th-TH-PremwadeeNeural"). list_voices names them.')
    return m.group(1)


def ssml(text: str, voice: str, rate: float = 1.0) -> str:
    pct = round((rate - 1) * 100)
    return (
        f"<speak version='1.0' xml:lang='{locale_of(voice)}'><voice name='{escape(voice)}'>"
        f"<prosody rate='{pct:+d}%'>{escape(text)}</prosody></voice></speak>"
    )


def audio_filename(text: str, voice: str, rate: float) -> str:
    """The same text in the same voice and speed gets the same file, so asking again adds nothing."""
    digest = hashlib.sha1(f"{voice}\n{rate}\n{text}".encode()).hexdigest()[:16]
    return f"franki-tts-{digest}.mp3"
