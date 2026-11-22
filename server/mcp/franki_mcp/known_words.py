"""
check_words: which of a list of words the collection already has, for a conversation about words met
somewhere else (a game, a show, a sign). One call answers for a whole screenshot's worth of words,
where find_notes would need a call a word and would miss a word seen inflected.

A word is matched against each Omnilanguage note of its language by the note's own fields, never by a
guess at its dictionary form: the Entry, the forms the note lists (the Forms table, KeyForms, Plural,
Genitive, KanaReading), and the verb its AspectPartner names. So "warf ab" finds abwerfen through
KeyForms' "past: warf ab", and a form the note doesn't list isn't found: the description asks Claude to
send the dictionary form as well when it can tell it. A word of several words that matches no note
reports the notes whose Entry is one of its words, and a single word reports a few phrases that use it.

Read-only: it changes nothing and writes nothing.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from anki.collection import Collection  # first: the anki package's modules import each other
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from . import omnilanguage
from .collection import CollectionManager
from .tools import _card_dict, _deck_id, search_text

READ = ToolAnnotations(readOnlyHint=True, openWorldHint=False)

MAX_WORDS = 200
MAX_PHRASES = 3  # phrases listed for a single word that matched no note of its own
MATURE_DAYS = 21  # Anki's: a review card with an interval of 21 days or more is mature

# Words that can come before a form as it's written (the Genitive field's "des Tisches") or as it's
# seen ("die Katze"): matched without them as well as with, so a phrase entry like "la casa" still
# matches as written.
ARTICLES: Mapping[str, frozenset[str]] = {
    "german": frozenset({"der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "eines"}),
    "spanish": frozenset({"el", "la", "los", "las", "un", "una", "unos", "unas"}),
    "french": frozenset({"le", "la", "les", "un", "une", "des"}),
    "greek": frozenset({"ο", "η", "το", "οι", "τα", "του", "της", "των", "τον", "την"}),
    "norwegian": frozenset({"en", "ei", "et", "å"}),
    "polish": frozenset({"ten", "ta", "to", "tej", "ci", "te"}),
}
ELIDED = re.compile(r"^(?:l|d|qu)['’]", re.IGNORECASE)  # French l'homme, d'accord
STRESS = re.compile("[̀́]")  # a Russian stress mark, written over the vowel
BRACKET = re.compile(r"\s*[(\[（].*?[)\]）]")
# KeyForms lines that describe a word rather than give one of its forms.
NOT_A_FORM = frozenset({"pattern", "takes"})

# How a word matched a note, best first.
KINDS = ("entry", "form", "aspect partner", "spelled differently", "part of phrase", "in phrase")
# Languages whose words are also matched loosely (`omnilanguage.loose_spelling`): е for ё, Greek
# without tone marks. Reported as "spelled differently", never as the word itself: все is "all",
# всё "everything".
LOOSE = frozenset({"russian", "greek"})


def _edges_trimmed(text: str) -> str:
    """`text` without punctuation, quotes or spaces at either end. By Unicode category, not \\w: a Thai
    tone mark or a Hindi vowel sign is a mark (Mn), which \\w doesn't cover, and must stay."""
    start, end = 0, len(text)
    while start < end and unicodedata.category(text[start])[0] in "PZS":
        start += 1
    while end > start and unicodedata.category(text[end - 1])[0] in "PZS":
        end -= 1
    return text[start:end]


def normalized(text: str, language: str) -> str:
    """A word as it's compared: plain text, one space between words, lowercase, full-width letters
    made ordinary (NFKC), a Russian stress mark taken off, punctuation at the ends dropped."""
    text = unicodedata.normalize("NFKC", omnilanguage.plain(text)).replace("\n", " ")
    if language == "russian":
        text = unicodedata.normalize("NFC", STRESS.sub("", unicodedata.normalize("NFD", text)))
    text = re.sub(r"\s+", " ", text).lower()
    return " ".join(w for w in (_edges_trimmed(w) for w in text.split(" ")) if w)


def keys(text: str, language: str) -> set[str]:
    """What `text` is looked up by: as written, and without a leading article or elided article."""
    word = normalized(text, language)
    if not word:
        return set()
    out = {word}
    first, _, rest = word.partition(" ")
    if rest and first in ARTICLES.get(language, ()):
        out.add(rest)
    if language == "french" and (bare := ELIDED.sub("", word)) != word and bare:
        out.add(bare)
    return out


