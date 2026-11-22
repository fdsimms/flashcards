"""
Recordings fetched from a link for a card (add_audio_from_url): a real speaker's audio that a
dictionary publishes, for a language no Azure voice speaks or where a person's voice is wanted.

The MCP runs beside the sync server and Read & Listen, so the server must never be talked into
fetching from them, or from anything else on its own network: a link is fetched only over https,
from a host whose every address is public, checked again at each redirect, and only an answer that
says it's audio, up to MAX_BYTES. The address is checked before the request and the request then
resolves the name again, so a host that changes its answer in between (DNS rebinding) could still
reach a private address; the https requirement means it would also need a certificate for that
name, which is why that gap is left open rather than pinning the address.
"""

from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import os
import socket
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

import httpx

MAX_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 3
TIMEOUT_SECONDS = 20.0

# What an answer may say it is. application/octet-stream is what some hosts call any file; the
# leveling step (ffmpeg reading it) is what then shows it really is audio.
AUDIO_TYPES = ("audio/", "application/ogg", "application/octet-stream")

# The file's extension when it's kept as it came (a clip too short to level), by its type.
EXTENSIONS = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/ogg": "ogg",
    "application/ogg": "ogg",
    "audio/opus": "opus",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "aac",
    "audio/flac": "flac",
    "audio/webm": "webm",
}

Resolver = Callable[[str, int], Awaitable[list[str]]]


class DownloadError(Exception):
    """A link that couldn't be fetched, with why, written for the caller."""


async def resolve(host: str, port: int) -> list[str]:
    """Every address `host` resolves to."""
    infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return [str(info[4][0]) for info in infos]


@dataclass
class Download:
    data: bytes
    # The answer's type, without parameters ("audio/mpeg").
    kind: str
    # The link the file came from, after any redirects.
    url: str


@dataclass
class AudioFetcher:
    http: httpx.AsyncClient = field(
        default_factory=lambda: httpx.AsyncClient(timeout=TIMEOUT_SECONDS, follow_redirects=False)
    )
    # Looks a host's addresses up; tests pass a fake.
    resolve: Resolver = resolve

    async def fetch(self, url: str) -> Download:
        for _ in range(MAX_REDIRECTS + 1):
            target = await self._checked(url)
            try:
                async with self.http.stream("GET", target) as r:
                    if r.is_redirect:
                        location = r.headers.get("location")
                        if not location:
                            raise DownloadError("The link redirects without saying where to.")
                        url = str(target.join(location))
                        continue
                    if r.status_code != 200:
                        raise DownloadError(f"The link answered {r.status_code}, not the file.")
                    kind = r.headers.get("content-type", "").split(";")[0].strip().lower()
                    if not kind.startswith(AUDIO_TYPES):
                        raise DownloadError(f"The link isn't audio: it's {kind or 'of no stated type'}.")
                    declared = r.headers.get("content-length", "")
                    if declared.isdigit() and int(declared) > MAX_BYTES:
                        raise DownloadError(f"The file is over {MAX_BYTES // (1024 * 1024)} MB.")
                    data = bytearray()
                    async for chunk in r.aiter_bytes():
                        data += chunk
                        if len(data) > MAX_BYTES:
                            raise DownloadError(f"The file is over {MAX_BYTES // (1024 * 1024)} MB.")
                    if not data:
                        raise DownloadError("The link answered with an empty file.")
                    return Download(bytes(data), kind, str(target))
            except httpx.HTTPError as e:
                raise DownloadError(f"The link couldn't be fetched ({type(e).__name__}).") from e
        raise DownloadError(f"The link redirects more than {MAX_REDIRECTS} times.")

    async def _checked(self, url: str) -> httpx.URL:
        """The link, once it's https to a host whose every address is public."""
        try:
            target = httpx.URL(url)
        except httpx.InvalidURL as e:
            raise DownloadError("That isn't a link.") from e
        if target.scheme != "https":
            raise DownloadError("Only https links are fetched.")
        host = target.host
        if not host:
            raise DownloadError("The link has no host.")
        try:
            addresses = await self.resolve(host, target.port or 443)
        except OSError as e:
            raise DownloadError(f"{host} couldn't be found.") from e
        if not addresses:
            raise DownloadError(f"{host} couldn't be found.")
        for address in addresses:
            # A scoped IPv6 address ("fe80::1%eth0") names its interface after the %.
            if not ipaddress.ip_address(address.split("%")[0]).is_global:
                raise DownloadError(f"{host} is on a private network, so it isn't fetched.")
        return target


def linked_filename(original: bytes, kind: str, url: str, leveled: bool) -> str:
    """Named from the downloaded file's own bytes, so fetching the same recording again adds
    nothing. A leveled copy is always MP3; a clip kept as it came keeps its own extension, from its
    type or else its link."""
    digest = hashlib.sha1(original).hexdigest()[:16]
    if leveled:
        ext = "mp3"
    else:
        ext = EXTENSIONS.get(kind) or os.path.splitext(httpx.URL(url).path)[1].lstrip(".").lower() or "mp3"
        if not ext.isalnum() or len(ext) > 5:
            ext = "mp3"
    return f"franki-link-{digest}.{ext}"
