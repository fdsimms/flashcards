"""Coverage for Japanese: which words in a text are known (docs/read-and-listen/architecture.md,
Languages). Added on 13 November 2026, by the owner's decision.

Japanese is written without spaces, so a line is split into words here, with SudachiPy (its core
dictionary, split mode C, the longest units), never by the model's `|`. Sudachi gives every
morpheme its dictionary form (行き → 行く) and a normalized form that also settles spelling
variants (引越し and 引っ越し, できる and 出来る), so a word is matched by those, and a deck entry
is keyed the same way.

- A word is what the learner taps: a content word with what conjugates it. A verb, adjective or
  auxiliary takes the auxiliaries after it and a て, で, ば, ちゃ or じゃ that joins it on
  (行きました, 食べさせられた, 待って, 高くない), a prefix joins the word after it (お茶), and a
  suffix joins the noun before it (学生たち, 三人), except after a name (田中 + さん), so a name
  marked with tildes stays a piece of its own. Particles, です and a verb like いる after て
  stand alone.
- Known: a studied deck entry, a WaniKani word at Guru or above (wanikani.py), or one of the
  language's most common words (data/ja_common.txt) within the `common` setting, matched by any of
  the word's surface, dictionary and normalized forms. Particles and auxiliaries are grammar, not
  vocabulary, and always count as known; so do numbers.
- A deck phrase (約束を破る, 気を失う, 暗くなる) is found by its morphemes' normalized forms, so
  約束を破った is one word, known. A suru verb (経験する) also makes its noun known (経験), and an
  entry written with what conjugates it (静かな) is known by its head (静か).
- Partial, as for Thai: a content word that's only inside a deck phrase counts as unknown.
- A compound Sudachi keeps whole (乗り換え口) is known when its shortest units (mode A) all are.
- A word's reading is Sudachi's, in hiragana; none for a word written only in kana, or with digits
  (Sudachi reads 13日 as イチミッカ).
"""

import re
import threading
from collections.abc import Iterable
from dataclasses import dataclass, field
from functools import cache, cached_property
from pathlib import Path
from typing import Any

from franki_reader.coverage import Status

_DATA = Path(__file__).parent / "data"

# Morpheme kinds (Sudachi's part of speech, first level).
_VERB, _ADJECTIVE, _AUXILIARY, _PARTICLE = "動詞", "形容詞", "助動詞", "助詞"
_NA_ADJECTIVE, _PREFIX, _SUFFIX, _SYMBOL, _SPACE = "形状詞", "接頭辞", "接尾辞", "補助記号", "空白"
_INFLECTING = {_VERB, _ADJECTIVE, _AUXILIARY, _NA_ADJECTIVE}
# Joining particles that belong to the verb or adjective before them.
_JOINING = {"て", "で", "ば", "ちゃ", "じゃ"}
_FUNCTION = {_PARTICLE, _AUXILIARY}
# A verb that makes a noun a suru verb (経験する); Sudachi normalizes する as 為る.
_SURU = {"する", "為る"}
# Marks a WaniKani word or a deck entry may carry that aren't part of the word (〜中, ~人).
_MARKS = re.compile(r"[〜～~]")
_PARENTHESES = re.compile(r"[(（][^)）]*[)）]")
_DIGIT = re.compile(r"[0-9０-９]")
_KANJI = re.compile(r"[㐀-鿿々〆]")
_PHRASE_MAX = 8  # morphemes


@dataclass(frozen=True)
class Morpheme:
    surface: str
    dictionary: str
    normalized: str
    reading: str  # katakana, as Sudachi gives it
    pos: str
    pos2: str
    form: str = ""  # the conjugation form (意志推量形 for 会おう), for grammar_japanese.py

    @property
    def forms(self) -> tuple[str, ...]:
        return (self.surface, self.dictionary, self.normalized)

    @property
    def is_word(self) -> bool:
        return self.pos not in (_SYMBOL, _SPACE) and any(ch.isalnum() for ch in self.surface)


