"""
Azure's text to speech (the Speech service's REST API), shared by the MCP (server/mcp), which
records audio into notes, and Read & Listen (server/reader), which speaks each line of a text.
One client, so a fix to how Azure is called reaches both.

Open risk: the request shapes here (the region host, the SSML body, the output-format header,
the voices list) follow Azure's documented REST API as known when this was written. The host,
the `Ocp-Apim-Subscription-Key` header and the `audio-24khz-48kbitrate-mono-mp3` format name were
checked against Microsoft's own Speech SDK source; the `/cognitiveservices/v1` path, the
`X-Microsoft-OutputFormat` header, the voices list and the <lang> element a Multilingual voice is
given (`ssml`) are unverified until the first call with a live key. The endpoint is configurable (AZURE_SPEECH_ENDPOINT) in case a region or a custom domain
needs another host.

`speak` (and `speak_parts`, a line spoken by several voices in turn) records through Azure's Speech SDK instead (sdk.py, the `timings` extra), for the word
timings the REST API doesn't return, and falls back to REST where the SDK can't be used.
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, TypeVar
from xml.sax.saxutils import escape

import httpx

from franki_speech.sdk import SdkMissing, SdkResult, WordMark, speak_ssml

log = logging.getLogger(__name__)
T = TypeVar("T")

OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3"
TIMEOUT_SECONDS = 30.0
# Azure answers 429 when requests come too fast (a burst of re-recorded lines, or tapping through
# voices). A request is retried this many times, after Retry-After seconds (capped) or a growing wait.
RATE_LIMIT_RETRIES = 3
MAX_RETRY_WAIT = 10.0
# The SDK's call has no deadline of its own that's certain to fire; one that never answers would
# hold the reader's topic lock and stop the shelf filling, so past this the line goes by REST.
SDK_TIMEOUT_SECONDS = 60.0
# Azure lists some voices with a lowercase locale (en-au-cyanspark:DragonHDOmniLatestNeural).
LOCALE = re.compile(r"^([a-z]{2,3})-([a-z]{2})-", re.IGNORECASE)
# A whole voice name: a locale, then the voice, with a colon in a Dragon HD one
# (en-US-Ada:DragonHDLatestNeural), and also a dot and hyphens in an MAI one (th-TH-Harper:MAI-Voice-2.1). The app's own check (`parseNarrator`, src/reader/lessons.ts) is
# tested against the same names (tests/voice-names.json beside this package).
_VOICE_NAME = re.compile(r"[a-z]{2,3}-[a-z]{2,4}-[a-z0-9:.-]+", re.IGNORECASE)
# A text's language as a locale: a language, an optional script and a region (th-TH, ja-JP, sr-Latn-RS).
_TEXT_LOCALE = re.compile(r"^([A-Za-z]{2,3})(?:-([A-Za-z]{4}))?-([A-Za-z]{2}|\d{3})$")
# Thai has no commas or periods: a space after Thai text (or its ? or !) and before more Thai ends a
# clause or sentence. Each becomes an explicit pause, since a voice may run straight through a bare
# space. Kept short: the voice's own pause at a space adds to it (200 ms made gaps too long). A space beside a Latin word ("OK ค่ะ") isn't a break and is left alone.
THAI_PAUSE = "<break time='60ms'/>"
_THAI_BREAK = re.compile(r"(?<=[\u0e00-\u0e7f?!])\s+(?=[\u0e00-\u0e7f])")
# A conjunction that opens a clause (\u0e41\u0e15\u0e48 but, \u0e41\u0e25\u0e30 and, \u0e2b\u0e23\u0e37\u0e2d or) is said straight on from the clause
# before it: a speaker barely stops there, and a break (even a short one) made the voice end the
# clause on a falling tone and sound halting. Its space is dropped, with no pause put in its place.
# Only after Thai text, so a conjunction that starts a new sentence ("\u0e44\u0e2b\u0e21? \u0e41\u0e15\u0e48") keeps its break. \u0e41\u0e15\u0e48\u0e25\u0e30
# (each) and \u0e41\u0e15\u0e48\u0e07- (dress, compose) are other words, not the conjunction.
_THAI_CONJUNCTION = re.compile(
    r"(?<=[\u0e00-\u0e7f])\s+(?=(?:\u0e41\u0e15\u0e48(?![\u0e25\u0e30\u0e07])|\u0e41\u0e25\u0e30|\u0e2b\u0e23\u0e37\u0e2d))"
)

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
    "Part",
    "SpeechClient",
    "SpeechError",
    "WordMark",
    "is_multilingual",
    "locale_of",
    "ssml",
    "ssml_parts",
    "text_locale",
]


class SpeechError(Exception):
    """Azure refused or couldn't be reached; the message says which and why. `status` is the HTTP
    status of a refusal (an SDK error mapped to one), when there was one."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


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

    async def synthesize(
        self,
        text: str,
        voice: str,
        rate: float = 1.0,
        language: str | None = None,
        reading: str | None = None,
    ) -> bytes:
        """`synthesize_parts` for a line in one voice. `reading` is said in the text's place, in
        Japanese only (`Part.reading`)."""
        return await self.synthesize_parts([Part(text, voice, reading=reading)], rate, language)

    async def speak(
        self, text: str, voice: str, rate: float = 1.0, language: str | None = None
    ) -> tuple[bytes, list[WordMark] | None]:
        """`speak_parts` for a line in one voice."""
        return await self.speak_parts([Part(text, voice)], rate, language)

    async def synthesize_parts(
        self, parts: Sequence[Part], rate: float = 1.0, language: str | None = None
    ) -> bytes:
        """`_synthesize`, asked again without the language if Azure refuses the `<lang>` element
        (`_without_lang_on_refusal`)."""
        return await self._without_lang_on_refusal(
            parts, rate, language, lambda lang: self._synthesize(parts, rate, lang)
        )

    async def speak_parts(
        self, parts: Sequence[Part], rate: float = 1.0, language: str | None = None
    ) -> tuple[bytes, list[WordMark] | None]:
        """`_speak`, asked again without the language if Azure refuses the `<lang>` element
        (`_without_lang_on_refusal`)."""
        return await self._without_lang_on_refusal(
            parts, rate, language, lambda lang: self._speak(parts, rate, lang)
        )

    async def _without_lang_on_refusal(
        self,
        parts: Sequence[Part],
        rate: float,
        language: str | None,
        call: Callable[[str | None], Awaitable[T]],
    ) -> T:
        """The `<lang>` element a Multilingual voice is given (`ssml`) is written from Microsoft's
        examples but unchecked against a live key. If Azure refuses a request that has one, the
        line is asked for again without it, as it was before, rather than not recorded at all."""
        try:
            return await call(language)
        except SpeechError as e:
            if e.status != 400 or ssml_parts(parts, rate, language) == ssml_parts(parts, rate):
                raise
            log.warning(
                "Azure refused <lang xml:lang='%s'> for %s; recording without it",
                language,
                parts[0].voice,
            )
            return await call(None)

    async def _synthesize(
        self, parts: Sequence[Part], rate: float = 1.0, language: str | None = None
    ) -> bytes:
        """The parts spoken at `rate` (1.0 is normal speed), as MP3 bytes. `language` is the
        text's locale (th-TH), when it's known: a Multilingual voice is told to read it in that
        language (`ssml`)."""
        r = await self._send(
            "POST",
            "/cognitiveservices/v1",
            headers=self._headers(
                **{
                    "Content-Type": "application/ssml+xml",
                    "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
                }
            ),
            content=ssml_parts(parts, rate, language).encode(),
        )
        if not r.content:
            raise SpeechError(f"Azure returned no audio for {parts[0].voice}.")
        return r.content

    async def _speak(
        self, parts: Sequence[Part], rate: float = 1.0, language: str | None = None
    ) -> tuple[bytes, list[WordMark] | None]:
        """The parts spoken as `synthesize_parts` speaks them, with when each word starts and ends,
        which only the Speech SDK gives. The words are None when they can't be had (a custom
        endpoint, which the SDK isn't set up for here; the SDK not loading; Azure unreachable over
        its connection): the audio then comes from the REST API, as `synthesize_parts` makes it."""
        if self.endpoint is None:
            body = ssml_parts(parts, rate, language)
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
                        raise SpeechError(f"Azure returned no audio for {parts[0].voice}.")
                    return r.audio, r.marks
                if r.error == "TooManyRequests" and attempt < RATE_LIMIT_RETRIES:
                    await self.sleep(2.0 * (attempt + 1))
                    continue
                if r.error in _SDK_UNREACHABLE:
                    log.warning("Speech SDK couldn't reach Azure (%s), trying REST", r.error)
                    break
                raise self._refused(_SDK_STATUS.get(r.error), f"{r.error}: {r.details[:200]}")
        return await self._synthesize(parts, rate, language), None

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
            return SpeechError(f"Azure Speech refused the request. {self.voice_help}", 400)
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


