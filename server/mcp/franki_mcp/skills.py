"""
Franki's skill cards (src/tools/skills.ts): drills for time, numbers, dates and money, a card each for
Thai's consonants and vowels, classifiers and cases. Franki adds them to a language deck's `::Skills`
subdeck when the learner taps Add now, together with the words the drills are said in that the deck
lacks (the months and weekdays for dates; src/tools/skillWords.ts). This module adds the same cards and
words by itself for a deck whose automatic switch is on, and lets Claude read and change a deck's settings.

The cards come from `skill_catalog.json`, which the app writes out of its own skill definitions
(src/tools/skillCatalog.ts, `npm run catalog:skills`; a test fails when the file is stale), so there is
no second copy of their text here. A deck's settings are one collection config value, the way the
progress gates are kept: a JSON object from the deck's id to `{"on", "auto", "off"}`
(src/anki/skillSettings.ts says what each means). Franki reads and writes the same key.
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import anyio

from anki.collection import Collection  # first: the anki package's modules import each other
from anki.consts import QUEUE_TYPE_SUSPENDED
from anki.notes import NoteFieldsCheckResult
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from .collection import CollectionManager
from .tools import READ, WRITE, _deck_id, search_text

SKILL_CARDS_KEY = "frankiSkillCards"  # SKILL_CARDS_KEY in src/anki/skillSettings.ts
FIRST_RUN_DELAY = 5 * 60
EVERY = 60 * 60

log = logging.getLogger(__name__)
CATALOG: dict[str, Any] = json.loads((Path(__file__).parent / "skill_catalog.json").read_text(encoding="utf-8"))
NOTE_TYPE = CATALOG["noteType"]
WORD_NOTE_TYPE = CATALOG["wordNoteType"]
TAG = CATALOG["tag"]
# Anki's `tag:skill` also matches its children, so the words (tagged skill::words) are left out of every search for the skill cards.
NOT_WORDS = f"-tag:{TAG}::words"
SUBDECK = CATALOG["subdeck"]
DRILL_TAG = f"{TAG}::drill::"
GROUP_IDS = {g["id"] for lang in CATALOG["languages"].values() for g in lang["groups"]}


@dataclass(frozen=True)
class Settings:
    """A deck's settings. `on` is the master switch, `auto` lets the daily job add cards, `off` lists the skills switched off."""

    on: bool = True
    auto: bool = False
    off: tuple[str, ...] = ()


def _settings_of(v: Any) -> Settings:
    o = v if isinstance(v, dict) else {}
    off = o.get("off")
    return Settings(
        on=o["on"] if isinstance(o.get("on"), bool) else True,
        auto=o["auto"] if isinstance(o.get("auto"), bool) else False,
        off=tuple(sorted({g for g in off if g in GROUP_IDS})) if isinstance(off, list) else (),
    )


def read_settings(col: Collection, deck_id: int) -> Settings:
    raw = col.get_config(SKILL_CARDS_KEY, {}) or {}
    return _settings_of(raw.get(str(deck_id))) if isinstance(raw, dict) else Settings()


def save_settings(col: Collection, deck_id: int, s: Settings) -> None:
    """Saves them, the defaults removing the deck's entry, as the app does."""
    raw = col.get_config(SKILL_CARDS_KEY, {}) or {}
    all_ = dict(raw) if isinstance(raw, dict) else {}
    if s == Settings():
        all_.pop(str(deck_id), None)
    else:
        all_[str(deck_id)] = {"on": s.on, "auto": s.auto, "off": list(s.off)}
    col.set_config(SKILL_CARDS_KEY, all_)


def _wordy(ch: str) -> bool:
    """A letter, mark or digit, as the app's `WORDY` (\\p{L}\\p{M}\\p{N}) tests."""
    return unicodedata.category(ch)[0] in "LMN"


# Scripts written without spaces between words, where a name is found inside a longer run (`UNSPACED`).
_UNSPACED = re.compile("[\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff]")


def language_of_deck(name: str) -> str | None:
    """The language a deck's name means, as the app reads it (`deckNameLanguage` in src/core/cards.ts):
    a language's name as a word of its own, one level at a time from the top, the first name in the
    first level that has one. `test_skills.py` checks it against the catalog's `deckExamples`."""
    for level in unicodedata.normalize("NFC", name).lower().split("::"):
        best: tuple[int, int, str | None] | None = None
        for raw_key, language in CATALOG["deckKeys"]:
            key = unicodedata.normalize("NFC", raw_key)
            spaced = not _UNSPACED.search(key)
            at = level.find(key)
            while at >= 0:
                end = at + len(key)
                if spaced and ((at > 0 and _wordy(level[at - 1])) or (end < len(level) and _wordy(level[end]))):
                    at = level.find(key, at + 1)
                    continue
                if best is None or at < best[0] or (at == best[0] and len(key) > best[1]):
                    best = (at, len(key), language)
                break
        if best is not None:
            return best[2]
    return None