@dataclass(frozen=True)
class Word:
    """One piece of a line as the learner sees it: its morphemes, which of them is the word itself
    (after any prefix), and the deck phrase it is, if it is one."""

    morphemes: tuple[Morpheme, ...]
    head: int = 0
    phrase: tuple[str, ...] | None = None  # the phrase key it matched

    @property
    def surface(self) -> str:
        return "".join(m.surface for m in self.morphemes)

    @property
    def head_morpheme(self) -> Morpheme:
        return self.morphemes[self.head]

    @property
    def forms(self) -> tuple[str, ...]:
        """What the word is looked up by: as written, with its prefix (お茶), and its head's
        surface, dictionary and normalized forms."""
        head = self.head_morpheme
        prefix = "".join(m.surface for m in self.morphemes[: self.head])
        prefixed = (prefix + head.surface, prefix + head.dictionary) if prefix else ()
        return tuple(dict.fromkeys((self.surface, *prefixed, *head.forms)))


# ==== Sudachi ====

_local = threading.local()


@cache
def _dictionary() -> Any:
    from sudachipy import Dictionary  # type: ignore[import-untyped]  # loaded on first use

    return Dictionary(dict="core")


def _tokenizer() -> Any:
    # A tokenizer isn't safe to share between threads; the dictionary is.
    if not hasattr(_local, "tokenizer"):
        _local.tokenizer = _dictionary().tokenizer()
    return _local.tokenizer


def morphemes(text: str, short: bool = False) -> list[Morpheme]:
    """The text as Sudachi splits it: its longest units, or its shortest with `short`."""
    from sudachipy import SplitMode

    mode = SplitMode.A if short else SplitMode.C
    return [
        Morpheme(
            m.surface(),
            m.dictionary_form(),
            m.normalized_form(),
            m.reading_form(),
            m.part_of_speech()[0],
            m.part_of_speech()[1],
            m.part_of_speech()[5],
        )
        for m in _tokenizer().tokenize(text, mode)
    ]


def lemma_key(word: str) -> str:
    """A word as the common-words list compares it: the normalized form of its one morpheme, or the
    word itself when it isn't one (scripts/build_common.py writes the list by the same rule)."""
    found = [m for m in morphemes(word) if m.is_word]
    return found[0].normalized if len(found) == 1 else word


# The kinds of word the vocabulary check can ask about: not particles, auxiliaries or affixes.
_CONTENT = {"名詞", "動詞", "形容詞", "副詞", "形状詞", "連体詞", "感動詞", "代名詞"}
_ONE_KANA = re.compile(r"^[\u3041-\u30ff]$")


def quiz_word(word: str) -> bool:
    """Whether a common word can be a vocabulary check question: one content word written in its
    dictionary form, not a name, a number, a lone kana or a piece of a conjugated word that wordfreq
    listed on its own (なっ). Sudachi reads some pieces as words (まし, あり), so the request also
    lets Claude leave out what isn't a word (vocab_check.py)."""
    found = [m for m in morphemes(word) if m.is_word]
    if len(found) != 1 or _ONE_KANA.match(word) or word.endswith("っ"):
        return False
    m = found[0]
    return (
        m.surface == word
        and m.dictionary == word
        and m.pos in _CONTENT
        and m.pos2 not in ("固有名詞", "数詞", "非自立可能")
    )


def hiragana(katakana: str) -> str:
    """Katakana as hiragana; ー and anything else stays as it is."""
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in katakana)


# ==== The word list ====


@cache
def common_lemmas() -> tuple[str, ...]:
    """Japanese's most common words, most common first, as shown to the learner."""
    lines = (_DATA / "ja_common.txt").read_text(encoding="utf-8").splitlines()
    return tuple(w for w in lines if w and not w.startswith("#"))


@cache
def common_words() -> tuple[str, ...]:
    """The same list as it's compared (`lemma_key`)."""
    return tuple(lemma_key(w) for w in common_lemmas())


@cache
def _common(count: int) -> frozenset[str]:
    return frozenset(common_words()[:count])


