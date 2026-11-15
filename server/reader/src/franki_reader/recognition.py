"""How well the words counted as known were actually recognized in a reading: of the text's words
the lexicon counts as known, how many the learner looked up or marked.

Verified coverage (coverage.py) says how much of a text is made of known words, where known means
studied and not waiting for its review. It can't say whether those words come to mind when read:
Anki's own results run below the 90% desired retention, so some are surely missed. A known word
looked up anyway is that miss, seen from the reading side, so a text's *effective* coverage is its
verified coverage less those lookups. It's a floor on the misses (a word not recognized and not
looked up isn't seen) and a little high where a word was tapped from curiosity; read it as a trend.

Display only: the difficulty adaptation (difficulty.py) doesn't read it.
"""

from collections.abc import Iterable
from dataclasses import dataclass

from franki_reader.coverage import Checker, check


@dataclass(frozen=True)
class Recognition:
    tokens: int  # words counted in the text (names and punctuation aren't)
    known_tokens: int  # of those, counted known
    looked_up_tokens: int  # of the known ones, those of a word looked up or marked
    known_types: int  # distinct known words
    looked_up_types: int  # of those, the ones looked up or marked

    @property
    def verified(self) -> float:
        return self.known_tokens / self.tokens if self.tokens else 0.0

    @property
    def effective(self) -> float:
        return (self.known_tokens - self.looked_up_tokens) / self.tokens if self.tokens else 0.0


def measure(lines: Iterable[str], lexicon: Checker, looked_up: Iterable[str]) -> Recognition:
    """`lines` are the text's lines as stored (`|`-split), `looked_up` the words the learner tapped
    or marked, as the reader shows them."""
    tapped = {w.casefold() for w in looked_up}
    tokens = check(lines, lexicon).tokens
    known = [t for t in tokens if t.status == "known"]
    types = {t.text.casefold() for t in known}
    return Recognition(
        tokens=len(tokens),
        known_tokens=len(known),
        looked_up_tokens=sum(1 for t in known if t.text.casefold() in tapped),
        known_types=len(types),
        looked_up_types=len(types & tapped),
    )