def _groups(language: str) -> list[dict[str, Any]]:
    return CATALOG["languages"][language]["groups"]


def _have_fronts(col: Collection) -> set[str]:
    """The first fields of the skill cards the collection has, which is how a card counts as added."""
    out: set[str] = set()
    for nid in col.find_notes(f'"note:{search_text(NOTE_TYPE)}" tag:{TAG} {NOT_WORDS}'):
        try:
            out.add(col.get_note(nid)["Front"])
        except KeyError:
            continue
    return out


def _missing(col: Collection, language: str, off: tuple[str, ...]) -> list[dict[str, Any]]:
    have = _have_fronts(col)
    return [n for g in _groups(language) if g["id"] not in off for n in g["notes"] if n["front"] not in have]


def _norm_word(w: str) -> str:
    return unicodedata.normalize("NFC", w).lower().strip()


def _headwords(col: Collection, deck_name: str) -> set[str]:
    """What the deck's own notes have as words (the skill words included, so one added already isn't added again): each note's Entry, and each word in it, as `knownAmong` reads them in the app (src/tools/skillWords.ts)."""
    have: set[str] = set()
    for nid in col.find_notes(f'"deck:{search_text(deck_name)}" "note:{search_text(WORD_NOTE_TYPE)}"'):
        try:
            entry = col.get_note(nid)["Entry"]
        except KeyError:
            continue
        text = _norm_word(re.sub(r"<[^>]*>", " ", entry))
        have.add(text)
        have.update(w for w in re.split(r"[\W_]+", text) if w)
    return have


def _can_write_words(col: Collection) -> bool:
    """Whether the collection has the note type the words are written in, with the fields they use."""
    wnt = col.models.by_name(WORD_NOTE_TYPE)
    return bool(wnt) and {"Entry", "Meaning"} <= {f["name"] for f in wnt["flds"]}


def _missing_words(col: Collection, deck_name: str, language: str, off: tuple[str, ...]) -> list[dict[str, Any]]:
    """The words the skills that are on need that the deck lacks, in any of its subdecks, studied or not."""
    # A word two skills need (a hundred: numbers and money) is one note.
    wanted = {_norm_word(w["fields"]["Entry"]): w for g in _groups(language) if g["id"] not in off for w in g["words"]}
    if not wanted:
        return []
    have = _headwords(col, deck_name)
    return [w for key, w in wanted.items() if key not in have]


def add_missing(col: Collection, deck_name: str, language: str, off: tuple[str, ...]) -> dict[str, Any]:
    """Adds the cards of the skills that are on and the deck lacks, as the app's Add now does: Basic notes in `<deck>::Skills`, later drill steps suspended."""
    nt = col.models.by_name(NOTE_TYPE)
    if not nt or not {"Front", "Back"} <= {f["name"] for f in nt["flds"]}:
        raise ToolError(
            f"Skill cards need a {NOTE_TYPE} note type with Front and Back fields, and the collection doesn't have one. "
            "In Anki on the computer, add one (Tools, Manage Note Types, Add, then Add: Basic), sync, and try again."
        )
    subdeck = f"{deck_name}::{SUBDECK}"
    todo = _missing(col, language, off)
    words = _missing_words(col, deck_name, language, off)
    if not todo and not words:
        return {"deck": subdeck, "added": 0, "words": 0, "words_skipped": 0, "skipped": 0}
    # Without the note type the words are written in, the cards are added and the words reported as not added: the steps that wait for them come in once the learner knows them.
    wnt = col.models.by_name(WORD_NOTE_TYPE) if words else None
    words_skipped = 0
    if words and not _can_write_words(col):
        words_skipped, words = len(words), []
    did = col.decks.id_for_name(subdeck) or col.decks.id(subdeck)
    added = skipped = 0
    suspend: list[int] = []
    for n in todo:
        note = col.new_note(nt)
        note["Front"], note["Back"] = n["front"], n["back"]
        note.tags = list(n["tags"])
        # Another note of the type with the same first field is there already, in all but its tags.
        if note.fields_check() != NoteFieldsCheckResult.NORMAL:
            skipped += 1
            continue
        col.add_note(note, did)
        added += 1
        if n["suspended"]:
            suspend += [c.id for c in note.cards()]
    if suspend:
        col.sched.suspend_cards(suspend)
    # The words the drills are said in, tagged so Franki's Review brings some up each day (SKILL_WORDS_TAG).
    added_words = 0
    for w in words:
        note = col.new_note(wnt)
        for name, value in w["fields"].items():
            if name in note:
                note[name] = value
        note.tags = list(w["tags"])
        # The same Entry in another language's note ("mars" in French and Norwegian) is no reason to leave the word out: Anki
        # allows it and only warns. One in this deck is already counted as the word being there (`_headwords`).
        col.add_note(note, did)
        added_words += 1
    return {"deck": subdeck, "added": added, "words": added_words, "words_skipped": words_skipped, "skipped": skipped}