@dataclass
class _Index:
    """Words and phrases by key, each with the deck entry it came from (None for a WaniKani or
    common word, which counts as known but isn't a deck word)."""

    singles: dict[str, str | None] = field(default_factory=dict)
    # A phrase's first normalized form -> its keys (every morpheme's normalized form), longest first.
    phrases: dict[str, list[tuple[tuple[str, ...], str | None]]] = field(default_factory=dict)
    phrase_words: set[str] = field(default_factory=set)  # content words inside phrases

    def add(self, text: str, entry: str | None) -> None:
        text = _MARKS.sub("", _PARENTHESES.sub(" ", text))
        for alternative in re.split(r"[/／;；、,]", text):
            alternative = "".join(alternative.split())
            if alternative:
                self._add_one(alternative, entry)

    def _add_one(self, text: str, entry: str | None) -> None:
        ms = [m for m in morphemes(text) if m.is_word]
        if not ms:
            return
        self.singles.setdefault(text, entry)
        if len(ms) == 1:
            for form in ms[0].forms:
                self.singles.setdefault(form, entry)
            return
        key = tuple(m.normalized for m in ms)
        options = self.phrases.setdefault(key[0], [])
        if all(k != key for k, _ in options):
            options.append((key, entry))
            options.sort(key=lambda o: -len(o[0]))
        # The word itself, without what conjugates it (静かな) or the する of a suru verb (経験する).
        core = list(ms)
        while len(core) > 1 and (core[-1].pos in _FUNCTION or core[-1].dictionary in _SURU):
            core.pop()
        if len(core) == 1:
            for form in core[0].forms:
                self.singles.setdefault(form, entry)
        else:
            self.phrase_words.update(m.normalized for m in ms if m.pos not in _FUNCTION)


