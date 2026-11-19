"""Words to add to a language's deck, for when its new cards are running low (docs/read-and-listen/
architecture.md, Suggested words). Two sources, neither of which asks Claude:

- Words met in the texts read to the end that aren't in the deck: each by its dictionary form, the
  ones in the most texts first. They count as unknown in the texts (`lexicon.status`), so a word the
  `common` setting counts as known is never one.
- The language's most common words the deck lacks, most common first, from just past the `common`
  setting (the words before it count as known already, which the vocabulary check suggested); Thai
  counts no common words, so it starts at the top. English has none: its common words are all
  ones a native speaker knows, and its deck is for the ones they don't (`suggests_common`).

A word is left out when it's in the deck in any form, studied or not, learned in WaniKani (Japanese),
waiting in the note queue, or dismissed with "Not interested" (`store.dismiss_word`). Nothing here
adds a note or grades a card: a word picked in the app goes to the note queue, where Claude fills it
in, and it reaches the deck only when it's saved in the note editor.
"""

import sqlite3
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from franki_reader import store
from franki_reader.coverage import Checker, is_word, segment_line
from franki_reader.frequency import rank_of
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lexicon import Entry, deck_lexicon
from franki_reader.note_queue import MAX_QUEUED
from franki_reader.reader import gloss_for, lemma_for
from franki_reader.spaced import common_lemmas, fold

# The most words each source gives: Quick add's limit, so all of one source can be added at once.
MAX_EACH = MAX_QUEUED


@dataclass(frozen=True)
class Suggestion:
    word: str  # its dictionary form, as the note's Entry would start
    meaning: str  # "" when nothing glosses it yet; Claude writes one in the note queue anyway
    rank: int | None  # its place among the language's most common words, None past the list
    texts: int  # how many texts read to the end it was in; 0 for a common word


def _key(word: str, language: Code) -> str:
    """What two spellings of one word are compared by (case and accents, for a spaced language)."""
    return fold(word, language) if LANGUAGES[language].spaced else word.strip()


def excluded(
    language: Code, entries: Iterable[Entry], wanikani: Iterable[str], others: Iterable[str]
) -> Checker:
    """A checker that knows every word not to suggest: the deck's notes, studied or not, Japanese's
    WaniKani words, and `others` (the queued and the dismissed). Matched as the reader matches a
    word to the deck, so a form (hablé) or an entry with its article (la receta) counts."""
    return deck_lexicon(language, [*(e.text for e in entries), *others], wanikani)


def _left_out(word: str, skip: Checker) -> bool:
    return skip.entry_of(word) is not None or skip.status(word) == "known"


def from_texts(
    texts: Sequence[store.StoredText],
    lexicon: Checker,
    skip: Checker,
    meanings: dict[str, str],
    language: Code,
) -> list[Suggestion]:
    """The words of `texts` that count as unknown (`lexicon`, the reader's own) and that `skip`
    doesn't know, by dictionary form: the most texts first, then the more common, then by word.
    A name is never one."""
    found: dict[str, tuple[str, str, set[int], int | None]] = {}
    for text in texts:
        for line in text.lines:
            for piece, is_name in segment_line(line.text, lexicon):
                if is_name or not is_word(piece) or lexicon.status(piece) == "known":
                    continue
                word = lemma_for(piece, lexicon) or piece
                if _left_out(word, skip) or _left_out(piece, skip):
                    continue
                key = _key(word, language)
                shown, meaning, seen, rank = found.get(key, (word, "", set(), None))
                # Shown as the word is written mid-sentence, not capitalized for starting one.
                if shown != word and word == word.lower():
                    shown = word
                meaning = meaning or gloss_for(piece, text.own_glosses, lexicon, meanings) or ""
                found[key] = (shown, meaning, seen | {text.id}, rank or rank_of(piece, lexicon))
    out = [Suggestion(w, m, r, len(s)) for w, m, s, r in found.values()]
    out.sort(key=lambda s: (-s.texts, s.rank or 10**9, s.word))
    return out[:MAX_EACH]


def from_common(
    language: Code, start: int, skip: Checker, taken: Iterable[str], meanings: dict[str, str]
) -> list[Suggestion]:
    """The language's most common words from place `start` on (0 is the top), leaving out what
    `skip` knows and the words in `taken` (already suggested from texts)."""
    out: list[Suggestion] = []
    seen = {_key(w, language) for w in taken}
    for place, word in enumerate(common_lemmas(language)):
        if place < start:
            continue
        key = _key(word, language)
        if key in seen or _left_out(word, skip):
            continue
        seen.add(key)
        meaning = meanings.get(word) or meanings.get(word.casefold()) or ""
        out.append(Suggestion(word, meaning, place + 1, 0))
        if len(out) >= MAX_EACH:
            break
    return out


def suggest(
    conn: sqlite3.Connection,
    language: Code,
    entries: list[Entry],
    lexicon: Checker,
    wanikani: Iterable[Entry],
    meanings: dict[str, str],
) -> tuple[list[Suggestion], list[Suggestion]]:
    """The words from texts read and the common words for `language` (the module's docstring).
    `entries` and `lexicon` are the reader's snapshot of the deck, `wanikani` Japanese's WaniKani
    words and `meanings` what a word's gloss falls back on (`Engine.meanings`)."""
    queued = [n.entry for n in store.queued_notes(conn) if n.language == language]
    skip = excluded(
        language,
        entries,
        [w.text for w in wanikani],
        [*queued, *store.dismissed_words(conn, language)],
    )
    vocab = {lemma: meaning for lemma, _, meaning, _ in store.vocab_items(conn, language)}
    texts = from_texts(
        [t for t, _ in store.finished_texts(conn, language)], lexicon, skip, meanings, language
    )
    if not LANGUAGES[language].suggests_common:
        return texts, []
    settings = store.load_settings(conn)
    start = settings.common_for(language) if LANGUAGES[language].counts_common else 0
    common = from_common(language, start, skip, [s.word for s in texts], {**meanings, **vocab})
    return texts, common