def is_voice_name(voice: str) -> bool:
    """Whether `voice` reads as an Azure voice name (th-TH-PremwadeeNeural), which is as far as a
    name can be checked without asking Azure: it refuses one it doesn't know."""
    return _VOICE_NAME.fullmatch(voice) is not None


def not_a_voice(voice: str) -> SpeechError:
    return SpeechError(
        f'"{voice}" isn\'t an Azure voice name (like "th-TH-PremwadeeNeural"). Choose a different voice.'
    )


def locale_of(voice: str) -> str:
    """A voice's language, from its name: "th-TH-PremwadeeNeural" speaks th-TH."""
    m = LOCALE.match(voice)
    if not m:
        raise not_a_voice(voice)
    return f"{m.group(1).lower()}-{m.group(2).upper()}"


def is_multilingual(voice: str) -> bool:
    """Azure's Multilingual voices read any language, though each is listed under one locale
    (en-US-AvaMultilingualNeural)."""
    return "Multilingual" in voice


def text_locale(language: str) -> str:
    """A text's language as the locale SSML names it ("th-th" is th-TH), or why it isn't one."""
    m = _TEXT_LOCALE.match(language.strip())
    if not m:
        raise SpeechError(f'"{language}" isn\'t a language and region (like "th-TH" or "ja-JP").')
    lang, script, region = m.groups()
    return "-".join([lang.lower(), *([script.title()] if script else []), region.upper()])


