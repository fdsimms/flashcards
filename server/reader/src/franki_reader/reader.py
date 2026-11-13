"""A stored text as the app shows it: each line split into the pieces the server segmented, so a
tap always lands on something the lexicon or the gloss list knows about (docs/read-and-listen/architecture.md,
Generation and coverage)."""

import re
from typing import Any

from franki_reader import form_primers, grammar
from franki_reader.coverage import Checker, is_word, parse_line, segment_line
from franki_reader.frequency import rank_of
from franki_reader.japanese import JapaneseLexicon
from franki_reader.spaced import fold, lemma
from franki_reader.split_verbs import join_split_verbs
from franki_reader.store import StoredText


def gloss_for(
    word: str, glosses: dict[str, str], lexicon: Checker, meanings: dict[str, str]
) -> str | None:
    """The text's own gloss (`StoredText.own_glosses`: the model's, or the meaning asked for it in
    its line here, meanings.py), as written or in lower case, else the deck's meaning (of the entry
    it's a form of, so hablé gets hablar's), else the meaning kept for the word in lower case (the
    language's fallback, for a text with none of its own), else, in Japanese, its dictionary form's (a
    WaniKani word's meaning is kept by its dictionary form, and 食べました has none of its own).

    A compound known only by splitting into deck entries (เข้าใจ, เข้า + ใจ) has no gloss from them:
    its parts' meanings ("enter + heart") are often not its own ("understand"), so it needs one of
    its own like any other word, and `parts_for` gives the parts, labeled as such."""
    entry = lexicon.entry_of(word)
    lemma = lexicon.lemma_of(word) if isinstance(lexicon, JapaneseLexicon) else None
    return (
        glosses.get(word)
        or glosses.get(word.casefold())
        or meanings.get(word)
        or (meanings.get(entry) if entry else None)
        or meanings.get(word.casefold())
        or (meanings.get(lemma) if lemma else None)
        or None
    )


def parts_for(word: str, lexicon: Checker, meanings: dict[str, str]) -> str | None:
    """The meanings of the deck entries a known compound splits into ("enter + heart" for เข้าใจ),
    for a word with no gloss of its own: the app shows them labeled as its parts, never as its
    meaning. None for a word that isn't known by splitting, or a part with no meaning."""
    pieces = lexicon.known_pieces(word)
    parts = [meanings[p] for p in pieces or [] if meanings.get(p)]
    return " + ".join(parts) if pieces and len(parts) == len(pieces) else None


def lemma_for(word: str, lexicon: Checker) -> str | None:
    """The dictionary form of a word (rozumiem to rozumieć): the deck entry it's a form of, else
    simplemma's lemma (Sudachi's dictionary form in Japanese: 行きました to 行く). None for Thai, which
    has no inflection, and when the word is its own lemma."""
    if isinstance(lexicon, JapaneseLexicon):
        return lexicon.lemma_of(word) if is_word(word) else None
    if not lexicon.spaced or not is_word(word):
        return None
    code: str = getattr(lexicon, "code", "")
    entry = lexicon.entry_of(word)
    if entry is None and (not code or " " in word.strip()):
        return None
    found = entry or lemma(word, code)
    # The entry as written may carry an article (la ojiva): the word on its own is its form already.
    return None if fold(word, code) in fold(found, code).split() else found


def from_wanikani(word: str, lexicon: Checker) -> bool:
    """Whether a Japanese word is known for being learned in WaniKani, not from the deck or for
    being common: the app says so rather than calling it a common word."""
    return isinstance(lexicon, JapaneseLexicon) and lexicon.from_wanikani(word)


def translit_for(
    word: str, translits: dict[str, str], lexicon: Checker, deck: dict[str, str]
) -> str | None:
    """The deck note's transliteration (of the entry the word is a form of), else the one the model
    wrote for the text, else the deck entries' joined when a known compound splits into them. None
    when there's nothing to show, so the app offers no reveal rather than an empty one.

    Japanese reads each word as it's written here: the deck's KanaReading only for the entry itself
    (a conjugated form reads differently: 破った is やぶった, not やぶる), else Sudachi's reading."""
    if isinstance(lexicon, JapaneseLexicon):
        return deck.get(word) or lexicon.reading_of(word)
    entry = lexicon.entry_of(word)
    if found := deck.get(word) or (deck.get(entry) if entry else None) or translits.get(word):
        return found
    pieces = lexicon.known_pieces(word)
    parts = [deck[p] for p in pieces or [] if p in deck]
    return " + ".join(parts) if pieces and len(parts) == len(pieces) else None


