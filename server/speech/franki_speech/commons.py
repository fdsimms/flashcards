"""
Native speakers' recordings of a word, from Wikimedia Commons: Lingua Libre's first (newer, made one
word at a time, the speaker named in the file), then the older Wiktionary files named like
"De-Hund.ogg". Shared by Read & Listen (the app's Native recordings) and the MCP, so both find the
same recording and credit it the same way.

Every file is read with its own author and license from Commons (`extmetadata`), never assumed:
Lingua Libre's are CC BY-SA 4.0, but the older files are CC BY, older CC BY-SA versions or public
domain. A file under a license that doesn't allow keeping it in a deck with a credit (GFDL alone, or
none given) is left out. `Recording.credit` is the line a shared deck needs (CC BY-SA 4.0, section 3):
who, the license and its link, the file's page, and that it was changed (trimmed and leveled).

Commons limits how fast a client may ask, so every request goes through one client, at most one a
`MIN_INTERVAL`, and a 429 is waited out (its Retry-After honored) and tried again a few times.
"""

from __future__ import annotations

import asyncio
import re
import time
import urllib.parse
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from html import unescape
from typing import Any, Literal

import httpx

SPARQL = "https://lingualibre.org/bigdata/namespace/wdq/sparql"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
COMMONS_PAGE = "https://commons.wikimedia.org/wiki/"
DEFAULT_USER_AGENT = "franki-native-recordings/1.0"
MIN_INTERVAL = 1.0  # seconds between two requests
MAX_AUDIO_BYTES = 5 * 1024 * 1024
TIMEOUT_SECONDS = 30.0
RETRIES = 3

# Lingua Libre's item for each language (lingualibre.org, the language a record's P4 names).
LINGUA_LIBRE: dict[str, str] = {
    "fr": "Q21",
    "en": "Q22",
    "de": "Q24",
    "nb": "Q45",
    "ru": "Q129",
    "th": "Q136",
    "el": "Q205",
    "pl": "Q298",
    "es": "Q386",
    "ja": "Q389",
}
# The prefix of a language's older Wiktionary recordings on Commons ("Pl-kot.ogg").
OLDER_PREFIXES: dict[str, tuple[str, ...]] = {
    "fr": ("Fr",),
    "de": ("De",),
    "nb": ("No", "Nb"),
    "ru": ("Ru",),
    "th": ("Th",),
    "el": ("El",),
    "pl": ("Pl",),
    "es": ("Es",),
    "ja": ("Ja",),
}
# Licenses that allow keeping a copy in a deck, with a credit where they ask for one.
_FREE = re.compile(r"^(cc0|cc[ -]?zero|public domain|pd\b|cc by(-sa)?[ -]?\d)", re.IGNORECASE)
_TAGS = re.compile(r"<[^>]+>")
# Lingua Libre's test account ("LL-Q188 (deu)-teste (Pamputt)-Hund.wav"): not a native speaker.
_TEST_RECORDING = re.compile(r"^File:LL-Q\d+ \([a-z]{3}\)-teste\b", re.IGNORECASE)

Source = Literal["lingualibre", "wiktionary"]


class CommonsUnavailable(Exception):
    """Commons or Lingua Libre couldn't be reached, or kept refusing; the message says which."""


@dataclass(frozen=True)
class Recording:
    title: str  # "File:LL-Q188 (deu)-Natschi-Hund.wav"
    source: Source
    speaker: str
    license: str  # "CC BY-SA 4.0"
    license_url: str  # "" when Commons gives none (public domain)
    audio_url: str  # the original file

    @property
    def page_url(self) -> str:
        return COMMONS_PAGE + urllib.parse.quote(self.title.replace(" ", "_"), safe=":()_,-.")

    @property
    def credit(self) -> str:
        """The credit a shared deck needs: who, the license and its link, where the file is, and
        that it was changed. Plain text, no em dash, for the note's AudioCredit field."""
        where = "Lingua Libre" if self.source == "lingualibre" else "Wiktionary"
        parts = [f"{self.speaker} ({where})", self.license]
        if self.license_url:
            parts.append(self.license_url)
        parts += [self.page_url, "trimmed and loudness-evened"]
        return ", ".join(parts)


def spellings(word: str) -> list[str]:
    """The spellings a recording of `word` may be filed under: as given, lowercased, and with a
    capital first letter (German nouns), each once."""
    word = word.strip()
    out: list[str] = []
    for w in (word, word.lower(), word[:1].upper() + word[1:]):
        if w and w not in out:
            out.append(w)
    return out