def _form_values(line: str) -> list[str]:
    """The forms one "label: form" line gives (several when joined by "/"), without a bracket."""
    label, sep, value = line.partition(":")
    if not sep:
        value = label
    elif label.strip().lower() in NOT_A_FORM:
        return []
    return [v for v in (BRACKET.sub("", part).strip() for part in value.split("/")) if v]


def note_forms(fields: Mapping[str, str]) -> tuple[list[str], list[str]]:
    """A note's own forms (its Entry first) and the aspect partner it names, each as written."""
    own = [fields.get("Entry", "")]
    own.append(fields.get("KanaReading", ""))
    for name in ("Plural", "Genitive"):
        if (value := omnilanguage.plain(fields.get(name, ""))) != omnilanguage.NO_FORM:
            own += [BRACKET.sub("", v).strip() for v in value.split("/")]
    for name in ("Forms", "KeyForms"):
        for line in omnilanguage.plain(fields.get(name, "")).split("\n"):
            own += _form_values(line)
    partner = omnilanguage.plain(fields.get("AspectPartner", ""))
    return [f for f in own if f.strip()], [partner] if partner and partner != omnilanguage.NO_FORM else []


@dataclass
class Index:
    """One language's notes, by every key they can be found by."""

    entries: dict[str, set[int]] = field(default_factory=dict)
    forms: dict[str, set[int]] = field(default_factory=dict)
    partners: dict[str, set[int]] = field(default_factory=dict)
    # A phrase entry's words, for "in phrase": word -> notes whose Entry has that word among several.
    phrase_words: dict[str, set[int]] = field(default_factory=dict)
    # Entries and forms by their loose spelling, in `LOOSE` languages, for "spelled differently".
    loose: dict[str, set[int]] = field(default_factory=dict)

    def add(self, nid: int, fields: Mapping[str, str], language: str) -> None:
        own, partners = note_forms(fields)
        for k in keys(own[0], language):
            self.entries.setdefault(k, set()).add(nid)
        for form in own[1:]:
            for k in keys(form, language):
                self.forms.setdefault(k, set()).add(nid)
        for form in partners:
            for k in keys(form, language):
                self.partners.setdefault(k, set()).add(nid)
        if language in LOOSE:
            for form in own:
                for k in keys(form, language):
                    self.loose.setdefault(omnilanguage.loose_spelling(k), set()).add(nid)
        entry = normalized(own[0], language)
        if " " in entry:
            for word in entry.split(" "):
                self.phrase_words.setdefault(word, set()).add(nid)

    def look_up(self, word: str, language: str) -> list[tuple[int, str]]:
        """The notes `word` names, each with how it matched, best match first and each note once."""
        found: dict[int, str] = {}

        def take(nids: Iterable[int], kind: str) -> None:
            for nid in sorted(nids):
                found.setdefault(nid, kind)

        ks = keys(word, language)
        for kind, table in (("entry", self.entries), ("form", self.forms), ("aspect partner", self.partners)):
            for k in ks:
                take(table.get(k, ()), kind)
        if found:
            return list(found.items())
        if language in LOOSE:
            for k in ks:
                take(self.loose.get(omnilanguage.loose_spelling(k), ()), "spelled differently")
            if found:
                return list(found.items())
        whole = normalized(word, language)
        if " " in whole:
            # A phrase the deck doesn't have: the words in it that it does.
            for part in whole.split(" "):
                for k in keys(part, language):
                    take(self.entries.get(k, ()), "part of phrase")
                    take(self.forms.get(k, ()), "part of phrase")
        else:
            take(sorted(self.phrase_words.get(whole, ()))[:MAX_PHRASES], "in phrase")
        return list(found.items())


def status(cards: list[dict[str, Any]]) -> str:
    """How well a note is known, from its cards: the furthest along of those not suspended."""
    live = [c for c in cards if c["stage"] != "suspended"]
    if not live:
        return "suspended" if cards else "no cards"
    if any(c["stage"] == "review" and c["interval_days"] >= MATURE_DAYS for c in live):
        return "mature"
    if any(c["stage"] == "review" for c in live):
        return "young"
    if any(c["stage"] in ("learning", "relearning") for c in live):
        return "learning"
    if all(c["stage"] == "new" for c in live):
        return "new"
    return "buried"


