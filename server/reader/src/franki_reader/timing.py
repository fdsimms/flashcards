"""When each of a line's words is spoken, for the reader to follow along with the audio.

Azure reports the words as its voice split them (`WordMark`), which needn't be how the line is
split here: in Thai it segments by itself, so one of its words can be two of ours (ชายหาด for
ชาย|หาด) or the other way round. Each of its words is found in the line's text, in order, and a word
here takes the time of every one of Azure's it overlaps, so two words Azure spoke as one light up
together. A word Azure reported that can't be found (a respelling in the SSML, a number it read
out) is skipped; the words around it still have their times.
"""

from __future__ import annotations

import unicodedata
from typing import Any

from franki_speech import WordMark

# Joins a respelling's syllables (franki_speech.THAI_PRONUNCIATIONS) and is no part of the text.
_ZWSP = "\u200b"


def word_times(pieces: list[str], marks: list[WordMark]) -> list[tuple[int, int] | None]:
    """For each piece of a line (its words, spaces and punctuation, in order), when it starts and
    ends in the line's audio in milliseconds, or None when no spoken word falls on it."""
    pieces = [unicodedata.normalize("NFC", p) for p in pieces]
    text = "".join(pieces)
    found: list[tuple[int, int, WordMark]] = []
    at = 0
    for mark in marks:
        word = unicodedata.normalize("NFC", mark.text.replace(_ZWSP, "")).strip()
        if not word:
            continue
        i = text.find(word, at)
        if i < 0:
            continue
        found.append((i, i + len(word), mark))
        at = i + len(word)
    out: list[tuple[int, int] | None] = []
    start = 0
    for piece in pieces:
        end = start + len(piece)
        over = [m for s, e, m in found if s < end and e > start] if piece.strip() else []
        out.append((min(m.start for m in over), max(m.end for m in over)) if over else None)
        start = end
    return out


def add_times(words: list[dict[str, Any]], marks: list[WordMark] | None) -> None:
    """Gives each word of a rendered line (reader.render) its `time`, `[start, end]` in
    milliseconds into the line's audio, where it has one. Spaces and punctuation get none."""
    if not marks:
        return
    for word, time in zip(words, word_times([w["text"] for w in words], marks), strict=True):
        if time is not None and word["status"] is not None:
            word["time"] = list(time)
