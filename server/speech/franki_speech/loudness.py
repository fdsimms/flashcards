"""
Loudness for recorded audio: every clip brought to one level, so a card isn't much louder or
quieter than the one before it. Azure's voices come out at different levels (and imported clips
at whatever level they were saved at), and the apps play a file as it is.

Two passes of ffmpeg's EBU R128 `loudnorm`: one to measure the clip, one to apply exactly the
gain that measurement calls for (`linear=true`, so it's a plain gain and doesn't squash the
voice's dynamics). A single pass can't do that on a clip of a second or two. -16 LUFS is the
usual level for spoken audio on a phone.

Needs the `ffmpeg` program. Where it isn't there, `LoudnessUnavailable` says so and the caller
decides whether to keep the audio as it was.
"""

from __future__ import annotations

import asyncio
import json
import math
import re
import shutil

TARGET_LUFS = -16.0
TRUE_PEAK = -1.5
LOUDNESS_RANGE = 11.0
# A clip already this close to the target (in LU) is left as it is: re-encoding costs quality for
# a difference nobody hears.
TOLERANCE_LU = 1.0
TIMEOUT_SECONDS = 60.0

_JSON = re.compile(r"\{[^{}]*\}", re.DOTALL)

__all__ = [
    "TARGET_LUFS",
    "TOLERANCE_LU",
    "LoudnessError",
    "LoudnessUnavailable",
    "measure_loudness",
    "normalize_loudness",
]


class LoudnessError(Exception):
    """ffmpeg couldn't read or process the clip; the message says why."""


class LoudnessUnavailable(LoudnessError):
    """ffmpeg isn't installed here."""


def _filter(extra: str = "") -> str:
    return f"loudnorm=I={TARGET_LUFS}:TP={TRUE_PEAK}:LRA={LOUDNESS_RANGE}{extra}"


async def _ffmpeg(audio: bytes, *args: str) -> tuple[bytes, str]:
    exe = shutil.which("ffmpeg")
    if exe is None:
        raise LoudnessUnavailable("ffmpeg isn't installed, so audio can't be leveled.")
    proc = await asyncio.create_subprocess_exec(
        exe,
        "-hide_banner",
        "-nostats",
        "-loglevel",
        "info",
        "-i",
        "pipe:0",
        *args,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(audio), TIMEOUT_SECONDS)
    except TimeoutError as e:
        proc.kill()
        raise LoudnessError("ffmpeg took too long on this clip.") from e
    if proc.returncode != 0:
        tail = err.decode(errors="replace").strip().splitlines()[-1:] or ["no message"]
        raise LoudnessError(f"ffmpeg couldn't read this audio ({tail[0]}).")
    return out, err.decode(errors="replace")


async def _measure(audio: bytes) -> dict[str, str]:
    _, err = await _ffmpeg(audio, "-af", _filter(":print_format=json"), "-f", "null", "-")
    found = _JSON.findall(err)
    if not found:
        raise LoudnessError("ffmpeg gave no loudness reading for this audio.")
    try:
        data = json.loads(found[-1])
        return {
            k: str(data[k])
            for k in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")
        }
    except (ValueError, KeyError) as e:
        raise LoudnessError("ffmpeg's loudness reading couldn't be understood.") from e


def _lufs(value: str) -> float | None:
    """A reading as a number; None for silence (ffmpeg says -inf), or a clip too short to measure."""
    x = float(value)
    return x if math.isfinite(x) else None


async def measure_loudness(audio: bytes) -> float | None:
    """The clip's integrated loudness in LUFS, or None when it has none (silent, or under ~0.4 s)."""
    return _lufs((await _measure(audio))["input_i"])


async def normalize_loudness(audio: bytes, *, sample_rate: int = 24000) -> bytes:
    """The clip as mono MP3 at `TARGET_LUFS`. A clip with no measurable loudness comes back as
    it was, since there is nothing to level."""
    m = await _measure(audio)
    if _lufs(m["input_i"]) is None:
        return audio
    measured = (
        f":measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
        f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true"
    )
    # loudnorm works at 192 kHz internally, so the output rate is set back here.
    out, _ = await _ffmpeg(
        audio,
        "-af",
        _filter(measured),
        "-ar",
        str(sample_rate),
        "-ac",
        "1",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "48k",
        "-f",
        "mp3",
        "pipe:1",
    )
    if not out:
        raise LoudnessError("ffmpeg returned no audio.")
    return out