def set_paused(col: Collection, deck_name: str, paused: bool) -> int:
    """Suspends every skill card in the deck, or resumes them: all but a later drill step, which waits for Franki's Review to release it once the step before has settled. Returns how many cards changed."""
    later = {f"{DRILL_TAG}{s}" for s in CATALOG["laterSteps"]}
    ids: list[int] = []
    for nid in col.find_notes(f'"deck:{search_text(deck_name)}" tag:{TAG} {NOT_WORDS}'):
        note = col.get_note(nid)
        waits = any(t.lower() in later for t in note.tags)
        for card in note.cards():
            if paused and card.queue != QUEUE_TYPE_SUSPENDED:
                ids.append(card.id)
            elif not paused and card.queue == QUEUE_TYPE_SUSPENDED and not waits:
                ids.append(card.id)
    if ids:
        (col.sched.suspend_cards if paused else col.sched.unsuspend_cards)(ids)
    return len(ids)


def _state(col: Collection, deck_id: int, name: str, language: str) -> dict[str, Any]:
    s = read_settings(col, deck_id)
    have = _have_fronts(col)
    headwords = _headwords(col, name) if any(g["words"] for g in _groups(language)) else set()
    skills = [
        {
            "id": g["id"], "title": g["title"], "on": g["id"] not in s.off,
            "cards": len(g["notes"]), "missing": sum(1 for n in g["notes"] if n["front"] not in have),
            "words_missing": sum(1 for w in g["words"] if _norm_word(w["fields"]["Entry"]) not in headwords),
        }
        for g in _groups(language)
    ]
    return {
        "deck": name, "language": CATALOG["languages"][language]["name"], "on": s.on, "auto": s.auto, "skills": skills,
        "missing": sum(k["missing"] for k in skills if k["on"]),
        "words_missing": len(_missing_words(col, name, language, s.off)),
    }


def _work(col: Collection) -> list[tuple[str, str, tuple[str, ...]]]:
    """The decks whose automatic switch is on, with cards to add: (name, language, skills off)."""
    out = []
    raw = col.get_config(SKILL_CARDS_KEY, {}) or {}
    for key in raw if isinstance(raw, dict) else []:
        s = _settings_of(raw[key])
        if not (s.on and s.auto) or not key.isdigit() or not (deck := col.decks.get(int(key), default=False)):
            continue
        name = deck["name"]
        language = language_of_deck(name)
        # Words that can't be written (no note type for them) are no work: the pass would change nothing, every hour.
        if language and (_missing(col, language, s.off) or (_can_write_words(col) and _missing_words(col, name, language, s.off))):
            out.append((name, language, s.off))
    return out


async def auto_add(cm: CollectionManager) -> int:
    """One pass of the daily job: the cards, and the words they need, every deck with automatic adding on lacks. Returns how many notes were added."""
    if not await cm.read(_work):
        return 0  # nothing to write, so no change to send

    def run(col: Collection) -> int:
        return sum(r["added"] + r["words"] for r in (add_missing(col, name, language, off) for name, language, off in _work(col)))

    return await cm.write(run)


async def auto_add_loop(cm: CollectionManager, first_delay: float = FIRST_RUN_DELAY, every: float = EVERY) -> None:
    """Every hour, adds the skill cards decks with automatic adding on lack (the app's Skill cards screen turns it on; `set_skill_cards` does too)."""
    await anyio.sleep(first_delay)
    while True:
        try:
            if added := await auto_add(cm):
                log.info("skill cards added: %d", added)
        except Exception:  # noqa: BLE001 - a failed run waits for the next one
            log.exception("skill cards auto-add failed")
        await anyio.sleep(every)


def _skill_deck(col: Collection, name: str) -> tuple[int, str, str]:
    did = _deck_id(col, name)
    real = col.decks.name(did)
    language = language_of_deck(real)
    if not language:
        raise ToolError(
            f'"{real}" has no language in its name, so there are no skill cards to offer. Skill cards come for a deck named after '
            "its language, such as Thai or Polski."
        )
    return did, real, language


