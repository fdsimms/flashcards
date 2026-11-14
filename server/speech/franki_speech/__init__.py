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

`assess` scores a recording's pronunciation against the text it should say, through the speech to
text REST API's short-audio endpoint with a `Pronunciation-Assessment` header. Open risk: its host
(`<region>.stt.speech.microsoft.com`), path, header (base64 JSON), WAV content type and the answer's
fields are written from Microsoft's documentation as remembered, not checked against a live key or
the docs (which weren't reachable when it was written); `_assessed` reads both shapes the scores are
known to come in.

`speak` records through Azure's Speech SDK instead (sdk.py, the `timings` extra), for the word
timings the REST API doesn't return, and falls back to REST where the SDK can't be used.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from collections.abc import Awaitable, Callable
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
LOCALE = re.compile(r"^([a-z]{2,3}-[A-Z]{2})-")
# A text's language as a locale: a language, an optional script and a region (th-TH, ja-JP, sr-Latn-RS).
_TEXT_LOCALE = re.compile(r"^([A-Za-z]{2,3})(?:-([A-Za-z]{4}))?-([A-Za-z]{2}|\d{3})$")
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
    "AssessedWord",
    "Assessment",
    "SpeechClient",
    "SpeechError",
    "WordMark",
    "is_multilingual",
    "locale_of",
    "ssml",
    "text_locale",
]


class SpeechError(Exception):
    """Azure refused or couldn't be reached; the message says which and why. `status` is the HTTP
    status of a refusal (an SDK error mapped to one), when there was one."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class AssessedWord:
    word: str
    accuracy: float
    # Azure's word error: None, Mispronunciation, Omission, Insertion and others.
    error: str
    syllables: tuple[tuple[str, float], ...] = ()


@dataclass(frozen=True)
class Assessment:
    """How a recording said its text: scores out of 100, and each word's."""

    accuracy: float
    fluency: float
    completeness: float
    words: tuple[AssessedWord, ...]
    heard: str  # what Azure heard


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
        self, text: str, voice: str, rate: float = 1.0, language: str | None = None
    ) -> bytes:
        """`_synthesize`, asked again without the language if Azure refuses the `<lang>` element
        (`_without_lang_on_refusal`)."""
        return await self._without_lang_on_refusal(
            text, voice, rate, language, lambda lang: self._synthesize(text, voice, rate, lang)
        )

    async def speak(
        self, text: str, voice: str, rate: float = 1.0, language: str | None = None
    ) -> tuple[bytes, list[WordMark] | None]:
        """`_speak`, asked again without the language if Azure refuses the `<lang>` element
        (`_without_lang_on_refusal`)."""
        return await self._without_lang_on_refusal(
            text, voice, rate, language, lambda lang: self._speak(text, voice, rate, lang)
        )

    async def _without_lang_on_refusal(
        self,
        text: str,
        voice: str,
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
            if e.status != 400 or ssml(text, voice, rate, language) == ssml(text, voice, rate):
                raise
            log.warning(
                "Azure refused <lang xml:lang='%s'> for %s; recording without it", language, voice
            )
            return await call(None)

    async def _synthesize(
        self, text: str, voice: str, rate: float = 1.0, language: str | None = None
    ) -> bytes:
        """The text spoken in `voice` at `rate` (1.0 is normal speed), as MP3 bytes. `language` is
        the text's locale (th-TH), when it's known: a Multilingual voice is told to read it in that
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
            content=ssml(text, voice, rate, language).encode(),
        )
        if not r.content:
            raise SpeechError(f"Azure returned no audio for {voice}.")
        return r.content

    async def _speak(
        self, text: str, voice: str, rate: float = 1.0, language: str | None = None
    ) -> tuple[bytes, list[WordMark] | None]:
        """The text spoken as `synthesize` speaks it, with when each word starts and ends, which
        only the Speech SDK gives. The words are None when they can't be had (a custom endpoint,
        which the SDK isn't set up for here; the SDK not loading; Azure unreachable over its
        connection): the audio then comes from the REST API, as `synthesize` makes it."""
        if self.endpoint is None:
            body = ssml(text, voice, rate, language)
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
        return await self._synthesize(text, voice, rate, language), None

    async def assess(self, wav: bytes, reference: str, locale: str) -> Assessment:
        """Scores a recording (16 kHz, 16-bit mono WAV) against `reference`, the text it should
        say, in `locale` (pl-PL). A language Azure doesn't assess is refused like any request (400)."""
        settings = {
            "ReferenceText": reference,
            "GradingSystem": "HundredMark",
            "Granularity": "Phoneme",
            "Dimension": "Comprehensive",
            "EnableMiscue": True,
        }
        header = base64.b64encode(json.dumps(settings, ensure_ascii=False).encode()).decode()
        url = (
            f"https://{self.region}.stt.speech.microsoft.com"
            "/speech/recognition/conversation/cognitiveservices/v1"
        )
        for attempt in range(RATE_LIMIT_RETRIES + 1):
            try:
                r = await self.http.post(
                    url,
                    params={"language": locale, "format": "detailed"},
                    headers=self._headers(
                        **{
                            "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
                            "Accept": "application/json",
                            "Pronunciation-Assessment": header,
                        }
                    ),
                    content=wav,
                    timeout=TIMEOUT_SECONDS,
                )
            except httpx.HTTPError as e:
                raise SpeechError(f"Couldn't reach Azure Speech: {e}") from e
            if r.status_code != 429 or attempt == RATE_LIMIT_RETRIES:
                break
            await self.sleep(_retry_wait(r, attempt))
        if r.status_code >= 300:
            if r.status_code == 400:
                raise SpeechError(f"Azure Speech didn't assess this ({locale}).", 400)
            raise self._refused(r.status_code, f"{r.status_code}: {r.text[:200]}")
        return _assessed(r.json())

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


