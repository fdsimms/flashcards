"""When each of a line's words is spoken, for the reader to follow along with the audio.

Azure reports the words as its voice split them (`WordMark`), which needn't be how the line is
split here. In Thai it reports a whole run of text between spaces as one word, so one of its words
can be several of ours (ต้นกำลังร้องไห้ for ต้น|กำลัง|ร้องไห้), and a word of ours can also be two of
its (ชายหาด for ชาย|หาด). Each of its words is found in the line's text, in order, and its time is
shared out over its letters, so a word here takes the stretch of every one of Azure's it overlaps
that its own letters account for: a run of three words lights up one word at a time, not all at
once. Only letters and digits count, not Thai's vowel and tone marks written above and below
(unicode category M), since those don't lengthen the word much; it's an estimate within the run,
Azure giving no finer time. A word Azure reported that can't be found (a respelling in the SSML, a
number it read out) is skipped; the words around it still have their times.
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
        over = (
            [_share(text, s, e, m, start, end) for s, e, m in found if s < end and e > start]
            if piece.strip()
            else []
        )
        out.append((min(t[0] for t in over), max(t[1] for t in over)) if over else None)
        start = end
    return out


def _weight(text: str) -> int:
    """How many of `text`'s characters take time to say: letters and digits, not marks."""
    return sum(1 for ch in text if unicodedata.category(ch)[0] in "LN")


def _share(text: str, s: int, e: int, mark: WordMark, start: int, end: int) -> tuple[int, int]:
    """The part of `mark`'s time (spoken as `text[s:e]`) that falls on `text[start:end]`, shared
    out by letters."""
    whole = _weight(text[s:e])
    if not whole:
        return mark.start, mark.end
    a, b = max(s, start), min(e, end)
    before = _weight(text[s:a])
    through = before + _weight(text[a:b])
    span = mark.end - mark.start
    return mark.start + round(span * before / whole), mark.start + round(span * through / whole)


def add_times(words: list[dict[str, Any]], marks: list[WordMark] | None) -> None:
    """Gives each word of a rendered line (reader.render) its `time`, `[start, end]` in
    milliseconds into the line's audio, where it has one. Spaces and punctuation get none."""
    if not marks:
        return
    for word, time in zip(words, word_times([w["text"] for w in words], marks), strict=True):
        if time is not None and word["status"] is not None:
            word["time"] = list(time)