def language_key(language: str) -> str:
    key = omnilanguage.LANGUAGE_NAMES.get(language.strip().lower())
    if not key:
        raise ToolError(f'"{language}" isn\'t a language the Omnilanguage notes use. One of: {", ".join(omnilanguage.LANGUAGES)}.')
    return key


def register(server: MCPServer, cm: CollectionManager) -> None:
    @server.tool(annotations=READ)
    async def check_words(language: str, words: list[str], deck: str | None = None) -> dict[str, Any]:
        """Which of these words the collection already has, and how well each is known: one call for
        every word in a screenshot or a scene, before suggesting cards for them. Each word lists the
        Omnilanguage notes it matches, with the note's Entry, Meaning, deck, tags, `status` (new,
        learning, young, mature, suspended), and its cards' stage, interval and lapses. An empty
        `matches` means it isn't in the collection.
        - `language`: the notes' Language, as note_guide takes it (german, thai, polish...).
        - `words`: up to 200, as seen. A word is matched by the note's Entry and the forms the note
          lists (its Forms table, KeyForms, Plural, Genitive, KanaReading), so an inflected form is
          found only when the note lists it: send the dictionary form as well whenever you can tell
          it ("warf" and "abwerfen"). Articles and punctuation are ignored.
        - `matched` says how: entry; form (one of the note's listed forms); aspect partner (the
          note's verb names this one as its other aspect: the word itself may still need a note);
          spelled differently (Russian or Greek only: the same letters once е and ё, or Greek's tone
          marks, are set aside, as a screen often writes them; may be the same word or another, as
          все "all" and всё "everything", so check the note before calling the word known);
          part of phrase (a phrase with no note of its own, and a note for one of its words); in
          phrase (a single word with no note of its own, used in a few phrase notes).
        - `deck` limits the search to one deck and its subdecks.
        A note's tags say where its word came from (`source::` tags, note_guide)."""
        key = language_key(language)
        if not words:
            raise ToolError("Send at least one word.")
        if len(words) > MAX_WORDS:
            raise ToolError(f"Up to {MAX_WORDS} words a call; send the rest in another.")

        def run(col: Collection) -> dict[str, Any]:
            nt = col.models.by_name(omnilanguage.NOTE_TYPE)
            if not nt:
                raise ToolError("The collection has no Omnilanguage note type, which is what check_words reads.")
            names = [f["name"] for f in nt["flds"]]
            if "Language" not in names:
                raise ToolError("The Omnilanguage note type has no Language field, so words can't be told apart by language.")
            rows = col.db.all("select id, flds from notes where mid = ?", nt["id"])
            if deck is not None:
                did = _deck_id(col, deck)
                within = set(col.find_notes(f'"deck:{search_text(col.decks.name(did))}"'))
                rows = [r for r in rows if r[0] in within]
            index = Index()
            searched = 0
            for nid, flds in rows:
                fields = dict(zip(names, flds.split("\x1f")))
                said = omnilanguage.plain(fields.get("Language", "")).lower()
                if omnilanguage.LANGUAGE_NAMES.get(said) == key:
                    index.add(nid, fields, key)
                    searched += 1
            shown: dict[int, dict[str, Any]] = {}

            def summary(nid: int) -> dict[str, Any]:
                if nid not in shown:
                    note = col.get_note(nid)
                    cards = [_card_dict(col, c) for c in note.cards()]
                    shown[nid] = {
                        "note_id": nid,
                        "entry": omnilanguage.plain(note["Entry"]) if "Entry" in note else "",
                        "meaning": omnilanguage.plain(note["Meaning"]) if "Meaning" in note else "",
                        "deck": cards[0]["deck"] if cards else None,
                        "tags": note.tags,
                        "status": status(cards),
                        "cards": [{k: c[k] for k in ("card_type", "stage", "interval_days", "lapses", "due")} for c in cards],
                    }
                return shown[nid]

            out = []
            for word in words:
                matches = [{"matched": kind, **summary(nid)} for nid, kind in index.look_up(word, key)]
                out.append({"word": word, "matches": matches})
            have = sum(1 for w in out if any(m["matched"] in ("entry", "form") for m in w["matches"]))
            return {"language": key, "notes_searched": searched, "in_collection": have,
                    "not_in_collection": len(out) - have, "words": out}

        return await cm.read(run)