def word_out(
    piece: str,
    lexicon: Checker,
    meanings: dict[str, str],
    deck_translits: dict[str, str],
    *,
    is_name: bool = False,
    glosses: dict[str, str] | None = None,
    translits: dict[str, str] | None = None,
    stretch: set[str] | None = None,
    point: str | None = None,
    form: dict[str, str] | None = None,
) -> dict[str, Any]:
    """One piece of a line as the app draws it (`Word` in src/reader/api.ts): a word with its
    meaning (or, for a compound with none, its parts' meanings), dictionary form, pronunciation and
    status, or a space or punctuation (status None), which is shown but never tapped. `glosses` and
    `translits` are a text's own, `stretch` its practice words, `point` the grammar point the word
    uses, `form` its grammatical form as {"id", "name"} (the app's chip and primer, form_primers.py)."""
    if not is_word(piece):
        return {
            "text": piece,
            "status": None,
            "gloss": None,
            "parts": None,
            "lemma": None,
            "translit": None,
            "stretch": False,
            "deck": False,
            "wanikani": False,
            "rank": None,
            "grammar": None,
            "form": None,
        }
    entry = lexicon.entry_of(piece)
    gloss = gloss_for(piece, glosses or {}, lexicon, meanings)
    return {
        "text": piece,
        "status": "name" if is_name else lexicon.status(piece),
        "gloss": gloss,
        "parts": None if gloss or is_name else parts_for(piece, lexicon, meanings),
        "lemma": lemma_for(piece, lexicon),
        "translit": translit_for(piece, translits or {}, lexicon, deck_translits),
        "stretch": (entry or piece) in (stretch or set()),
        # A deck word, as against one known for being common (every language but Thai).
        "deck": entry is not None,
        "wanikani": not is_name and from_wanikani(piece, lexicon),
        # Its place among the language's most common words; None past the list's end.
        "rank": None if is_name else rank_of(piece, lexicon),
        "grammar": point,
        "form": form,
    }


def render_sentence(
    sentence: str, lexicon: Checker, meanings: dict[str, str], deck_translits: dict[str, str]
) -> list[dict[str, Any]]:
    """A card's example sentence split and glossed as a text's line is, for the card's word
    popovers. The sentence is plain text, not a model line: `|`, `*` and `~` mean nothing in it.
    The pieces join back to the sentence as segmented, which the app checks before using them."""
    words = [word_out(p, lexicon, meanings, deck_translits) for p in lexicon.segment(sentence)]
    join_split_verbs(words, lexicon, meanings, deck_translits, set())
    return words


_REFLEXIVE_PRONOUNS = frozenset({"me", "te", "se", "nos", "os"})


def mark_reflexive_pronouns(words: list[dict[str, Any]], lexicon: Checker) -> None:
    """A practice word that's a reflexive verb (agacharse) also marks the pronoun just before its
    form ("se agacha"), since the pronoun is part of the word. A form that's joined to its pronoun
    (agacharse, agáchate) is one token already, so only a separate pronoun needs this."""
    reflexive = getattr(getattr(lexicon, "rules", None), "reflexive", "")
    if not reflexive:
        return
    for i, word in enumerate(words):
        if not word["stretch"] or not word["lemma"]:
            continue
        if not re.search(rf"[aei]r{reflexive}$", word["lemma"].lower()):
            continue
        before = i - 1
        while before >= 0 and words[before]["text"].isspace():
            before -= 1
        if before >= 0 and words[before]["text"].lower() in _REFLEXIVE_PRONOUNS:
            words[before]["stretch"] = True


