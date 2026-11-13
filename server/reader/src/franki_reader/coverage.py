"""Coverage checker: what share of a text's words are already known from the deck.

The lexicon is the dictionary. A text is segmented with the deck's entries added to PyThaiNLP's
word list, so a deck phrase (ข้าวเหนียวมะม่วง) stays one token instead of being split into words the
deck doesn't hold on their own. The model's own `|` breaks are never used for coverage: they're
stripped and the line is segmented again here, so a known word glued to an unknown one can't pass.

Each counted token is one of:
- known: a deck entry, a number, or a token that splits cleanly into deck entries (ร้านอาหาร when
  the deck holds ร้าน and อาหาร)
- partial: not an entry itself, but a word inside a longer entry (รับ inside รับอะไรดี). Counts as
  unknown for coverage, per the brief
- unknown: anything else
Whitespace and punctuation aren't counted.

`Lexicon` is Thai's checker. The other languages share one (spaced.py); both fit `Checker`, which is all the
generator, the reader and `check` need.
"""

import re
from collections.abc import Iterable
from dataclasses import dataclass
from functools import cached_property
from typing import Literal, Protocol

from pythainlp.corpus import thai_words
from pythainlp.tokenize import word_tokenize
from pythainlp.util import dict_trie

# The lowest coverage target a rating can reach (the default starts a little above, difficulty.py).
# Lowered from 95% on 12 November 2026: at 95% to 98% every text came out too easy, with 12-line
# dialogues holding almost no word the owner hadn't studied (docs/read-and-listen/architecture.md,
# Generation and coverage).
FLOOR = 0.90
# Below the floor after every attempt, the closest attempt is still shown if it's at least this
# (the owner's decision, 26 October 2026, lowered with the floor on 12 November 2026).
MINIMUM = 0.85
# A text more than this far above the target is too easy and goes back for revision too.
CEILING_GAP = 0.04

Status = Literal["known", "partial", "unknown"]

_NUMBER = re.compile(r"^[0-9๐-๙]+([.,][0-9๐-๙]+)*$")
# A token with no letters or digits at all: spaces, punctuation, ๆ and ฯ.
_NOT_A_WORD = re.compile(r"^[\W_ๆฯ]+$")


# Whitespace with a Thai character on each side.
# Thai has no commas or periods: a space is where a clause or sentence ends, and the voice pauses
# there (franki_speech's ssml). So in Thai a space the model writes on its own is kept, while one
# beside a `|`, which already marks the word boundary, is noise and dropped.
_BESIDE_BAR = re.compile(r"\s*\|\s*")
# A connective that opens a clause is written against what it joins (แล้วเดินมา), so a space right
# after one, with a space or the line start before it, is the model's slip, and the voice would pause
# there. One ending a clause (ไปแล้ว ผม...) has no space before it and is left alone.
_CONNECTIVE_GAP = re.compile(r"(?:(?<=\s)|^)(แล้ว|และ|แต่|หรือ|เพราะ|ถ้า|ก็|จึง)\s+(?=\S)")
# In a spaced language, the space a `|` became before closing punctuation or after opening.
_SPACE_BEFORE_CLOSING = re.compile(r"\s+(?=[.,;:!?)\]»…])")
_SPACE_AFTER_OPENING = re.compile(r"(?<=[¿¡(\[«])\s+")


@dataclass(frozen=True)
class Token:
    text: str
    status: Status


@dataclass(frozen=True)
class Coverage:
    tokens: tuple[Token, ...]
    stretch_words: tuple[str, ...]
    # The names the model marked, each once, in order. They aren't tokens: a name is not a word the
    # learner is expected to know, so it counts neither for nor against the text.
    names: tuple[str, ...] = ()

    @property
    def counted(self) -> int:
        return len(self.tokens)

    @property
    def known(self) -> int:
        return sum(1 for t in self.tokens if t.status == "known")

    @property
    def ratio(self) -> float:
        return self.known / self.counted if self.counted else 0.0

    def words(self, status: Status) -> list[str]:
        """Distinct words with this status, in the order they first appear."""
        return list(dict.fromkeys(t.text for t in self.tokens if t.status == status))

    def meets(self, floor: float = FLOOR) -> bool:
        return self.ratio >= floor