def register(server: MCPServer, cm: CollectionManager) -> None:
    """The skill card tools: skill_cards, set_skill_cards and add_skill_cards."""

    @server.tool(annotations=READ)
    async def skill_cards(deck: str = "") -> dict[str, Any]:
        """Franki's skill cards for a language deck: drills for telling the time, numbers, dates and money
        (a ladder of steps, each a card that Franki's Review turns into a short drill), a card each for
        Thai's consonant classes and vowel length, classifiers or counters, and which case follows a
        preposition. Says for each deck its three settings (`on`: the master switch, off means every skill
        card is suspended; `auto`: the server adds missing cards by itself every hour; each skill's `on`),
        and how many cards each skill still `missing`, and how many `words_missing` (the words the drills
        are said in, such as months, weekdays and Norwegian's day ordinals: the server adds them to the deck too, tagged skill::words, and Franki
        brings some up each day; a drill starts once its words are known, each card's next review a week or more out). With no deck, every language deck. To remove skill
        cards for good, find_notes "deck:<name> tag:skill -tag:skill::words" and delete_notes (the words stay: they are the deck's own); set auto to false first, or the
        server adds them again."""

        def run(col: Collection) -> dict[str, Any]:
            if deck:
                did, name, language = _skill_deck(col, deck)
                return {"decks": [_state(col, did, name, language)]}
            found = []
            for d in sorted(col.decks.all_names_and_ids(), key=lambda d: d.name):
                # The top deck of a language: not the Skills subdeck or another subdeck under one that has it.
                if language_of_deck(d.name) and not any(language_of_deck(p) for p in _parents(d.name)):
                    found.append(_state(col, d.id, d.name, language_of_deck(d.name)))  # type: ignore[arg-type]
            return {"decks": found}

        return await cm.read(run)

    @server.tool(annotations=WRITE)
    async def set_skill_cards(deck: str, on: bool | None = None, auto: bool | None = None, skills_off: list[str] | None = None) -> dict[str, Any]:
        """Changes a language deck's skill card settings, which Franki picks up at its next sync. Only what
        is given changes. `on` false pauses: every skill card in the deck is suspended and nothing is added;
        true resumes them (a later drill step, and the first dates step, stay suspended until Franki's Review releases them, once the
        step before has settled). `auto` true lets the server add the cards of the skills that are on by
        itself every hour, including cards from later app updates; turn it on only after the user has seen
        what add_skill_cards would add. `skills_off` replaces the list of skills switched off (ids from
        skill_cards; [] switches all on); switching a skill off only stops adding its cards."""

        def run(col: Collection) -> dict[str, Any]:
            did, name, language = _skill_deck(col, deck)
            known = {g["id"] for g in _groups(language)}
            if skills_off is not None and (bad := [g for g in skills_off if g not in known]):
                raise ToolError(f"{name} has no skill {', '.join(repr(b) for b in bad)}. Its skills: {', '.join(sorted(known))}.")
            was = read_settings(col, did)
            now = Settings(
                on=was.on if on is None else on,
                auto=was.auto if auto is None else auto,
                off=was.off if skills_off is None else tuple(sorted(set(skills_off))),
            )
            save_settings(col, did, now)
            changed = set_paused(col, name, not on) if on is not None else 0
            return {**_state(col, did, name, language), "cards_changed": changed}

        return await cm.write(run)

    @server.tool(annotations=WRITE)
    async def add_skill_cards(deck: str, dry_run: bool = True) -> dict[str, Any]:
        """Adds the skill cards of the skills that are on in a language deck and it lacks, as Franki's Add now
        does: Basic notes in "<deck>::Skills", a later drill step suspended until the step before settles,
        and the words those skills need (the months and weekdays for dates) that the deck lacks, as
        Omnilanguage notes in the same subdeck. Cards already there are skipped. With dry_run (the default) nothing is written: it says how many cards
        each skill would add. Refused while the deck's skill cards are paused (set_skill_cards on=true)."""

        def run(col: Collection) -> dict[str, Any]:
            did, name, language = _skill_deck(col, deck)
            s = read_settings(col, did)
            if not s.on:
                raise ToolError(f'Skill cards are paused for "{name}". Turn them back on with set_skill_cards (on true) first.')
            if dry_run:
                return {"would_add": _state(col, did, name, language)["skills"], "written": 0}
            return add_missing(col, name, language, s.off)

        return await (cm.read(run) if dry_run else cm.write(run))


def _parents(name: str) -> list[str]:
    parts = name.split("::")
    return ["::".join(parts[:i]) for i in range(1, len(parts))]