def render_line(
    source: str,
    text: StoredText,
    lexicon: Checker,
    meanings: dict[str, str],
    deck_translits: dict[str, str] | None = None,
    marked: dict[int, str] | None = None,
    forms: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """A model line written for `text` (one of its lines, a choice, its recap) as the reader's
    words, glossed from the text's own glosses and translits first. `marked` is the grammar point
    each word uses, by index among the line's words. `forms` is the text's picked word forms, for its
    own lines: a choice or a recap wasn't asked about, so it shows none."""
    marked = marked or {}
    stretch = set(text.stretch)
    form_names = form_primers.names(text.language)

    def form_of(piece: str) -> dict[str, str] | None:
        """The form a word is marked as in this text, if it's still one the catalog has."""
        found = (forms or {}).get(piece.casefold())
        if found is None or found not in form_names:
            return None
        return {"id": found, "name": form_names[found]}

    at = 0
    words: list[dict[str, Any]] = []
    for piece, is_name in segment_line(source, lexicon):
        point = None
        if is_word(piece):
            covers = grammar.count_words(piece, lexicon.spaced)
            point = next((marked[i] for i in range(at, at + covers) if i in marked), None)
            at += covers
        words.append(
            word_out(
                piece,
                lexicon,
                meanings,
                deck_translits or {},
                is_name=is_name,
                glosses=text.own_glosses,
                translits=text.translits,
                stretch=stretch,
                point=point,
                form=form_of(piece),
            )
        )
    mark_reflexive_pronouns(words, lexicon)
    join_split_verbs(words, lexicon, meanings, deck_translits or {}, stretch)
    return words


def render(
    text: StoredText,
    lexicon: Checker,
    meanings: dict[str, str],
    deck_translits: dict[str, str] | None = None,
    unset: tuple[str, ...] = (),
) -> dict[str, Any]:
    """`unset` is the language's grammar points the owner hasn't marked, as of now: any that turn
    up are marked and explained like the known ones worked in for review."""
    practice = tuple(text.grammar.get("practice", []))
    avoid = tuple(text.grammar.get("avoid", []))
    review = tuple(p for p in text.grammar.get("review", []) if p not in practice + avoid)
    unset = tuple(p for p in unset if p not in practice + avoid + review)
    used: set[str] = set()

    def render_words(source: str, marked: dict[int, str]) -> list[dict[str, Any]]:
        return render_line(source, text, lexicon, meanings, deck_translits, marked, text.forms)

    lines = []
    for line in text.lines:
        plain, _ = parse_line(line.text, lexicon.spaced)
        # Which words use a marked point, by index among the line's words; the first role wins.
        marked = grammar.marks(plain, lexicon, practice + avoid + review + unset)
        used.update(marked.values())
        lines.append(
            {
                "speaker": line.speaker,
                "english": line.english,
                "paragraph": line.paragraph,
                "register": line.register,
                "words": render_words(line.text, marked),
            }
        )
    return {
        "id": text.id,
        "topicId": text.topic_id,
        "title": text.title,
        "coverage": text.coverage,
        "stretch": list(text.stretch),
        "roles": text.roles,
        "genders": text.genders,
        "characters": text.characters,
        "form": text.form,
        "language": text.language,
        # The grammar this text was written to practice or avoid, for the reader's notes, then the
        # known points worked in and the unmarked ones that turned up, where a word uses them.
        "grammar": [
            {
                "id": pid,
                "name": grammar.POINTS[pid].name,
                "note": grammar.POINTS[pid].note,
                "role": role,
            }
            for role, ids in (
                ("practice", practice),
                ("avoid", avoid),
                ("review", tuple(p for p in review if p in used)),
                ("unset", tuple(p for p in unset if p in used)),
            )
            for pid in ids
            if pid in grammar.POINTS
        ],
        "lines": lines,
        # What the reader can pick to happen in the next episode (a story episode only), as words
        # like a line's but with no grammar marks, and the index picked so far.
        "choices": [
            {"english": c.english, "words": render_words(c.text, {})} for c in text.choices
        ],
        "chosen": text.chosen,
        # Questions about what happens, for the check after reading (comprehension.py): each in the
        # text's language with its English, the line that answers it (from 0), and the right choice.
        "questions": [q.as_json() for q in text.questions],
    }