def _quote_sparql(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _title_from_filepath(url: str) -> str:
    """ "http://commons.wikimedia.org/wiki/Special:FilePath/LL-Q809%20(pol)-X-kot.wav" ->
    "File:LL-Q809 (pol)-X-kot.wav"."""
    return "File:" + urllib.parse.unquote(url.rsplit("/", 1)[-1]).replace("_", " ")


def _plain(html: str) -> str:
    return re.sub(r"\s+", " ", unescape(_TAGS.sub("", html))).strip()


def _speaker(title: str, meta: dict[str, Any], source: Source) -> str:
    """The person to credit: Commons' Artist, else, for Lingua Libre, the name in the file's title."""
    artist = _plain(str((meta.get("Artist") or {}).get("value") or ""))
    # Lingua Libre's reads "Speaker: X Recorder: Y": the speaker is the one heard.
    named = re.match(r"Speaker:\s*(.+?)\s*(Recorder:.*)?$", artist)
    if named:
        artist = named.group(1)
    if artist:
        return artist[:120]
    if source == "lingualibre":
        m = re.match(r"File:LL-Q\d+ \([a-z]{3}\)-(.+?)-", title)
        if m:
            return m.group(1)
    return "speaker not named"


class Commons:
    """Asks Lingua Libre and Commons, one request at a time and no faster than `MIN_INTERVAL`."""

    def __init__(
        self,
        user_agent: str = DEFAULT_USER_AGENT,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._headers = {"User-Agent": user_agent}
        self._transport = transport
        self._clock = clock
        self._sleep = sleep
        self._lock = asyncio.Lock()
        self._last = -MIN_INTERVAL

    async def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        async with self._lock:
            for attempt in range(RETRIES + 1):
                wait = self._last + MIN_INTERVAL - self._clock()
                if wait > 0:
                    await self._sleep(wait)
                self._last = self._clock()
                try:
                    async with httpx.AsyncClient(
                        headers=self._headers,
                        timeout=TIMEOUT_SECONDS,
                        transport=self._transport,
                        follow_redirects=True,
                    ) as client:
                        response = await client.request(method, url, **kwargs)
                except httpx.HTTPError as e:
                    raise CommonsUnavailable(
                        f"Couldn't reach {urllib.parse.urlsplit(url).netloc}."
                    ) from e
                if response.status_code == 429:
                    if attempt == RETRIES:
                        break
                    after = response.headers.get("Retry-After", "")
                    await self._sleep(float(after) if after.isdigit() else 5.0 * (attempt + 1))
                    continue
                if response.status_code >= 400:
                    raise CommonsUnavailable(
                        f"{urllib.parse.urlsplit(url).netloc} answered {response.status_code}."
                    )
                return response
        raise CommonsUnavailable(
            f"{urllib.parse.urlsplit(url).netloc} kept refusing: too many requests. Try again later."
        )

    async def _lingua_libre_titles(self, language: str, word: str) -> list[str]:
        item = LINGUA_LIBRE.get(language)
        if item is None:
            return []
        values = " ".join(_quote_sparql(w) for w in spellings(word))
        query = (
            "SELECT ?file WHERE { ?r <https://lingualibre.org/prop/direct/P4> "
            f"<https://lingualibre.org/entity/{item}> ; "
            "<https://lingualibre.org/prop/direct/P7> ?t ; "
            "<https://lingualibre.org/prop/direct/P3> ?file . "
            f"VALUES ?t {{ {values} }} }}"
        )
        response = await self._request(
            "POST",
            SPARQL,
            data={"query": query},
            headers={"Accept": "application/sparql-results+json"},
        )
        rows = response.json().get("results", {}).get("bindings", [])
        titles = [_title_from_filepath(str(r["file"]["value"])) for r in rows if "file" in r]
        return list(dict.fromkeys(titles))

    async def find(self, language: str, word: str) -> list[Recording]:
        """Every usable recording of `word` in `language`: Lingua Libre's first, then the older
        Wiktionary files, each with its author and license as Commons has them."""
        ll = await self._lingua_libre_titles(language, word)
        older = [
            f"File:{prefix}-{w}.ogg"
            for prefix in OLDER_PREFIXES.get(language, ())
            for w in spellings(word)
        ]
        titles = list(dict.fromkeys(ll + older))[:50]
        if not titles:
            return []
        response = await self._request(
            "GET",
            COMMONS_API,
            params={
                "action": "query",
                "format": "json",
                "prop": "imageinfo",
                "iiprop": "url|extmetadata",
                "iiextmetadatafilter": "Artist|LicenseShortName|LicenseUrl",
                "titles": "|".join(titles),
            },
        )
        query = response.json().get("query", {})
        renamed = {n["from"]: n["to"] for n in query.get("normalized", [])}
        pages = {p.get("title"): p for p in query.get("pages", {}).values()}
        found: list[Recording] = []
        for title in titles:
            page = pages.get(renamed.get(title, title))
            if not page or "missing" in page or not page.get("imageinfo"):
                continue
            info = page["imageinfo"][0]
            meta = info.get("extmetadata") or {}
            license = _plain(str((meta.get("LicenseShortName") or {}).get("value") or ""))
            if not _FREE.match(license):
                continue
            source: Source = "lingualibre" if title in ll else "wiktionary"
            if _TEST_RECORDING.search(page["title"]):
                continue
            found.append(
                Recording(
                    title=page["title"],
                    source=source,
                    speaker=_speaker(page["title"], meta, source),
                    license=license,
                    license_url=_plain(str((meta.get("LicenseUrl") or {}).get("value") or "")),
                    audio_url=str(info.get("url") or ""),
                )
            )
        return [r for r in found if r.audio_url.startswith("https://upload.wikimedia.org/")]

    async def audio(self, recording: Recording) -> bytes:
        """The recording's original file, as Commons has it (at most `MAX_AUDIO_BYTES`)."""
        if not recording.audio_url.startswith("https://upload.wikimedia.org/"):
            raise CommonsUnavailable("That file isn't on Wikimedia's servers.")
        response = await self._request("GET", recording.audio_url)
        if len(response.content) > MAX_AUDIO_BYTES:
            raise CommonsUnavailable("That recording is too large to keep.")
        return response.content