class Checker(Protocol):
    """What a language's coverage checker provides."""

    known: frozenset[str]  # the deck entries counted as known
    spaced: bool  # whether the language puts spaces between words

    def segment(self, text: str) -> list[str]: ...

    def status(self, token: str) -> Status: ...

    def known_pieces(self, token: str) -> list[str] | None: ...

    def entry_of(self, token: str) -> str | None:
        """The deck entry this token is a form of (hablé for hablar), or None."""
        ...


# Dictionary entries newmm reads in place of "a letter, then this particle" (กว่า for ก + ว่า, and the
# rare words นคะ, มสิ, วจะ, มมาก). The key's first letter belongs to the word before it.
_GLUED = {
    "กว่า": "ว่า",
    "นคะ": "คะ",
    "ภคะ": "คะ",
    "มสิ": "สิ",
    "อสิ": "สิ",
    "วจะ": "จะ",
    "มมาก": "มาก",
}


class Lexicon:
    """Thai: the deck's entries are the dictionary, and only they count as known."""

    spaced = False

    def __init__(self, known: Iterable[str]) -> None:
        self.known = frozenset(w.strip() for w in known if w.strip())

    @cached_property
    def partial(self) -> frozenset[str]:
        """Words that appear only inside a longer entry. Found by segmenting each entry with the
        default dictionary, not by substring, so ครับ never yields รับ."""
        pieces = {p for entry in self.known for p in word_tokenize(entry, engine="newmm")}
        return frozenset(
            p for p in pieces if p not in self.known and _counts(p) and not _is_number(p)
        )

    @cached_property
    def _segmenter(self):  # type: ignore[no-untyped-def]
        return dict_trie(set(thai_words()) | self.known | self.partial)

    @cached_property
    def _known_only(self):  # type: ignore[no-untyped-def]
        return dict_trie(self.known)

    def segment(self, text: str) -> list[str]:
        tokens = list(word_tokenize(text, custom_dict=self._segmenter, engine="newmm"))
        return self._fix_ties(tokens)

    def _fix_ties(self, tokens: list[str]) -> list[str]:
        """newmm prefers the fewest words and breaks a tie toward the shorter first word, so
        บอกว่า (said that) comes out as บอ + กว่า and ไหนคะ as ไห + นคะ. Both splits are two words.
        When a token in _GLUED is the first letter of a word glued to a common particle, and the
        word before it plus that letter is itself a word, take that reading. A genuine X + กว่า
        with Xก also a word (ปีกว่า, just over a year) loses, which is the rarer case."""
        out: list[str] = []
        for token in tokens:
            particle = _GLUED.get(token)
            if particle and out and out[-1] + token[0] in self._segmenter:
                out[-1] += token[0]
                out.append(particle)
            else:
                out.append(token)
        return out

    def status(self, token: str) -> Status:
        if token in self.known or _is_number(token):
            return "known"
        if token in self.partial:
            return "partial"
        if self._splits_into_known(token):
            return "known"
        return "unknown"

    def known_pieces(self, token: str) -> list[str] | None:
        """The deck entries a known compound splits into (ร้านอาหาร into ร้าน, อาหาร), or None if it
        doesn't split cleanly into two or more."""
        pieces = list(word_tokenize(token, custom_dict=self._known_only, engine="newmm"))
        if len(pieces) > 1 and all(p in self.known or _is_number(p) for p in pieces):
            return pieces
        return None

    def _splits_into_known(self, token: str) -> bool:
        return self.known_pieces(token) is not None

    def entry_of(self, token: str) -> str | None:
        return token if token in self.known else None


