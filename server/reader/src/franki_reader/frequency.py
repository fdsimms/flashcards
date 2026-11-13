"""How common a word is: its place in the language's list of most common words
(data/<code>_common.txt, 10,000 long, most common first), for the reader's word popup.

Every language but Thai lists word families, so a form is looked up by its dictionary form
(hablé finds hablar); Thai's list is of words as its corpora segment them, blending written Thai with subtitles so
casual words rank where they're said (scripts/build_common.py). This only ranks a word.
What counts as known is decided elsewhere, and Thai still counts only its deck.
"""

from functools import cache

from franki_reader.coverage import Checker, is_word
from franki_reader.japanese import JapaneseLexicon, lemma_key
from franki_reader.japanese import common_words as japanese_words
from franki_reader.spaced import common_words, fold, lemma

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


def rank_of(word: str, lexicon: Checker) -> int | None:
    """The word's place in its language's list (1 is the most common), or None when it's past the
    end of the list, isn't a word, or is a phrase."""
    if not is_word(word):
        return None
    if isinstance(lexicon, JapaneseLexicon):
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
