"""Finders for Japanese's grammar points (grammar.py has the rest, grammar_points.json the points).
Added on 13 November 2026, with Japanese.

A finder gets a line's words as the Japanese checker splits them (japanese.py): a verb comes with
what conjugates it (行きました, 食べさせられた, 待って), and a verb after て is a word of its own
(待って + ください). Each word is read again with Sudachi to see its morphemes, so a point is found
by what Sudachi says a morpheme is (the auxiliary ます, the conjugation form 意志推量形), never by
how the word happens to end. Points that Sudachi can't tell apart reliably are left out: the
potential and the passive share られる, and a plain negative is too common to practice.
"""

from collections.abc import Callable
from functools import lru_cache

from franki_reader.japanese import Morpheme, morphemes

Span = tuple[int, int]
Finder = Callable[[list[str]], list[Span]]

_AUXILIARY, _PARTICLE, _VERB = "助動詞", "助詞", "動詞"

# Respectful and humble verbs, by dictionary form. くださる is left out: てください is its own point.
_KEIGO = {
    "いらっしゃる",
    "おっしゃる",
    "召し上がる",
    "なさる",
    "申す",
    "申し上げる",
    "参る",
    "いただく",
    "頂く",
    "伺う",
    "存じる",
    "ござる",
    "致す",
    "いたす",
    "拝見",
    "おる",
}


@lru_cache(maxsize=4096)
def _morphemes(word: str) -> tuple[Morpheme, ...]:
    return tuple(m for m in morphemes(word) if m.is_word)


def _each(test: Callable[[Morpheme], bool]) -> Finder:
    """A point in one word: any morpheme of it passes `test`."""

    def find(ws: list[str]) -> list[Span]:
        return [(i, i + 1) for i, w in enumerate(ws) if any(test(m) for m in _morphemes(w))]

    return find


def _ends_in_te(word: str) -> bool:
    ms = _morphemes(word)
    return bool(ms) and ms[-1].pos == _PARTICLE and ms[-1].surface in ("て", "で")


def _after_te(*verbs: str) -> Callable[[list[str]], list[Span]]:
    """A verb after a word ending in て or で (食べて + いる): both words."""

    def find(ws: list[str]) -> list[Span]:
        out = []
        for i in range(len(ws) - 1):
            ms = _morphemes(ws[i + 1])
            if _ends_in_te(ws[i]) and ms and ms[0].dictionary in verbs:
                out.append((i, i + 2))
        return out

    return find


def _either(*finders: Finder) -> Finder:
    return lambda ws: sorted({span for f in finders for span in f(ws)})


def _auxiliary(*dictionary: str) -> Callable[[Morpheme], bool]:
    # By normalized form too: the past after 読ん is だ, which Sudachi normalizes to た (the copula
    # だ stays だ).
    return lambda m: (
        m.pos == _AUXILIARY and (m.dictionary in dictionary or m.normalized in dictionary)
    )


FINDERS: dict[str, Finder] = {
    "ja.masu": _each(_auxiliary("ます")),
    # た, not たら, which is the conditional.
    "ja.past": _each(lambda m: _auxiliary("た")(m) and m.surface in ("た", "だ")),
    # 食べている and 食べてる, 住んでいます.
    "ja.te_iru": _either(_after_te("いる", "居る"), _each(_auxiliary("てる", "でる"))),
    "ja.tai": _each(_auxiliary("たい")),
    "ja.te_kudasai": _after_te("くださる", "下さる"),
    # 会おう, 食べよう, 行きましょう.
    "ja.volitional": _each(
        lambda m: m.pos in (_VERB, _AUXILIARY) and m.form.startswith("意志推量形")
    ),
    # 行ったら, 雨だったら, 行けば.
    "ja.conditional": _each(
        lambda m: (
            (_auxiliary("た")(m) and m.surface in ("たら", "だら"))
            or (m.pos == _PARTICLE and m.pos2 == "接続助詞" and m.surface == "ば")
        )
    ),
    "ja.causative": _each(lambda m: m.dictionary == "させる" or _auxiliary("せる", "させる")(m)),
    # 忘れてしまった, 忘れちゃった, 読んじゃった.
    "ja.te_shimau": _either(
        _after_te("しまう", "仕舞う"), _each(_auxiliary("ちゃう", "じゃう", "ちまう", "じまう"))
    ),
    "ja.keigo": _each(lambda m: m.dictionary in _KEIGO),
}
