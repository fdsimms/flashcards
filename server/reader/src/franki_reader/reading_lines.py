"""Lines from texts read that use a word, for a card's answer side ("From your reading").

A card shows the one example sentence saved on its note, the same at every review. A word is
learned from meeting it in several contexts, and the learner has already read some: the lines of
texts read to the end. For each word asked about, this finds up to `PER_WORD` of those lines, one a
text, the latest read first, so the app can show a different one at each review.

A line uses a word when one of its tokens is that word's deck entry (`Checker.entry_of`, which
knows an entry's forms), the same test a sentence's target word is checked with (sentences.py).
Read-only: nothing here grades a card or writes a note.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

from franki_reader.coverage import Checker, is_word, parse_line, segment_line
from franki_reader.store import StoredText

# Lines kept for one word: enough to rotate through, few enough to send for a whole session.
PER_WORD = 5
# Words one call can ask about: a study session's cards.
MAX_WORDS = 1000


@dataclass(frozen=True)
class ReadingLine:
    text_id: int
    title: str
    line: str  # plain, as shown
    english: str
    word: str = ""  # the word as the line has it (a form of the entry), for the card to mark


def find(
    words: Iterable[str],
    read: Iterable[tuple[StoredText, datetime]],
    lexicon: Checker,
    per_word: int = PER_WORD,
) -> dict[str, list[ReadingLine]]:
    """For each of `words` (deck entries as the card writes them) with a line in a text read, its
    lines: one a text, the text read last first, at most `per_word`, under the word as it was asked.
    A word with none is left out."""
    # A card's Entry can differ from the lexicon's (a capital, a form): asked by what it resolves to.
    wanted = {(lexicon.entry_of(w) or w): w for w in words}
    found: dict[str, list[ReadingLine]] = {}
    for text, _ in sorted(read, key=lambda pair: pair[1], reverse=True):
        seen: set[str] = set()
        for ln in text.lines:
            plain = parse_line(ln.text, lexicon.spaced)[0]
            for token, is_name in segment_line(ln.text, lexicon):
                if is_name or not is_word(token):
                    continue
                word = lexicon.entry_of(token) or token
                if word not in wanted or word in seen:
                    continue
                seen.add(word)
                lines = found.setdefault(wanted[word], [])
                if len(lines) < per_word:
                    lines.append(ReadingLine(text.id, text.title, plain, ln.english, token))
    return found