@dataclass(frozen=True)
class Part:
    """A stretch of a line spoken in one voice. `pitch` is a percent change to the voice's pitch
    (a child's voice is the same voice a little higher); 0 leaves it as it is. `reading` is what a
    Japanese voice says in the text's place, in kana (今日 meant as こんにち), with SSML's <sub
    alias>: Japanese's phonemes would need a pitch accent no reading carries. Ignored in any other
    language."""

    text: str
    voice: str
    pitch: int = 0
    reading: str | None = None


def ssml(text: str, voice: str, rate: float = 1.0, language: str | None = None) -> str:
    """The SSML that speaks `text` in `voice` at `rate`. `language` is the text's locale, when it's
    known. A Multilingual voice reading another language than its own is told which, since left to
    itself it guesses from the text, and a short line, or Japanese in kanji alone (read as
    Chinese), can be guessed wrong. Any other voice reads its own language, and `language` changes
    nothing for it."""
    return ssml_parts([Part(text, voice)], rate, language)


def ssml_parts(parts: Sequence[Part], rate: float = 1.0, language: str | None = None) -> str:
    """The SSML that speaks a line made of several parts, each in its own voice, one after another
    in a single request: one recording per line, with its words timed as a single voice's are.
    The document's language is the first voice's. A part with no text is left out."""
    spoken = [p for p in parts if p.text]
    if not spoken:
        raise SpeechError("There is no text to speak.")
    voices = "".join(_voice_element(p, rate, language) for p in spoken)
    return f"<speak version='1.0' xml:lang='{locale_of(spoken[0].voice)}'>{voices}</speak>"


def _voice_element(part: Part, rate: float, language: str | None) -> str:
    pct = round((rate - 1) * 100)
    voice = part.voice
    # Checked whole, not only its locale: the name goes in an attribute, and a ' in it would end it.
    if not is_voice_name(voice):
        raise not_a_voice(voice)
    locale = locale_of(voice)
    spoken_in = locale
    if language is not None and is_multilingual(voice):
        spoken_in = text_locale(language)
    body = escape(part.text)
    if part.reading and spoken_in.split("-")[0] == "ja":
        alias = escape(part.reading, {"'": "&apos;"})
        body = f"<sub alias='{alias}'>{body}</sub>"
    if spoken_in.split("-")[0] == "th":
        body = _THAI_CONJUNCTION.sub("", body)
        body = _THAI_BREAK.sub(THAI_PAUSE, body)
        for word, alias in THAI_PRONUNCIATIONS.items():
            body = body.replace(word, f"<sub alias='{alias}'>{word}</sub>")
    pitch = f" pitch='{part.pitch:+d}%'" if part.pitch else ""
    body = f"<prosody rate='{pct:+d}%'{pitch}>{body}</prosody>"
    if spoken_in != locale:
        # Microsoft's "Voice and sound with SSML" page (speech-synthesis-markup-voice, "Adjust
        # speaking languages", the lang element), as it was described when this was written: a
        # Multilingual voice's text goes in <lang xml:lang='...'> directly inside <voice>, and
        # <speak>'s xml:lang stays the voice's own locale. The structure page lets <lang> hold
        # <prosody>, <break> and <sub>, so the rate and Thai's pauses go inside it. Unchecked
        # against a live key (learn.microsoft.com couldn't be fetched from where this was
        # written, so the form is from Microsoft's examples as known, not reread): if Azure
        # refuses it, or a voice still guesses the language, look here first. Other voices don't
        # take <lang> at all, by Microsoft's note, so theirs never get one.
        body = f"<lang xml:lang='{spoken_in}'>{body}</lang>"
    return f"<voice name='{escape(voice)}'>{body}</voice>"
