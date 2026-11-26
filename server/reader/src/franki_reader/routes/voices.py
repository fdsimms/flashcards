"""Azure's voices, a card recorded with one (/api/speech), the readings a Japanese card is recorded
from (/api/readings), and hearing a story's cast."""

from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Response
from franki_speech import Part, SpeechError, is_multilingual, locale_of, text_locale
from pydantic import BaseModel, Field

from franki_reader import (
    cast,
    cast_samples,
    japanese,
    store,
)
from franki_reader.languages import (
    LANGUAGES,
    Code,
    Gender,
    speech_locale,
)
from franki_reader.routes.context import AppContext
from franki_reader.routes.voice_check import check_voice
from franki_reader.tts import (
    Speech,
    TtsFailed,
    billed_chars,
)

# The longest text /api/speech speaks: a card's word or sentence, never a whole text.
MAX_SPEECH_CHARS = 500
# The most words /api/readings answers at once: the MCP records up to 10 notes a call.
MAX_READINGS = 50


class CastSampleIn(BaseModel):
    language: Code
    voice: str = Field(min_length=1, max_length=100)
    pitch: int = Field(default=0, ge=cast.PITCH_RANGE[0], le=cast.PITCH_RANGE[1])
    gender: Gender = "female"


class CastSceneIn(BaseModel):
    language: Code


class SpeechIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_SPEECH_CHARS)
    voice: str = Field(min_length=1, max_length=100)
    rate: float = Field(default=1.0, ge=0.5, le=2.0)
    # The text's language (th-TH, or a code here: th), for a Multilingual voice to read it in. An
    # app from before it was sent leaves it out, and the voice guesses from the text as before.
    language: str | None = Field(default=None, min_length=2, max_length=20)
    # A Japanese word's KanaReading, said in its place where Sudachi reads the word otherwise
    # (japanese.spoken_reading). An app from before it was sent leaves it out.
    reading: str | None = Field(default=None, max_length=200)
    # The word as IPA, said in the text's place (SSML's <phoneme>): for a word whose spelling
    # doesn't say how it's said, such as a Russian word told from another only by its stress
    # (за́мок, замо́к; Practice's Hearing sounds). An app from before it was sent leaves it out.
    ipa: str | None = Field(default=None, min_length=1, max_length=200)


class ReadingIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_SPEECH_CHARS)
    reading: str = Field(max_length=200)


class ReadingsIn(BaseModel):
    words: list[ReadingIn] = Field(max_length=MAX_READINGS)


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine
    speech = ctx.speech

    def need_speech() -> Speech:
        if speech is None:
            raise HTTPException(
                503,
                "Read & Listen's server has no Azure key. Set AZURE_SPEECH_KEY and"
                " AZURE_SPEECH_REGION in server/.env.",
            )
        return speech

    @routes.get("/api/voices", dependencies=authed)
    async def voices(
        language: Annotated[str, Query(min_length=2, max_length=20)],
    ) -> dict[str, Any]:
        want = language.replace("_", "-").lower()
        try:
            found = await need_speech().voices()
        except SpeechError as e:
            raise HTTPException(503, str(e)) from e

        def in_language(v: dict[str, Any]) -> bool:
            loc = (v.get("locale") or "").lower()
            return loc == want or loc.startswith(want + "-")

        def order(v: dict[str, Any]) -> tuple[str, str]:
            return (v.get("locale") or "", v.get("name") or "")

        # The language's own voices first, then the Multilingual ones of other locales.
        own = sorted((v for v in found if in_language(v)), key=order)
        others = sorted(
            (v for v in found if not in_language(v) and is_multilingual(v.get("voice") or "")),
            key=order,
        )
        return {"voices": own + others}

    @routes.post("/api/speech", dependencies=authed)
    async def speak(body: SpeechIn) -> Response:
        try:
            locale_of(body.voice)
            locale = speech_locale(body.language) if body.language else None
            language = text_locale(locale) if locale else None
        except SpeechError as e:
            raise HTTPException(400, str(e)) from e
        spoken = body.text.strip()
        japanese_voice = (language or locale_of(body.voice)).startswith("ja")
        said = (
            japanese.spoken_reading(spoken, body.reading)
            if body.reading and japanese_voice
            else None
        )
        try:
            mp3 = await need_speech().synthesize(
                spoken, body.voice, body.rate, language, said, ipa=body.ipa
            )
        except SpeechError as e:
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        # Counted as a text's lines are (Engine.line_audio): only a recording Azure made, which is
        # what it bills.
        store.save_call_cost(
            engine.conn, "recording", "", engine.clock(), audio_chars=billed_chars(spoken)
        )
        return Response(mp3, media_type="audio/mpeg")

    @routes.post("/api/readings", dependencies=authed)
    def readings(body: ReadingsIn) -> dict[str, list[str | None]]:
        """For each Japanese word and its KanaReading, the reading to record it from, or None to
        record the kanji as written (japanese.spoken_reading): the MCP's add_tts_audio asks here,
        as it has no Sudachi of its own."""
        return {"readings": [japanese.spoken_reading(w.text, w.reading) for w in body.words]}

    async def cast_audio(parts: list[Part], language: Code) -> Response:
        """A story characters sample or scene (cast_samples.py): the parts spoken in their voices
        as one recording, counted as a card's recording is."""
        if engine.synthesize_parts is None:
            need_speech()  # says there's no Azure key
            raise HTTPException(503, "Read & Listen's server can't record several voices here.")
        try:
            spoken = await engine.synthesize_parts(parts, LANGUAGES[language].locale)
        except TtsFailed as e:
            raise HTTPException(503, str(e)) from e
        store.save_call_cost(
            engine.conn,
            "recording",
            "",
            engine.clock(),
            audio_chars=sum(billed_chars(p.text) for p in parts),
        )
        return Response(spoken.audio, media_type="audio/mpeg")

    @routes.post("/api/cast/sample", dependencies=authed)
    async def cast_sample(body: CastSampleIn) -> Response:
        check_voice(body.voice, body.language)
        line = cast_samples.sample_line(body.language, body.gender)
        return await cast_audio([Part(line, body.voice, body.pitch)], body.language)

    @routes.post("/api/cast/scene", dependencies=authed)
    async def cast_scene(body: CastSceneIn) -> Response:
        chosen = cast.presets(
            engine.voices_for(body.language),
            store.load_settings(engine.conn).cast.get(body.language, {}),
        )
        narrator = engine.voices_for(body.language)["male"]
        parts = cast_samples.scene_parts(body.language, narrator, chosen["girl"], chosen["woman"])
        return await cast_audio(parts, body.language)

    return routes
