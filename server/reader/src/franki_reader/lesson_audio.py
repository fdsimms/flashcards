"""Makes a lesson's MP3 (docs/read-and-listen/architecture.md, Audio lessons): each distinct clip is
spoken once by Azure and leveled to one loudness (so the narrator and the native voices sit at the
same volume), then the clips and the silences between them are laid end to end as raw audio and
encoded as one MP3. The silences are made here, not spoken, so a lesson is the same length every
time it's made.

ffmpeg does the decoding and the encoding. Raw audio is 16-bit mono at `RATE`, the rate Azure's
voices are asked for (franki_speech.OUTPUT_FORMAT), so no resampling happens between a clip and the
lesson.
"""

import asyncio
import logging
import shutil
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from franki_speech.loudness import LoudnessError, normalize_loudness

from franki_reader.lesson import Say, Silence, Step, clips

log = logging.getLogger(__name__)

RATE = 24000
BYTES_PER_MS = RATE * 2 // 1000  # 16-bit mono
TIMEOUT_SECONDS = 120.0
BITRATE = "48k"
# Clips spoken at once: Azure rate-limits, and a lesson has a couple of dozen.
CONCURRENCY = 4

# Speaks one clip, as an MP3 (the narrator's or a native voice's).
Speak = Callable[[Say], Awaitable[bytes]]
# An MP3 as raw 16-bit mono audio at RATE, and raw audio as an MP3.
Decode = Callable[[bytes], Awaitable[bytes]]
Encode = Callable[[bytes], Awaitable[bytes]]
# Brings a clip to the lesson's loudness.
Level = Callable[[bytes], Awaitable[bytes]]


class LessonAudioFailed(Exception):
    """A lesson couldn't be made into audio; the message says why, to be shown as it is."""


@dataclass(frozen=True)
class Rendered:
    audio: bytes
    duration_ms: int


async def _ffmpeg(data: bytes, *args: str) -> bytes:
    exe = shutil.which("ffmpeg")
    if exe is None:
        raise LessonAudioFailed("ffmpeg isn't installed on the server, so a lesson can't be made.")
    proc = await asyncio.create_subprocess_exec(
        exe,
        "-hide_banner",
        "-nostats",
        "-loglevel",
        "error",
        *args,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(data), TIMEOUT_SECONDS)
    except TimeoutError as e:
        proc.kill()
        raise LessonAudioFailed("ffmpeg took too long making the lesson.") from e
    if proc.returncode != 0 or not out:
        tail = err.decode(errors="replace").strip().splitlines()[-1:] or ["no message"]
        raise LessonAudioFailed(f"ffmpeg couldn't make the lesson's audio ({tail[0]}).")
    return out


async def ffmpeg_decode(mp3: bytes) -> bytes:
    return await _ffmpeg(mp3, "-i", "pipe:0", "-f", "s16le", "-ar", str(RATE), "-ac", "1", "pipe:1")


async def ffmpeg_encode(pcm: bytes) -> bytes:
    return await _ffmpeg(
        pcm,
        *("-f", "s16le", "-ar", str(RATE), "-ac", "1", "-i", "pipe:0"),
        *("-c:a", "libmp3lame", "-b:a", BITRATE, "-f", "mp3", "pipe:1"),
    )


async def level(clip: bytes) -> bytes:
    """The clip at the shared loudness; as it was if ffmpeg can't level it (it still plays)."""
    try:
        return await normalize_loudness(clip, sample_rate=RATE)
    except LoudnessError as e:
        log.warning("A lesson clip wasn't leveled: %s", e)
        return clip


def silence(ms: int) -> bytes:
    return bytes(ms * BYTES_PER_MS)


async def render(
    steps: list[Step],
    speak: Speak,
    *,
    decode: Decode = ffmpeg_decode,
    encode: Encode = ffmpeg_encode,
    level_clip: Level = level,
    on_joining: Callable[[], None] | None = None,
) -> Rendered:
    """The lesson as one MP3. Each distinct clip is spoken once, so Azure bills the lesson's
    distinct characters (`lesson.characters`), however often a phrase comes back. `on_joining` is
    called once every clip is spoken, before they're laid end to end and encoded."""
    gate = asyncio.Semaphore(CONCURRENCY)

    async def one(clip: Say) -> bytes:
        async with gate:
            return await decode(await level_clip(await speak(clip)))

    needed = clips(steps)
    done = await asyncio.gather(*(one(c) for c in needed))
    audio = dict(zip(needed, done, strict=True))
    if on_joining is not None:
        on_joining()
    pcm = bytearray()
    for step in steps:
        pcm += silence(step.ms) if isinstance(step, Silence) else audio[step]
    mp3 = await encode(bytes(pcm))
    return Rendered(mp3, len(pcm) // BYTES_PER_MS)
