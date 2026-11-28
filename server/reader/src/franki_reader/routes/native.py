"""Native recordings (franki_speech.commons): a word's native speakers' recordings found on
Wikimedia Commons, and the audio of one, trimmed and leveled, for the app to keep in a note."""

import asyncio
import hashlib
import logging
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Response
from franki_speech.commons import CommonsUnavailable, Recording
from franki_speech.loudness import LoudnessError, normalize_loudness, trim_silence
from pydantic import BaseModel, Field

from franki_reader import native_store
from franki_reader.languages import Code
from franki_reader.routes.context import AppContext

log = logging.getLogger(__name__)

MAX_WORDS = 50
# Words looked up while the request waits; any more are looked up in the background, together, and
# come back as `pending`, for the app to ask again (Commons is asked slowly, a request a second).
INLINE_WORDS = 3


class NativeFindIn(BaseModel):
    language: Code
    words: list[str] = Field(min_length=1, max_length=MAX_WORDS)


class NativeRecordingOut(BaseModel):
    title: str
    source: Literal["lingualibre", "wiktionary"]
    speaker: str
    license: str
    license_url: str
    page_url: str
    # The line a shared deck needs (who, license and link, the file, and that it was changed).
    credit: str


class NativeWordOut(BaseModel):
    word: str
    recordings: list[NativeRecordingOut]


class NativeFindOut(BaseModel):
    results: list[NativeWordOut]
    # Words still being looked up: ask again in a few seconds.
    pending: list[str]


def _out(r: Recording) -> NativeRecordingOut:
    return NativeRecordingOut(
        title=r.title,
        source=r.source,
        speaker=r.speaker,
        license=r.license,
        license_url=r.license_url,
        page_url=r.page_url,
        credit=r.credit,
    )


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine
    commons = ctx.commons
    folder = ctx.native_dir
    # (language, word) pairs being looked up in the background, so one isn't asked about twice.
    looking: set[tuple[str, str]] = set()

    NOT_SET_UP = "Native recordings aren't set up on this server."

    async def look_up(language: str, words: list[str]) -> dict[str, list[Recording]]:
        """The words' recordings, looked up together (`find_many`: one query for all of them), and kept."""
        assert commons is not None
        found = await commons.find_many(language, words)
        now = engine.clock()
        for word in words:
            native_store.keep(engine.conn, language, word, found[word], now)
        return found

    async def look_up_all(language: str, words: list[str]) -> None:
        try:
            await look_up(language, words)
        except CommonsUnavailable as e:
            log.warning("Native recordings: %d words left for later (%s)", len(words), e)
        finally:
            for word in words:
                looking.discard((language, word))

    @routes.post("/api/native/find", dependencies=authed, response_model=NativeFindOut)
    async def native_find(body: NativeFindIn, background: BackgroundTasks) -> NativeFindOut:
        """Each word's recordings, Lingua Libre's first. Reads only: nothing is kept on a note here."""
        if commons is None:
            raise HTTPException(503, NOT_SET_UP)
        words = list(dict.fromkeys(w.strip() for w in body.words if w.strip()))
        now = engine.clock()
        results: list[NativeWordOut] = []
        missing: list[str] = []
        for word in words:
            kept = native_store.fresh(engine.conn, body.language, word, now)
            if kept is None:
                missing.append(word)
            else:
                results.append(NativeWordOut(word=word, recordings=[_out(r) for r in kept]))
        inline, later = missing[:INLINE_WORDS], missing[INLINE_WORDS:]
        if inline:
            try:
                found = await look_up(body.language, inline)
            except CommonsUnavailable as e:
                raise HTTPException(503, f"Couldn't look up native recordings. {e}") from e
            results.extend(
                NativeWordOut(word=w, recordings=[_out(r) for r in found[w]]) for w in inline
            )
        fresh_later = [w for w in later if (body.language, w) not in looking]
        looking.update((body.language, w) for w in fresh_later)
        if fresh_later:
            background.add_task(look_up_all, body.language, fresh_later)
        return NativeFindOut(results=results, pending=later)

    @routes.get("/api/native/audio", dependencies=authed)
    async def native_audio(title: str = Query(min_length=6, max_length=300)) -> Response:
        """One found recording, trimmed of the silence at its ends and leveled, as MP3; kept on disk
        after the first time."""
        if commons is None or folder is None:
            raise HTTPException(503, NOT_SET_UP)
        recording = native_store.recording(engine.conn, title)
        if recording is None:
            raise HTTPException(
                404, "That recording wasn't found for any word. Look the word up first."
            )
        path = folder / f"{hashlib.sha1(title.encode()).hexdigest()[:20]}.mp3"
        if not path.exists():
            try:
                original = await commons.audio(recording)
                audio = await normalize_loudness(await trim_silence(original), sample_rate=44100)
            except CommonsUnavailable as e:
                raise HTTPException(503, f"Couldn't get the recording. {e}") from e
            except LoudnessError as e:
                raise HTTPException(503, f"Couldn't prepare the recording. {e}") from e
            folder.mkdir(parents=True, exist_ok=True)
            await asyncio.to_thread(path.write_bytes, audio)
        return Response(await asyncio.to_thread(path.read_bytes), media_type="audio/mpeg")

    return routes
