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
import sys
from array import array
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from franki_speech.loudness import LoudnessError, normalize_loudness

from franki_reader.lesson import Placed, Say, Silence, Step, clips

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


# Where the learner speaks, as (start, end) in milliseconds from the start of the MP3: the app can
# stop at each and wait for a tap (docs/read-and-listen/architecture.md, Audio lessons).
Pause = tuple[int, int]


@dataclass(frozen=True)
class Rendered:
    audio: bytes
    duration_ms: int
    pauses: tuple[Pause, ...] = ()
    # Every step where it falls, for the app's transcript (lesson.script_of).
    placed: tuple[Placed, ...] = ()


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
    pauses: list[Pause] = []
    placed: list[Placed] = []
    for step in steps:
        start = len(pcm) // BYTES_PER_MS
        if isinstance(step, Silence):
            if step.answer:
                pauses.append((start, start + step.ms))
            pcm += silence(step.ms)
        else:
            pcm += audio[step]
        placed.append(Placed(step, start, len(pcm) // BYTES_PER_MS))
    mp3 = await encode(bytes(pcm))
    return Rendered(mp3, len(pcm) // BYTES_PER_MS, tuple(pauses), tuple(placed))


# A phrase cut out for a card starts and ends a little outside its clip, so no sound is clipped.
CUT_MARGIN_MS = 60


async def cut(mp3: bytes, start_ms: int, end_ms: int) -> bytes:
    """The part of a lesson's MP3 between two times, as an MP3 of its own (a phrase for a card)."""
    begin = max(0, start_ms - CUT_MARGIN_MS) / 1000
    stop = (end_ms + CUT_MARGIN_MS) / 1000
    return await _ffmpeg(
        mp3,
        *("-i", "pipe:0", "-ss", f"{begin:.3f}", "-to", f"{stop:.3f}"),
        *("-ac", "1", "-c:a", "libmp3lame", "-b:a", BITRATE, "-f", "mp3", "pipe:1"),
    )


# Finding the answer silences in a lesson made before they were recorded (`find_pauses`). An answer
# silence is at least lesson.PAUSE_MIN_MS of generated zeros; every other gap is lesson.AFTER_NATIVE_MS
# or shorter, plus whatever quiet a voice's clip has at its ends. A run of quiet this long is an
# answer's, and a few hundred milliseconds of it falling on a clip's quiet ends doesn't matter.
FIND_MIN_MS = 2700
FRAME_MS = 10
# The loudest sample in a quiet frame, of 32767: about -40 dBFS, under any voice but over MP3's
# rounding of the generated zeros.
QUIET_PEAK = 330


def quiet_runs(pcm: bytes, min_ms: int = FIND_MIN_MS) -> list[Pause]:
    """Each run of quiet at least `min_ms` long in raw 16-bit mono audio at RATE, as (start, end),
    with something heard after it."""
    samples = array("h")
    samples.frombytes(pcm[: len(pcm) - len(pcm) % 2])
    if sys.byteorder == "big":
        samples.byteswap()
    per = RATE * FRAME_MS // 1000
    runs: list[Pause] = []
    start: int | None = None
    frames = (len(samples) + per - 1) // per
    for i in range(frames):
        chunk = samples[i * per : (i + 1) * per]
        quiet = max(chunk) <= QUIET_PEAK and min(chunk) >= -QUIET_PEAK
        if quiet and start is None:
            start = i
        elif not quiet and start is not None:
            if (i - start) * FRAME_MS >= min_ms:
                runs.append((start * FRAME_MS, i * FRAME_MS))
            start = None
    # Quiet running to the end isn't an answer: a lesson ends on the narrator's last words.
    return runs


async def find_pauses(mp3: bytes, decode: Decode = ffmpeg_decode) -> tuple[Pause, ...]:
    """The answer silences of a lesson's MP3, found by listening for them, for a lesson made before
    `render` kept them."""
    return tuple(quiet_runs(await decode(mp3)))