def _score(item: dict[str, Any], name: str) -> float:
    """A score from Azure's answer, which has it on the item itself or in `PronunciationAssessment`."""
    nested = item.get("PronunciationAssessment")
    value = (nested if isinstance(nested, dict) else {}).get(name, item.get(name))
    return float(value) if isinstance(value, (int, float)) else 0.0


def _assessed(answer: Any) -> Assessment:
    """The pronunciation scores from Azure's detailed answer: the best result's, or a
    SpeechError when nothing was heard."""
    if not isinstance(answer, dict) or answer.get("RecognitionStatus") != "Success":
        status = answer.get("RecognitionStatus") if isinstance(answer, dict) else None
        raise SpeechError(f"Azure heard nothing to score ({status or 'no answer'}).")
    best = (answer.get("NBest") or [{}])[0]
    words = []
    for w in best.get("Words") or []:
        if not isinstance(w, dict) or not isinstance(w.get("Word"), str):
            continue
        nested = w.get("PronunciationAssessment")
        error = (nested if isinstance(nested, dict) else w).get("ErrorType") or "None"
        syllables = tuple(
            (str(s.get("Syllable", "")), _score(s, "AccuracyScore"))
            for s in w.get("Syllables") or []
            if isinstance(s, dict) and s.get("Syllable")
        )
        words.append(AssessedWord(w["Word"], _score(w, "AccuracyScore"), str(error), syllables))
    return Assessment(
        _score(best, "AccuracyScore"),
        _score(best, "FluencyScore"),
        _score(best, "CompletenessScore"),
        tuple(words),
        str(best.get("Display") or answer.get("DisplayText") or ""),
    )


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


def ssml(text: str, voice: str, rate: float = 1.0, language: str | None = None) -> str:
    """The SSML that speaks `text` in `voice` at `rate`. `language` is the text's locale, when it's
    known. A Multilingual voice reading another language than its own is told which, since left to
    itself it guesses from the text, and a short line, or Japanese in kanji alone (read as
    Chinese), can be guessed wrong. Any other voice reads its own language, and `language` changes
    nothing for it."""
    pct = round((rate - 1) * 100)
    locale = locale_of(voice)
    spoken_in = locale
    if language is not None and is_multilingual(voice):
        spoken_in = text_locale(language)
    body = escape(text)
    if spoken_in.split("-")[0] == "th":
        body = _THAI_BREAK.sub(THAI_PAUSE, body)
        for word, alias in THAI_PRONUNCIATIONS.items():
            body = body.replace(word, f"<sub alias='{alias}'>{word}</sub>")
    body = f"<prosody rate='{pct:+d}%'>{body}</prosody>"
    if spoken_in != locale:
        # Microsoft's "Voice and sound with SSML" page (speech-synthesis-markup-voice, "Adjust
        # speaking languages", the lang element), as it was described when this was written: a
        # Multilingual voice's text goes in <lang xml:lang='...'> directly inside <voice>, and
        # <speak>'s xml:lang stays the voice's own locale. The structure page lets <lang> hold
        # <prosody>, <break> and <sub>, so the rate and Thai's pauses go inside it. Unchecked
        # against a live key (learn.microsoft.com couldn't be fetched from where this was
        # written, so the form is from Microsoft's examples as known, not reread): if Azure
        # refuses it, or a voice still guesses the language, look here first. Other voices don't
        # take <lang> at all, by Microsoft's note, so theirs never gets one.
        body = f"<lang xml:lang='{spoken_in}'>{body}</lang>"
    return (
        f"<speak version='1.0' xml:lang='{locale}'><voice name='{escape(voice)}'>"
        f"{body}</voice></speak>"
    )