def _join(text: str, spaced: bool) -> str:
    text = text.replace("*", "").replace("~", "")
    if not spaced:
        return _CONNECTIVE_GAP.sub(r"\1", " ".join(_BESIDE_BAR.sub("", text).split()))
    text = " ".join(text.replace("|", " ").split())
    return _SPACE_AFTER_OPENING.sub("", _SPACE_BEFORE_CLOSING.sub("", text))


def parse_line(line: str, spaced: bool = False) -> tuple[str, list[str]]:
    """A model line (`ฉัน|ต้องการ|*น้ำ*`) as plain text plus its stretch words. Thai is written
    without spaces between words, so `|` is dropped, and a space only marks a clause break
    (`สวัสดี|ครับ ไป|ไหน`): kept as one space, unless it's beside a `|`. In a spaced language
    (`¿Qué|quieres|*tomar*?`) each `|` stands for a space, and punctuation stays on its word.
    A name is wrapped in tildes (`~มะลิ~|เป็น|สาว`); the tildes are dropped here (`segment_line`
    reads them)."""
    stretch = [_join(s, spaced).strip() for s in re.findall(r"\*([^*]+)\*", line)]
    return _join(line, spaced), [s for s in stretch if s]


_NAME = re.compile(r"~([^~]+)~")


def segment_line(line: str, lexicon: Checker) -> list[tuple[str, bool]]:
    """A model line's pieces as `lexicon.segment` splits its plain text, each with whether the
    model marked it as part of a name. A piece counts as a name only when it lies wholly inside a
    marked name, so a segmenter that joins a name's last syllable to the next word marks neither,
    and a word that is spelled like the name elsewhere in the line (มะลิ, jasmine) is left alone.
    The pieces of one name (สม, ชาย) come back as a single piece."""
    plain, _ = parse_line(line, lexicon.spaced)
    pieces = lexicon.segment(plain)
    spans: list[tuple[int, int]] = []
    unstarred = line.replace("*", "")
    if "".join(pieces) == plain:
        for m in _NAME.finditer(unstarred):
            name = _join(m.group(1), lexicon.spaced).strip()
            if not name:
                continue
            before = len(_join(unstarred[: m.start()], lexicon.spaced))
            at = plain.find(name, max(0, before - 1))
            if at >= 0:
                spans.append((at, at + len(name)))
    out: list[tuple[str, bool]] = []
    last: int | None = None  # the span the previous piece was in, so a name stays one piece
    pos = 0
    for piece in pieces:
        end = pos + len(piece)
        span = next((i for i, (s, e) in enumerate(spans) if s <= pos and end <= e), None)
        if span is not None and span == last:
            out[-1] = (out[-1][0] + piece, True)
        else:
            out.append((piece, span is not None))
        last = span
        pos = end
    return out


def line_names(line: str, spaced: bool) -> list[str]:
    """The names a model line marks, as plain text."""
    names = (_join(m, spaced).strip() for m in _NAME.findall(line.replace("*", "")))
    return [n for n in names if n]


def check(lines: Iterable[str], lexicon: Checker) -> Coverage:
    tokens: list[Token] = []
    stretch: list[str] = []
    names: list[str] = []
    for line in lines:
        _, line_stretch = parse_line(line, lexicon.spaced)
        stretch.extend(line_stretch)
        names.extend(line_names(line, lexicon.spaced))
        tokens.extend(
            Token(piece, lexicon.status(piece))
            for piece, is_name in segment_line(line, lexicon)
            if _counts(piece) and not is_name
        )
    return Coverage(
        tokens=tuple(tokens),
        stretch_words=tuple(dict.fromkeys(stretch)),
        names=tuple(dict.fromkeys(names)),
    )


def is_word(token: str) -> bool:
    """False for spaces and punctuation, which are shown but never counted or tapped."""
    return _counts(token)


def _counts(token: str) -> bool:
    return bool(token.strip()) and not _NOT_A_WORD.match(token)


def _is_number(token: str) -> bool:
    return bool(_NUMBER.match(token))