class JapaneseLexicon:
    spaced = False
    code = "ja"

    def __init__(self, known: Iterable[str], common: int = 0, extra: Iterable[str] = ()) -> None:
        """`known` is the studied deck entries; `extra` other words that count as known without
        being deck words (WaniKani's)."""
        self.known = frozenset(e.strip() for e in known if e.strip())
        self.common = _common(common) if common else frozenset()
        self._index = _Index()
        for entry in sorted(self.known):
            self._index.add(entry, entry)
        for word in sorted({w.strip() for w in extra if w.strip()}):
            self._index.add(word, None)
        self._words: dict[str, Word] = {}  # each piece `segment` gave, as it was split there

    @cached_property
    def partial(self) -> frozenset[str]:
        """Content words inside a deck phrase that aren't known on their own."""
        return frozenset(w for w in self._index.phrase_words if not self._form_known(w))

    # ==== Segmenting ====

    def segment(self, text: str) -> list[str]:
        out = []
        for word in self._split(text):
            self._words[word.surface] = word
            out.append(word.surface)
        return out

    def _split(self, text: str) -> list[Word]:
        ms = morphemes(text)
        out: list[Word] = []
        i = 0
        while i < len(ms):
            if not ms[i].is_word:
                out.append(Word((ms[i],)))
                i += 1
                continue
            head = i
            while ms[head].pos == _PREFIX and head + 1 < len(ms) and ms[head + 1].is_word:
                head += 1
            phrase, end = self._phrase_at(ms, i)
            if phrase is None:
                end = head + 1
                if ms[head].pos2 != "固有名詞":
                    while end < len(ms) and ms[end].pos == _SUFFIX:
                        end += 1
            if phrase is not None or ms[end - 1].pos in _INFLECTING:
                while end < len(ms) and _conjugates(ms[end], ms[end - 1]):
                    end += 1
            out.append(Word(tuple(ms[i:end]), head - i, phrase))
            i = end
        return out

    def _phrase_at(self, ms: list[Morpheme], start: int) -> tuple[tuple[str, ...] | None, int]:
        """The longest deck phrase starting at `start`, and where it ends."""
        for key, _ in self._index.phrases.get(ms[start].normalized, []):
            window = ms[start : start + len(key)]
            if len(window) == len(key) and all(
                m.is_word and m.normalized == k for m, k in zip(window, key, strict=True)
            ):
                return key, start + len(key)
        return None, start

    def _word(self, token: str) -> Word:
        """The token as `segment` split it, else as it splits on its own."""
        if found := self._words.get(token):
            return found
        words = [w for w in self._split(token) if any(m.is_word for m in w.morphemes)]
        if len(words) == 1 and words[0].surface == token.strip():
            return words[0]
        return Word(tuple(m for w in words for m in w.morphemes))

    # ==== Status ====

    def entry_of(self, token: str) -> str | None:
        if not token.strip():
            return None
        word = self._word(token)
        if word.phrase is not None:
            return self._phrase_entry(word.phrase)
        return next((e for f in word.forms if (e := self._index.singles.get(f))), None)

    def from_wanikani(self, token: str) -> bool:
        """Whether the word is known from WaniKani (`extra`) and isn't a deck word: what the reader
        says it is, rather than a common word."""
        if not token.strip() or self.entry_of(token) is not None:
            return False
        word = self._word(token)
        # Only deck entries and WaniKani words are indexed, and a deck word has its entry.
        return word.phrase is not None or any(f in self._index.singles for f in word.forms)

    def _phrase_entry(self, key: tuple[str, ...]) -> str | None:
        options = self._index.phrases.get(key[0], [])
        return next((entry for k, entry in options if k == key), None)

    def status(self, token: str) -> Status:
        if not token.strip():
            return "unknown"
        word = self._word(token)
        if not word.morphemes:
            return "unknown"
        if word.phrase is not None or self._is_known(word):
            return "known"
        if any(f in self.partial for f in word.head_morpheme.forms):
            return "partial"
        if self.known_pieces(token) is not None:
            return "known"
        return "unknown"

    def _is_known(self, word: Word) -> bool:
        head = word.head_morpheme
        if head.pos in _FUNCTION or head.pos2 == "数詞" or _is_number(word.surface):
            return True
        return any(self._form_known(f) for f in word.forms)

    def _form_known(self, form: str) -> bool:
        return form in self._index.singles or form in self.common

    def known_pieces(self, token: str) -> list[str] | None:
        """The known words a compound Sudachi keeps whole splits into (乗り換え口 into 乗り換え,
        口), or None if it doesn't split cleanly into two or more."""
        word = self._word(token)
        if word.phrase is not None or not word.morphemes:
            return None
        pieces = [m for m in morphemes(word.head_morpheme.surface, short=True) if m.is_word]
        if len(pieces) > 1 and all(
            m.pos in _FUNCTION or any(self._form_known(f) for f in m.forms) for m in pieces
        ):
            return [m.dictionary for m in pieces]
        return None

    # ==== What the reader shows ====

    def lemma_of(self, token: str) -> str | None:
        """The dictionary form (行きました to 行く): the deck entry it's a form of, else Sudachi's.
        None when the word is written that way already."""
        word = self._word(token)
        if not any(m.is_word for m in word.morphemes):
            return None
        head = word.head_morpheme
        if head.pos in _FUNCTION or head.pos2 == "数詞":
            return None  # a particle's or a number's dictionary form says nothing
        if word.phrase is not None:
            found = self._phrase_entry(word.phrase)
        else:
            prefix = "".join(m.surface for m in word.morphemes[: word.head])
            found = self.entry_of(token) or prefix + head.dictionary
        return None if not found or found == token.strip() else found

    def reading_of(self, token: str) -> str | None:
        """The word's reading in hiragana, or None when there's nothing to show: a word in kana
        only, or with digits, which Sudachi reads poorly."""
        if not _KANJI.search(token) or _DIGIT.search(token):
            return None
        word = self._word(token)
        return hiragana("".join(m.reading for m in word.morphemes)) or None


def _conjugates(m: Morpheme, before: Morpheme) -> bool:
    """Whether `m` belongs to the verb or adjective it follows."""
    if m.pos == _AUXILIARY:
        return True
    if m.pos == _PARTICLE and m.surface in _JOINING:
        return before.pos in (_VERB, _ADJECTIVE, _AUXILIARY)
    # 高くない, 飲みたくない: ない after an adjective, or after たく, is an adjective itself.
    return m.pos == _ADJECTIVE and m.pos2 == "非自立可能" and before.pos in (_ADJECTIVE, _AUXILIARY)


def _is_number(token: str) -> bool:
    return bool(re.fullmatch(r"[0-9０-９]+([.,．，][0-9０-９]+)*", token))
