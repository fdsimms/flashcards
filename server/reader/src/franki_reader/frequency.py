"""How common a word is: its place in the language's list of most common words
(data/<code>_common.txt, 10,000 long, most common first), for the reader's word popup.

Every language but Thai lists word families, so a form is looked up by its dictionary form
(hablé finds hablar); Thai's list is of words as its corpora segment them, blending written Thai with subtitles so
casual words rank where they're said (scripts/build_common.py). This only ranks a word.
What counts as known is decided elsewhere, and Thai still counts only its deck.
"""

from dataclasses import dataclass
from functools import cache

from pythainlp.tokenize import word_tokenize

from franki_reader.coverage import Checker, is_word
from franki_reader.japanese import JapaneseLexicon, is_phrase, lemma_key
from franki_reader.japanese import common_words as japanese_words
from franki_reader.spaced import SpacedLexicon, common_words, fold, lemma

THAI = "th"


@cache
def _ranks(words: tuple[str, ...]) -> dict[str, int]:
    ranks: dict[str, int] = {}
    for place, word in enumerate(words, start=1):
        ranks.setdefault(word, place)
    return ranks


@cache
def _thai() -> dict[str, int]:
    from franki_reader.spaced import _DATA  # the one place the lists are read from

    lines = (_DATA / "th_common.txt").read_text(encoding="utf-8").splitlines()
    return _ranks(tuple(w for w in lines if w and not w.startswith("#")))


def rank_of(word: str, lexicon: Checker, *, nouns_are_one_word: bool = False) -> int | None:
    """The word's place in its language's list (1 is the most common), or None when it's past the
    end of the list, isn't a word, or is a phrase. For Japanese, `nouns_are_one_word` files a run of
    nouns (一月) as one word rather than a phrase (`japanese.is_phrase`)."""
    if not is_word(word):
        return None
    if isinstance(lexicon, JapaneseLexicon):
        if is_phrase(word, nouns_are_one_word=nouns_are_one_word):
            return None  # 気を失う would otherwise rank as 気
        ranks = _ranks(japanese_words())
        keys = [lemma_key(lexicon.lemma_of(word) or word), lemma_key(word)]
    else:
        code: str = getattr(lexicon, "code", THAI)
        if code == THAI:
            ranks, keys = _thai(), [word.strip()]
        elif " " in word.strip():
            return None
        else:
            ranks = _ranks(common_words(code))
            keys = [lemma(word, code), fold(word, code)]
    found = [ranks[k] for k in keys if k in ranks]
    return min(found) if found else None


@dataclass(frozen=True)
class EntryPlace:
    """Where a deck entry stands: its place in the list, and whether it's a phrase (an entry of
    several words, which no list of single words ranks)."""

    rank: int | None
    phrase: bool = False


def _spaced_rank(word: str, code: str) -> int | None:
    ranks = _ranks(common_words(code))
    found = [ranks[k] for k in (lemma(word, code), fold(word, code)) if k in ranks]
    return min(found) if found else None


def entry_place(entry: str, lexicon: Checker) -> EntryPlace:
    """The place of a deck entry as the deck writes it, for ordering and tiering cards. A spaced
    language's entry is ranked without its article or marker (ten mężczyzna, as mężczyzna; bać się,
    as bać) and by its best alternative (der/die Mitwirkende); one left with several words is a
    phrase. Thai's entry is a phrase when it isn't on the list and the default dictionary cuts it
    into several words, and Japanese's when it isn't on the list and the lexicon files it as a
    phrase (`japanese.is_phrase`: 約束を破る, but not a run of nouns, which is one word: 一月).
    Unlike `rank_of`, this reads a whole entry."""
    if isinstance(lexicon, SpacedLexicon):
        keys = lexicon.entry_keys(entry)
        found = [
            r for k in keys if len(k) == 1 and (r := _spaced_rank(k[0], lexicon.code)) is not None
        ]
        if found:
            return EntryPlace(min(found))
        return EntryPlace(None, phrase=any(len(k) > 1 for k in keys))
    rank = rank_of(entry, lexicon, nouns_are_one_word=True)
    if rank is not None:
        return EntryPlace(rank)
    if isinstance(lexicon, JapaneseLexicon):
        return EntryPlace(None, phrase=is_phrase(entry, nouns_are_one_word=True))
    pieces = [p for p in word_tokenize(entry.strip(), engine="newmm") if is_word(p)]
    return EntryPlace(None, phrase=len(pieces) > 1)
