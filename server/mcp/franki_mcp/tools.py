"""
The MCP's tools: the user's Anki collection, read and changed through Anki's own engine.

Every tool goes through the CollectionManager, which syncs with the user's Anki sync server
before reading and after writing. Notes, cards and decks are named by Anki's ids; searches use
Anki's search syntax. Results are plain dicts. A problem the caller can fix comes back as an
error naming what to change, never as a silent skip.
"""

from __future__ import annotations

import base64
import re
import time
from datetime import date, datetime, timedelta
from typing import Any, Literal

from anki.collection import Collection  # first: the anki package's modules import each other
from anki.cards import Card
from anki.consts import QUEUE_TYPE_DAY_LEARN_RELEARN, QUEUE_TYPE_LRN, QUEUE_TYPE_NEW, QUEUE_TYPE_REV
from anki.decks_pb2 import Deck as DeckProto
from anki.notes import Note
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError  # its message reaches the model; any other error doesn't
from mcp.types import ToolAnnotations
from pydantic import BaseModel, Field

from .collection import CollectionManager
from .speech import SpeechClient, SpeechError, audio_filename, locale_of

MAX_NOTES_PER_CALL = 100
MAX_AUDIO_NOTES_PER_CALL = 10
FILTER_ORDERS = {name.lower(): value for name, value in DeckProto.Filtered.SearchTerm.Order.items()}
SOUND = re.compile(r"\[sound:[^\]]*\]")
MATURE_DAYS = 21
# Franki's "Flag for an agent" (src/core/agentFlag.ts): the purple flag on a card, and a flag::<reason> tag on its note.
AGENT_FLAG = 7
FLAG_TAG_PREFIX = "flag::"
READ = ToolAnnotations(readOnlyHint=True, openWorldHint=False)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False)
DESTRUCTIVE = ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False)


# ---- reading rows ----


def _text(col: Collection, html: str) -> str:
    """A field or card side as one line of text, as Anki's browser shows it (media kept as file names)."""
    return col._backend.html_to_text_line(text=html, preserve_media_filenames=True).strip()


# A note type's stylesheet and scripts, which Anki puts in every rendered card: often many KB, and
# nothing a reader of the card needs.
STYLE_SCRIPT = re.compile(r"<(style|script)\b[^>]*>.*?</\1\s*>", re.S | re.I)


def _bare_html(html: str) -> str:
    """A rendered card side without its styles and scripts."""
    return STYLE_SCRIPT.sub("", html).strip()


def _deck_name(col: Collection, did: int) -> str:
    d = col.decks.get(did, default=False)
    return d["name"] if d else f"(missing deck {did})"


def _stage(card: Card) -> str:
    if card.queue == -1:
        return "suspended"
    if card.queue in (-2, -3):
        return "buried"
    return {0: "new", 1: "learning", 2: "review", 3: "relearning"}.get(card.type, "unknown")


def _due(col: Collection, card: Card) -> str | int | None:
    """When a card is next due: a date (or date and time, for a learning step), or its position if new."""
    if card.queue == QUEUE_TYPE_NEW:
        return card.due  # position in the new-card order
    if card.queue == QUEUE_TYPE_LRN:
        return datetime.fromtimestamp(card.due).isoformat(timespec="minutes")
    if card.queue in (QUEUE_TYPE_REV, QUEUE_TYPE_DAY_LEARN_RELEARN) or card.odid:
        days = (card.odue if card.odid else card.due) - col.sched.today
        return (date.today() + timedelta(days=days)).isoformat()
    return None


def _card_dict(col: Collection, card: Card) -> dict[str, Any]:
    home = card.odid or card.did
    return {
        "card_id": card.id,
        "card_type": card.template()["name"],
        "deck": _deck_name(col, home),
        "filtered_deck": _deck_name(col, card.did) if card.odid else None,
        "stage": _stage(card),
        "due": _due(col, card),
        "interval_days": card.ivl if card.type == 2 else 0,
        "reviews": card.reps,
        "lapses": card.lapses,
        "flag": card.user_flag(),
    }


def _note_dict(col: Collection, note: Note, full: bool = True) -> dict[str, Any]:
    nt = note.note_type()
    cards = note.cards()
    out: dict[str, Any] = {
        "note_id": note.id,
        "note_type": nt["name"] if nt else None,
        "deck": _deck_name(col, cards[0].odid or cards[0].did) if cards else None,
        "tags": note.tags,
    }
    if full:
        out["fields"] = dict(note.items())
        out["cards"] = [_card_dict(col, c) for c in cards]
    else:
        out["preview"] = _text(col, note.fields[nt["sortf"]] if nt else note.fields[0])
    return out


def _deck_id(col: Collection, name: str) -> int:
    did = col.decks.id_for_name(name)
    if not did:
        names = sorted(n.name for n in col.decks.all_names_and_ids())
        raise ToolError(f'There\'s no deck called "{name}". Decks: {", ".join(names)}. Create it with create_deck first if it\'s new.')
    return did


def _note_type(col: Collection, name: str) -> dict[str, Any]:
    nt = col.models.by_name(name)
    if not nt:
        names = sorted(n.name for n in col.models.all_names_and_ids())
        raise ToolError(f'There\'s no note type called "{name}". Note types: {", ".join(names)}.')
    return nt


def _check_fields(nt: dict[str, Any], fields: dict[str, str]) -> None:
    known = [f["name"] for f in nt["flds"]]
    unknown = [k for k in fields if k not in known]
    if unknown:
        raise ToolError(f'"{nt["name"]}" has no field {", ".join(repr(u) for u in unknown)}. Its fields: {", ".join(known)}.')


def _get_note(col: Collection, nid: int) -> Note:
    try:
        return col.get_note(nid)
    except Exception as e:  # noqa: BLE001 - NotFoundError
        raise ToolError(f"There's no note {nid}. find_notes gives note ids.") from e


def _get_card(col: Collection, cid: int) -> Card:
    try:
        return col.get_card(cid)
    except Exception as e:  # noqa: BLE001
        raise ToolError(f"There's no card {cid}. get_notes lists a note's cards.") from e


# ---- inputs ----


class NewNote(BaseModel):
    deck: str = Field(description='Deck name, with "::" between levels, e.g. "Polski::Odmiana". Must exist.')
    note_type: str = Field(description='Note type name, e.g. "Basic" or "Omnilanguage". list_note_types names them and their fields.')
    fields: dict[str, str] = Field(description="Field name to content (HTML). Fields left out stay empty.")
    tags: list[str] = Field(default_factory=list)


class CardTemplate(BaseModel):
    front: str | None = Field(default=None, description="The question side's template.")
    back: str | None = Field(default=None, description="The answer side's template, usually starting {{FrontSide}}<hr id=answer>.")


FilteredOrder = Literal[
    "oldest_reviewed_first", "random", "intervals_ascending", "intervals_descending", "lapses", "added", "due",
    "reverse_added", "retrievability_ascending", "retrievability_descending", "relative_overdueness",
]


class Replacement(BaseModel):
    find: str
    replace: str = ""


class NoteUpdate(BaseModel):
    note_id: int
    fields: dict[str, str] | None = Field(default=None, description="Only the fields given change; others keep their content.")
    tags: list[str] | None = Field(default=None, description="Replaces all the note's tags.")
    add_tags: list[str] | None = None
    remove_tags: list[str] | None = None


INSTRUCTIONS = """\
Franki's MCP: the user's Anki collection (the same one Franki, AnkiMobile and Anki on their
computer use), reached through their own Anki sync server. Every change syncs right away, so it
reaches their devices at their next sync.

- Find notes with find_notes, using Anki's search syntax: words, "deck:Polski", "tag:verb",
  "note:Basic", "Front:kot", "is:due", "is:new", "added:7", "rated:1", combined with spaces (and),
  "or", "-" (not) and parentheses. Read them in full with get_notes.
- Before adding notes, check the note type's field names with list_note_types. add_notes refuses a
  duplicate first field unless allow_duplicates is true; tell the user about any it refused.
- In an Omnilanguage note's Context sentence, put the word in bold as the sentence spells it
  ("Die <b>Einstellungen</b> sind im Menü.", both parts of a split verb: "Er <b>warf</b> seinen
  Mantel <b>ab</b>."). Franki highlights what's bold, and only searches for the Entry when nothing is.
- Only change or delete notes the user asked about. delete_notes can't be undone here.
- Studying: call study_next for a deck, show the user the question, and wait for their answer. Then
  show the answer (present_card with show_answer=true), suggest a rating (1 Again, 2 Hard, 3 Good,
  4 Easy) and wait for them to confirm or change it. Only then call rate_card. Never rate a card
  the user hasn't seen the answer to, or with a rating they didn't agree to.
- Flagged cards: the user flags a card in Franki for you to check (a typo, audio that sounds wrong).
  flagged_cards lists them with their note's fields and the reason. Work out the fix and show the
  user what you'd change (the old and new text, or the voice and text for a re-record) before
  calling update_notes or add_tts_audio. Only after they approve, and once the fix is made, call
  resolve_flag to clear the flag. Leave a flag in place when the user declines or you're unsure.
- Audio: add_tts_audio records a field's text with an Azure voice into another field (list_voices
  names them). Try preview=true first when the text needs cleaning up (replacements, text_overrides).
- FSRS settings and limits belong to a deck's options preset, which several decks can share:
  say which decks a change affects before making it.
- add_field makes every device download the whole collection: ask the user to sync every device
  first, and only then pass every_device_synced=true.
- Forms: fill_forms fills Omnilanguage verbs' Forms field (for Franki's forms practice) from
  Wiktionary's tables. Preview first (dry_run) and show the user; turn on the daily fill
  (set_forms_auto_fill) only once they've checked a batch. Write a not_found word's forms yourself
  only when asked, in the same lines, tagged forms-unverified.
"""


def register(server: MCPServer, cm: CollectionManager, speech: SpeechClient | None = None) -> None:
    """Adds every tool to the server. Without `speech`, the audio tools say how to turn them on."""

    # ---- what's in the collection ----

    @server.tool(annotations=READ)
    async def list_decks() -> dict[str, Any]:
        """Every deck, with how many new, learning and review cards are due in it today (subdecks
        included, within the deck's daily limits, as Anki's deck list shows them)."""

        def run(col: Collection) -> dict[str, Any]:
            decks = []

            def walk(node, parent: str = "") -> None:
                for child in node.children:
                    name = f"{parent}::{child.name}" if parent else child.name
                    decks.append({"deck": name, "deck_id": child.deck_id, "new": child.new_count,
                                  "learning": child.learn_count, "review": child.review_count})
                    walk(child, name)

            walk(col.sched.deck_due_tree())
            return {"decks": decks}

        return await cm.read(run)

    @server.tool(annotations=WRITE)
    async def create_deck(name: str) -> dict[str, Any]:
        """Creates a deck ("Polski::Odmiana" makes it under Polski). Does nothing if it exists."""

        def run(col: Collection) -> dict[str, Any]:
            existing = col.decks.id_for_name(name)
            if existing:
                return {"deck_id": existing, "created": False}
            return {"deck_id": col.decks.id(name), "created": True}

        return await cm.write(run)

    @server.tool(annotations=READ)
    async def list_note_types() -> dict[str, Any]:
        """Every note type with its fields and card types, in Anki's order."""

        def run(col: Collection) -> dict[str, Any]:
            out = []
            for entry in col.models.all_names_and_ids():
                nt = col.models.get(entry.id)
                out.append({
                    "note_type": nt["name"], "is_cloze": nt["type"] == 1,
                    "fields": [f["name"] for f in nt["flds"]],
                    "card_types": [t["name"] for t in nt["tmpls"]],
                    "notes": col.models.use_count(nt),
                })
            return {"note_types": out}

        return await cm.read(run)

    # ---- notes ----

    @server.tool(annotations=READ)
    async def find_notes(query: str, limit: int = 50, offset: int = 0) -> dict[str, Any]:
        """Notes matching an Anki search (see the server instructions for the syntax), sorted as
        Anki's browser sorts them, `limit` at a time from `offset`. Each has its id, note type,
        deck, tags and a preview of its sort field; get_notes gives everything."""

        def run(col: Collection) -> dict[str, Any]:
            try:
                ids = list(col.find_notes(query))
            except Exception as e:  # noqa: BLE001 - Anki's search error says what's wrong
                raise ToolError(f"Anki couldn't read the search: {e}") from e
            page = ids[offset : offset + max(1, min(limit, 500))]
            return {"total": len(ids), "offset": offset,
                    "notes": [_note_dict(col, col.get_note(i), full=False) for i in page]}

        return await cm.read(run)

    @server.tool(annotations=READ)
    async def get_notes(note_ids: list[int]) -> dict[str, Any]:
        """Notes in full: every field (as HTML), tags, and each card with its deck, stage
        (new, learning, review, relearning, suspended, buried), due date, interval and flag."""

        def run(col: Collection) -> dict[str, Any]:
            return {"notes": [_note_dict(col, _get_note(col, i)) for i in note_ids[:MAX_NOTES_PER_CALL]]}

        return await cm.read(run)

    @server.tool(annotations=WRITE)
    async def add_notes(notes: list[NewNote], allow_duplicates: bool = False) -> dict[str, Any]:
        """Adds notes (up to 100 a call) with their cards, as Anki's Add window would. A note whose
        first field matches another note of its type is refused unless allow_duplicates is true;
        one that would make no cards is refused too. Each result has the new note id or the reason
        it wasn't added."""
        if len(notes) > MAX_NOTES_PER_CALL:
            raise ToolError(f"Up to {MAX_NOTES_PER_CALL} notes a call; send the rest in another.")

        def run(col: Collection) -> dict[str, Any]:
            from anki.notes import NoteFieldsCheckResult

            results = []
            for i, n in enumerate(notes):
                try:
                    nt = _note_type(col, n.note_type)
                    _check_fields(nt, n.fields)
                    did = _deck_id(col, n.deck)
                    note = col.new_note(nt)
                    for k, v in n.fields.items():
                        note[k] = v
                    note.tags = list(n.tags)
                    state = note.fields_check()
                    if state == NoteFieldsCheckResult.EMPTY:
                        raise ToolError(f'The first field ("{nt["flds"][0]["name"]}") is empty.')
                    if state == NoteFieldsCheckResult.DUPLICATE and not allow_duplicates:
                        raise ToolError("Another note of this type has the same first field. Pass allow_duplicates to add it anyway.")
                    col.add_note(note, did)
                    results.append({"index": i, "note_id": note.id, "cards": len(note.cards())})
                except ToolError as e:
                    results.append({"index": i, "error": str(e)})
                except Exception as e:  # noqa: BLE001 - e.g. a note that makes no cards
                    results.append({"index": i, "error": f"Anki refused it: {e}"})
            return {"added": sum(1 for r in results if "note_id" in r), "results": results}

        return await cm.write(run)

    @server.tool(annotations=WRITE)
    async def update_notes(updates: list[NoteUpdate]) -> dict[str, Any]:
        """Changes notes' fields and tags (up to 100 a call). Only the fields given change. A note
        that now makes a card it didn't gets that card, as in Anki."""

        def run(col: Collection) -> dict[str, Any]:
            results = []
            for u in updates[:MAX_NOTES_PER_CALL]:
                try:
                    note = _get_note(col, u.note_id)
                    if u.fields:
                        _check_fields(note.note_type(), u.fields)
                        for k, v in u.fields.items():
                            note[k] = v
                    if u.tags is not None:
                        note.tags = list(u.tags)
                    for t in u.add_tags or []:
                        note.add_tag(t)
                    for t in u.remove_tags or []:
                        note.remove_tag(t)
                    col.update_note(note)
                    results.append({"note_id": u.note_id, "updated": True})
                except ToolError as e:
                    results.append({"note_id": u.note_id, "error": str(e)})
            return {"results": results}

        return await cm.write(run)

    @server.tool(annotations=DESTRUCTIVE)
    async def delete_notes(note_ids: list[int]) -> dict[str, Any]:
        """Deletes notes and all their cards, on every device after their next sync. Their review
        history is kept, as in Anki. Only for notes the user asked to delete."""

        def run(col: Collection) -> dict[str, Any]:
            missing = [i for i in note_ids if not col.db.scalar("select 1 from notes where id = ?", i)]
            if missing:
                raise ToolError(f"There's no note {', '.join(map(str, missing))}. Nothing was deleted.")
            return {"deleted": col.remove_notes(note_ids).count}

        return await cm.write(run)

    @server.tool(annotations=WRITE)
    async def manage_tags(
        action: Literal["list", "add", "remove", "rename"],
        note_ids: list[int] | None = None,
        tags: list[str] | None = None,
        old_name: str | None = None,
        new_name: str | None = None,
    ) -> dict[str, Any]:
        """Tags: "list" every tag; "add" or "remove" `tags` on `note_ids`; "rename" a tag (and its
        subtags) from `old_name` to `new_name` on every note."""
        if action == "list":
            return await cm.read(lambda col: {"tags": col.tags.all()})

        def run(col: Collection) -> dict[str, Any]:
            if action == "rename":
                if not old_name or not new_name:
                    raise ToolError("rename needs old_name and new_name.")
                return {"notes_changed": col.tags.rename(old_name, new_name).count}
            if not note_ids or not tags:
                raise ToolError(f"{action} needs note_ids and tags.")
            joined = " ".join(tags)
            changed = col.tags.bulk_add(note_ids, joined) if action == "add" else col.tags.bulk_remove(note_ids, joined)
            return {"notes_changed": changed.count}

        return await cm.write(run)

    # ---- cards ----

    @server.tool(annotations=WRITE)
    async def manage_cards(
        action: Literal["suspend", "unsuspend", "bury", "unbury_deck", "set_flag", "change_deck", "set_due_date", "forget", "reposition"],
        card_ids: list[int] | None = None,
        deck: str | None = None,
        flag: int | None = None,
        days: str | None = None,
        reset_counts: bool = False,
        starting_from: int = 0,
        randomize: bool = False,
    ) -> dict[str, Any]:
        """Card actions, as Anki's browser has them:
        - suspend / unsuspend `card_ids`; bury `card_ids` until tomorrow; unbury_deck: every buried card in `deck`
        - set_flag on `card_ids`: `flag` 0 none, 1 red, 2 orange, 3 green, 4 blue, 5 pink, 6 turquoise, 7 purple
        - change_deck: move `card_ids` to `deck` (which must exist)
        - set_due_date: `days` "0" due today, "5" in five days, "5-7" a random day in that range, "5!" also resets the interval
        - forget: make `card_ids` new again (keeping their review history), optionally `reset_counts`
        - reposition: give new `card_ids` new-card positions from `starting_from`, optionally `randomize`d
        """

        def run(col: Collection) -> dict[str, Any]:
            ids = card_ids or []
            if action != "unbury_deck" and not ids:
                raise ToolError(f"{action} needs card_ids.")
            for cid in ids:
                _get_card(col, cid)
            s = col.sched
            if action == "suspend":
                return {"changed": s.suspend_cards(ids).count}
            if action == "unsuspend":
                s.unsuspend_cards(ids)
                return {"changed": len(ids)}
            if action == "bury":
                return {"changed": s.bury_cards(ids).count}
            if action == "unbury_deck":
                if not deck:
                    raise ToolError("unbury_deck needs deck.")
                s.unbury_deck(_deck_id(col, deck))
                return {"unburied_in": deck}
            if action == "set_flag":
                if flag is None or not 0 <= flag <= 7:
                    raise ToolError("set_flag needs flag, 0 to 7.")
                return {"changed": col.set_user_flag_for_cards(flag, ids).count}
            if action == "change_deck":
                if not deck:
                    raise ToolError("change_deck needs deck.")
                return {"changed": col.set_deck(ids, _deck_id(col, deck)).count}
            if action == "set_due_date":
                if not days:
                    raise ToolError('set_due_date needs days, e.g. "0", "5", "5-7" or "5!".')
                s.set_due_date(ids, days)
                return {"changed": len(ids)}
            if action == "forget":
                s.schedule_cards_as_new(ids, restore_position=True, reset_counts=reset_counts)
                return {"changed": len(ids)}
            if action == "reposition":
                return {"changed": s.reposition_new_cards(ids, starting_from, 1, randomize, False).count}
            raise ToolError(f"Unknown action {action}.")

        return await cm.write(run)

    @server.tool(annotations=READ)
    async def flagged_cards(deck: str | None = None, limit: int = 20) -> dict[str, Any]:
        """Cards the user flagged in Franki for an agent to check (the purple flag), oldest note
        first, with the reason they gave (typo, audio, translation, other), the note's fields as
        HTML and its tags. `deck` narrows it to one deck and its subdecks. Fix a card with
        update_notes or add_tts_audio after the user approves, then clear it with resolve_flag."""

        def run(col: Collection) -> dict[str, Any]:
            query = f"flag:{AGENT_FLAG}"
            if deck:
                query += f' "deck:{_deck_name(col, _deck_id(col, deck))}"'
            ids = list(col.find_cards(query))
            page = ids[: max(1, min(limit, 100))]
            out = []
            for cid in page:
                card = col.get_card(cid)
                note = card.note()
                reasons = [t[len(FLAG_TAG_PREFIX):] for t in note.tags if t.lower().startswith(FLAG_TAG_PREFIX)]
                out.append({
                    "card_id": cid, "card_type": card.template()["name"], "reason": reasons[0] if reasons else None,
                    **_note_dict(col, note, full=False), "fields": dict(note.items()),
                })
            return {"total": len(ids), "cards": out}

        return await cm.read(run)

    @server.tool(annotations=WRITE)
    async def resolve_flag(card_ids: list[int]) -> dict[str, Any]:
        """Clears the agent flag on `card_ids` once the user has approved the fix (or decided
        there's nothing to fix). A note's flag:: reason tag goes too when none of its cards is
        still flagged."""

        def run(col: Collection) -> dict[str, Any]:
            cards = [_get_card(col, cid) for cid in card_ids]
            not_flagged = [c.id for c in cards if c.user_flag() != AGENT_FLAG]
            if not_flagged:
                raise ToolError(f"Card {', '.join(map(str, not_flagged))} isn't flagged for an agent. flagged_cards lists the ones that are. Nothing was changed.")
            col.set_user_flag_for_cards(0, [c.id for c in cards])
            cleared = []
            for nid in {c.nid for c in cards}:
                if col.find_cards(f"nid:{nid} flag:{AGENT_FLAG}"):
                    continue
                note = col.get_note(nid)
                stale = [t for t in note.tags if t.lower().startswith(FLAG_TAG_PREFIX)]
                if stale:
                    for t in stale:
                        note.remove_tag(t)
                    col.update_note(note)
                    cleared.append(nid)
            return {"resolved": len(cards), "notes_untagged": cleared}

        return await cm.write(run)

    # ---- studying ----

    @server.tool(annotations=WRITE)
    async def study_next(deck: str, include_html: bool = False) -> dict[str, Any]:
        """The next card to study in a deck (with its subdecks), in Anki's order and within its
        limits, with the question as text (image and sound file names kept), and when each rating
        would bring it back. include_html adds the card's HTML, without its styles and scripts.
        Show the user the question and wait for their answer before present_card(show_answer=true)."""

        def run(col: Collection) -> dict[str, Any]:
            col.decks.select(_deck_id(col, deck))
            queued = col.sched.get_queued_cards(fetch_limit=1)
            if not queued.cards:
                return {"card": None, "message": f"Nothing is due in {deck} right now."}
            card = Card(col, backend_card=queued.cards[0].card)
            card.start_timer()
            intervals = col.sched.describe_next_states(queued.cards[0].states)
            return {
                "card": _card_dict(col, card),
                "question_text": _text(col, card.question()),
                **({"question_html": _bare_html(card.question())} if include_html else {}),
                "next_if": dict(zip(["again", "hard", "good", "easy"], [i.replace("⁨", "").replace("⁩", "") for i in intervals])),
                "remaining": {"new": queued.new_count, "learning": queued.learning_count, "review": queued.review_count},
            }

        # Selecting the deck changes the collection's "current deck" setting, as studying in Anki does.
        return await cm.write(run)

    @server.tool(annotations=READ)
    async def present_card(card_id: int, show_answer: bool = False, include_html: bool = False) -> dict[str, Any]:
        """A card's question, and its answer only with show_answer=true (after the user has
        answered), as text. include_html adds the HTML, without its styles and scripts."""

        def run(col: Collection) -> dict[str, Any]:
            card = _get_card(col, card_id)
            out = {"card": _card_dict(col, card), "question_text": _text(col, card.question())}
            if include_html:
                out["question_html"] = _bare_html(card.question())
            if show_answer:
                out["answer_text"] = _text(col, card.answer())
                if include_html:
                    out["answer_html"] = _bare_html(card.answer())
            return out

        return await cm.read(run)

    @server.tool(annotations=WRITE)
    async def rate_card(card_id: int, rating: Literal[1, 2, 3, 4]) -> dict[str, Any]:
        """Answers the card study_next gave, with the rating the user confirmed after seeing the
        answer: 1 Again, 2 Hard, 3 Good, 4 Easy. Anki only takes an answer for the card at the top
        of its queue; if the queue moved on, call study_next again."""

        def run(col: Collection) -> dict[str, Any]:
            queued = col.sched.get_queued_cards(fetch_limit=1)
            if not queued.cards or queued.cards[0].card.id != card_id:
                raise ToolError(f"Card {card_id} isn't the next card to study any more. Call study_next for the deck again.")
            card = Card(col, backend_card=queued.cards[0].card)
            card.start_timer()
            col.sched.answer_card(col.sched.build_answer(card=card, states=queued.cards[0].states, rating=rating))
            card.load()
            return {"card": _card_dict(col, card)}

        return await cm.write(run)

    # ---- stats ----

    @server.tool(annotations=READ)
    async def get_stats(deck: str | None = None) -> dict[str, Any]:
        """Study statistics for a deck (with its subdecks) or the whole collection: cards by stage,
        today's answers and time, how many come due over the next week, and the share of reviews
        remembered (not Again) over the last 30 days, mature cards (interval 21+ days) apart."""

        def run(col: Collection) -> dict[str, Any]:
            search = f'"deck:{deck}"' if deck else ""
            if deck:
                _deck_id(col, deck)
            cids = list(col.find_cards(search))
            ids = ",".join(map(str, cids)) or "0"
            db = col.db
            stage = {"new": 0, "learning": 0, "young": 0, "mature": 0, "suspended": 0, "buried": 0}
            for queue, ctype, ivl in db.all(f"select queue, type, ivl from cards where id in ({ids})"):
                if queue == -1:
                    stage["suspended"] += 1
                elif queue in (-2, -3):
                    stage["buried"] += 1
                elif ctype == 0:
                    stage["new"] += 1
                elif ctype == 2:
                    stage["mature" if ivl >= MATURE_DAYS else "young"] += 1
                else:
                    stage["learning"] += 1
            day_start_ms = (col.sched.day_cutoff - 86400) * 1000
            answered, ms = db.first(f"select count(), coalesce(sum(time), 0) from revlog where id >= ? and cid in ({ids}) and ease > 0", day_start_ms)
            today = col.sched.today
            due_week = [db.scalar(f"select count() from cards where id in ({ids}) and queue in (2, 3) and due = ?", today + d) for d in range(7)]
            overdue = db.scalar(f"select count() from cards where id in ({ids}) and queue in (2, 3) and due < ?", today)
            month_ms = (col.sched.day_cutoff - 30 * 86400) * 1000

            def rate(mature_only: bool) -> dict[str, Any]:
                extra = f"and lastIvl >= {MATURE_DAYS}" if mature_only else ""
                total, passed = db.first(
                    f"select count(), coalesce(sum(ease > 1), 0) from revlog where id >= ? and cid in ({ids}) and type = 1 {extra}", month_ms)
                return {"reviews": total, "remembered_percent": round(100 * passed / total) if total else None}

            return {
                "deck": deck or "all decks", "cards": stage,
                "today": {"answers": answered, "minutes": round(ms / 60000)},
                "due": {"overdue": overdue, "next_7_days": due_week},
                "last_30_days": {"all_reviews": rate(False), "mature_reviews": rate(True)},
            }

        return await cm.read(run)

    # ---- FSRS and limits ----

    def _preset(col: Collection, deck: str) -> tuple[dict[str, Any], list[str]]:
        conf = col.decks.config_dict_for_deck_id(_deck_id(col, deck))
        sharing = sorted(d.name for d in col.decks.all_names_and_ids()
                         if col.decks.config_dict_for_deck_id(d.id)["id"] == conf["id"])
        return conf, sharing

    @server.tool(annotations=READ)
    async def get_fsrs_settings(deck: str) -> dict[str, Any]:
        """A deck's options preset: its FSRS parameters, desired retention, daily limits and the
        other decks that share it."""

        def run(col: Collection) -> dict[str, Any]:
            conf, sharing = _preset(col, deck)
            return {
                "preset": conf["name"], "decks_sharing_it": sharing, "fsrs_enabled": bool(col.get_config("fsrs", False)),
                "params": conf.get("fsrsParams6") or conf.get("fsrsParams5") or conf.get("fsrsWeights") or [],
                "desired_retention": conf.get("desiredRetention"),
                "new_per_day": conf["new"]["perDay"], "reviews_per_day": conf["rev"]["perDay"],
                "maximum_interval_days": conf["rev"]["maxIvl"],
            }

        return await cm.read(run)

    @server.tool(annotations=WRITE)
    async def set_fsrs_settings(
        deck: str,
        desired_retention: float | None = None,
        new_per_day: int | None = None,
        reviews_per_day: int | None = None,
        params: list[float] | None = None,
    ) -> dict[str, Any]:
        """Changes a deck's options preset, which every deck sharing it uses (get_fsrs_settings
        lists them; tell the user first). desired_retention is 0.7 to 0.99."""

        def run(col: Collection) -> dict[str, Any]:
            conf, sharing = _preset(col, deck)
            if desired_retention is not None:
                if not 0.7 <= desired_retention <= 0.99:
                    raise ToolError("desired_retention must be between 0.7 and 0.99.")
                conf["desiredRetention"] = desired_retention
            if new_per_day is not None:
                conf["new"]["perDay"] = new_per_day
            if reviews_per_day is not None:
                conf["rev"]["perDay"] = reviews_per_day
            if params is not None:
                if len(params) not in (19, 21):
                    raise ToolError("params must be FSRS's 19 or 21 numbers.")
                conf["fsrsParams6" if len(params) == 21 else "fsrsParams5"] = params
            col.decks.update_config(conf)
            return {"preset": conf["name"], "decks_affected": sharing}

        return await cm.write(run)

    @server.tool(annotations=WRITE)
    async def optimize_fsrs(deck: str, apply: bool = False) -> dict[str, Any]:
        """Runs Anki's FSRS optimizer on the review history of a deck's preset (every deck sharing
        it). Returns the new parameters; saves them only with apply=true. Needs a few hundred
        reviews to be worth it; Anki keeps the current ones when it can't do better."""

        def run(col: Collection) -> dict[str, Any]:
            conf, sharing = _preset(col, deck)
            current = conf.get("fsrsParams6") or conf.get("fsrsParams5") or []
            search = f'preset:"{conf["name"]}" -is:suspended'
            ignore = conf.get("ignoreRevlogsBeforeDate") or ""
            ignore_ms = int(datetime.fromisoformat(ignore).timestamp() * 1000) if ignore else 0
            resp = col._backend.compute_fsrs_params(
                search=search, current_params=current, ignore_revlogs_before_ms=ignore_ms,
                num_of_relearning_steps=len(conf["lapse"]["delays"]), health_check=False,
            )
            new = [round(p, 4) for p in resp.params]
            out = {"preset": conf["name"], "decks_sharing_it": sharing, "reviews_used": resp.fsrs_items,
                   "current_params": current, "new_params": new, "applied": False}
            if apply and new and new != current:
                conf["fsrsParams6"] = new
                col.decks.update_config(conf)
                out["applied"] = True
            return out

        return await cm.write(run) if apply else await cm.read(run)

    # ---- media and sync ----

    @server.tool(annotations=WRITE)
    async def store_media(filename: str, data_base64: str) -> dict[str, Any]:
        """Saves an image or sound into the collection's media, to use in a field as
        <img src="name"> or [sound:name]. Anki may change the name if one is taken; use the name
        returned. It reaches devices with the next media sync."""
        try:
            data = base64.b64decode(data_base64, validate=True)
        except Exception as e:  # noqa: BLE001
            raise ToolError("data_base64 isn't valid base64.") from e
        name = await cm.write(lambda col: col.media.write_data(filename, data), media=True)
        return {"filename": name}

    @server.tool(annotations=WRITE)
    async def sync_now() -> dict[str, Any]:
        """Syncs with the Anki sync server now (it also happens before and after every tool), then
        starts a media sync."""
        started = time.monotonic()
        message = await cm.sync_now()
        return {"message": message, "seconds": round(time.monotonic() - started, 1)}

    # ---- note types ----

    @server.tool(annotations=READ)
    async def get_note_type(note_type: str) -> dict[str, Any]:
        """A note type's fields, each card type's front and back templates (Anki's {{Field}}
        syntax), and its styling (CSS), to read before changing them with update_note_type."""

        def run(col: Collection) -> dict[str, Any]:
            nt = _note_type(col, note_type)
            return {
                "note_type": nt["name"], "fields": [f["name"] for f in nt["flds"]],
                "card_types": [{"name": t["name"], "front": t["qfmt"], "back": t["afmt"]} for t in nt["tmpls"]],
                "css": nt["css"], "notes": col.models.use_count(nt),
            }

        return await cm.read(run)

    @server.tool(annotations=WRITE)
    async def update_note_type(
        note_type: str,
        card_types: dict[str, CardTemplate] | None = None,
        css: str | None = None,
    ) -> dict[str, Any]:
        """Changes a note type's card templates (by card type name: a new front, back or both) or
        its styling. Every note of the type shows the change; Anki refuses a template that's
        broken (say, a field that doesn't exist) and nothing changes. To add a field, use add_field;
        removing or renaming fields, and card types, isn't offered (do it in Anki)."""
        if not card_types and css is None:
            raise ToolError("Pass card_types, css or both.")

        def run(col: Collection) -> dict[str, Any]:
            nt = _note_type(col, note_type)
            by_name = {t["name"]: t for t in nt["tmpls"]}
            unknown = [n for n in card_types or {} if n not in by_name]
            if unknown:
                raise ToolError(f'"{nt["name"]}" has no card type {", ".join(repr(u) for u in unknown)}. Its card types: {", ".join(by_name)}.')
            for name, t in (card_types or {}).items():
                if t.front is not None:
                    by_name[name]["qfmt"] = t.front
                if t.back is not None:
                    by_name[name]["afmt"] = t.back
            if css is not None:
                nt["css"] = css
            try:
                col.models.update_dict(nt)
            except Exception as e:  # noqa: BLE001 - Anki's template check says what's wrong
                raise ToolError(f"Anki refused the change: {e}") from e
            return {"note_type": nt["name"], "updated": True}

        return await cm.write(run)

    @server.tool(annotations=DESTRUCTIVE)
    async def add_field(note_type: str, field: str, every_device_synced: bool = False) -> dict[str, Any]:
        """Adds a field at the end of a note type. This changes the note type's structure, so the
        whole collection is uploaded to the sync server, replacing its copy, and every other device
        (Anki on a computer, AnkiMobile, Franki) has to download it at its next sync. Anything a
        device hadn't synced yet is lost in that download. So before calling: ask the user to sync
        every device, and pass every_device_synced=true only once they say they have. Afterwards,
        tell them to sync each device and choose Download when asked."""
        name = field.strip()
        if not every_device_synced:
            raise ToolError(
                "Adding a field makes every device download the whole collection, losing anything it hasn't synced. "
                "Ask the user to sync Anki on their computer, AnkiMobile and Franki first, then call again with "
                "every_device_synced=true."
            )
        if not name or name[0] in "#/^" or any(ch in name for ch in ':"{}'):
            raise ToolError('A field name can\'t be empty, start with #, / or ^, or hold :, ", { or }.')

        def run(col: Collection) -> dict[str, Any]:
            nt = _note_type(col, note_type)
            existing = col.models.field_names(nt)
            same = next((n for n in existing if n.lower() == name.lower()), None)
            if same:
                raise ToolError(f'"{nt["name"]}" already has a field called "{same}".')
            col.models.add_field(nt, col.models.new_field(name))
            col.models.update_dict(nt)
            return {"note_type": nt["name"], "fields": col.models.field_names(nt)}

        out = await cm.change_schema(run)
        out["next"] = (
            "The collection was uploaded to the sync server. Sync each other device now and choose Download "
            "when it asks: Anki on the computer, AnkiMobile and Franki (Franki downloads on its own unless it "
            "has changes the server lacks, and then asks)."
        )
        return out

    # ---- filtered decks ----

    @server.tool(annotations=WRITE)
    async def filtered_deck(
        action: Literal["create", "rebuild", "empty", "delete"],
        name: str,
        search: str | None = None,
        limit: int = 100,
        order: FilteredOrder = "due",
        reschedule: bool = True,
    ) -> dict[str, Any]:
        """Filtered decks, as Anki's Create Filtered Deck has them:
        - create: a deck `name` gathering up to `limit` cards matching `search` (Anki's syntax,
          e.g. "deck:Polski is:due" or "rated:1:1" for today's Again answers), in `order`; with
          reschedule=false, studying them doesn't change their schedule. Creating one that exists
          changes its search and rebuilds it.
        - rebuild: gather its cards again; empty: send its cards back to their own decks;
          delete: empty it and remove it.
        """

        def run(col: Collection) -> dict[str, Any]:
            did = col.decks.id_for_name(name)
            if did and not col.decks.is_filtered(did):
                raise ToolError(f'"{name}" is a normal deck, not a filtered one.')
            if action == "create":
                if not search:
                    raise ToolError("create needs search.")
                deck = col.sched.get_or_create_filtered_deck(did or 0)
                deck.name = name
                term = deck.config.search_terms[0]
                term.search, term.limit = search, max(1, min(limit, 9999))
                term.order = FILTER_ORDERS[order]
                deck.config.reschedule = reschedule
                try:
                    new_id = col.sched.add_or_update_filtered_deck(deck).id
                except Exception as e:  # noqa: BLE001 - e.g. no cards match
                    raise ToolError(f"Anki couldn't build it: {e}") from e
                return {"deck_id": new_id, "cards": len(col.find_cards(f"did:{new_id}"))}
            if not did:
                raise ToolError(f'There\'s no filtered deck called "{name}".')
            if action == "rebuild":
                return {"cards": col.sched.rebuild_filtered_deck(did).count}
            if action == "empty":
                col.sched.empty_filtered_deck(did)
                return {"emptied": name}
            col.decks.remove([did])
            return {"deleted": name}

        return await cm.write(run)

    # ---- memory state ----

    @server.tool(annotations=READ)
    async def card_memory_state(card_ids: list[int]) -> dict[str, Any]:
        """FSRS's view of cards: stability (days until recall drops to 90%), difficulty (1 to 10,
        and as Anki shows it, 0 to 100%), and retrievability (the chance of recalling it now),
        with the deck preset's desired retention. Cards never reviewed under FSRS have none."""

        def run(col: Collection) -> dict[str, Any]:
            out = []
            for cid in card_ids[:MAX_NOTES_PER_CALL]:
                _get_card(col, cid)
                stats = col.card_stats_data(cid)
                entry: dict[str, Any] = {"card_id": cid, "preset": stats.preset,
                                         "desired_retention": round(stats.desired_retention, 3) if stats.desired_retention else None}
                if stats.HasField("memory_state"):
                    m = stats.memory_state
                    entry.update(stability_days=round(m.stability, 2), difficulty=round(m.difficulty, 2),
                                 difficulty_percent=round((m.difficulty - 1) / 9 * 100))
                else:
                    entry["memory_state"] = None
                entry["retrievability"] = round(stats.fsrs_retrievability, 3) if stats.HasField("fsrs_retrievability") else None
                out.append(entry)
            return {"cards": out}

        return await cm.read(run)

    # ---- deleting media ----

    @server.tool(annotations=DESTRUCTIVE)
    async def delete_media(filenames: list[str], even_if_used: bool = False) -> dict[str, Any]:
        """Deletes media files (to Anki's media trash, and from other devices at their next media
        sync). A file a note still uses is kept unless even_if_used is true, since its card would
        show a missing image or sound."""

        def run(col: Collection) -> dict[str, Any]:
            results, trash = [], []
            for name in filenames:
                if not col.media.have(name):
                    results.append({"filename": name, "error": "There's no media file by that name."})
                    continue
                like = "%" + name.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
                users = col.db.list("select id from notes where flds like ? escape '\\' limit 5", like)
                if users and not even_if_used:
                    results.append({"filename": name, "error": f"Notes still use it ({', '.join(map(str, users))}). Pass even_if_used to delete it anyway.", "used_by": users})
                    continue
                trash.append(name)
                results.append({"filename": name, "deleted": True})
            if trash:
                col.media.trash_files(trash)
            return {"deleted": len(trash), "results": results}

        return await cm.write(run, media=True)

    # ---- audio ----

    def _speech() -> SpeechClient:
        if speech is None:
            raise ToolError("Audio needs an Azure Speech key. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in server/.env and restart the MCP.")
        return speech

    @server.tool(annotations=READ)
    async def list_voices(locale: str | None = None) -> dict[str, Any]:
        """Azure's voices, or those for one language ("th", "th-TH", "pl", "de-DE"). Pass a voice's
        name to add_tts_audio."""
        try:
            voices = await _speech().voices()
        except SpeechError as e:
            raise ToolError(str(e)) from e
        if locale:
            want = locale.lower()
            voices = [v for v in voices if (v["locale"] or "").lower() == want or (v["locale"] or "").lower().startswith(want + "-")]
        return {"voices": voices}

    @server.tool(annotations=WRITE)
    async def add_tts_audio(
        note_ids: list[int],
        source_fields: list[str],
        target_field: str,
        voice: str,
        join: str = " ",
        rate: float = 1.0,
        replacements: list[Replacement] | None = None,
        text_overrides: dict[str, str] | None = None,
        overwrite: bool = False,
        preview: bool = False,
    ) -> dict[str, Any]:
        """Records audio for notes (up to 10 a call) with an Azure voice and puts it in a field as
        [sound:...], for Anki, AnkiMobile and Franki to play.
        - The text is `source_fields`' text (formatting and media left out) joined by `join`, then
          each `replacements` find/replace in order; `text_overrides` (note id to text) replaces it
          outright for the notes named.
        - `rate` is the speed (0.5 to 2.0, 1 is normal).
        - A note whose target field already has audio is skipped unless `overwrite`, which replaces
          that audio; other text in the field stays.
        - `preview` returns the text each note would be read as, recording nothing.
        """
        if len(note_ids) > MAX_AUDIO_NOTES_PER_CALL:
            raise ToolError(f"Up to {MAX_AUDIO_NOTES_PER_CALL} notes a call; send the rest in another.")
        if not 0.5 <= rate <= 2.0:
            raise ToolError("rate must be between 0.5 and 2.0.")
        try:
            locale_of(voice)
        except SpeechError as e:
            raise ToolError(str(e)) from e
        overrides = {int(k): v for k, v in (text_overrides or {}).items()}

        def spoken(col: Collection, note: Note) -> str:
            if note.id in overrides:
                return overrides[note.id].strip()
            parts = [col._backend.html_to_text_line(text=SOUND.sub("", note[f]), preserve_media_filenames=False).strip() for f in source_fields]
            text = join.join(p for p in parts if p)
            for r in replacements or []:
                text = text.replace(r.find, r.replace)
            return text.strip()

        def plan(col: Collection) -> list[dict[str, Any]]:
            out = []
            for nid in note_ids:
                try:
                    note = _get_note(col, nid)
                    _check_fields(note.note_type(), {f: "" for f in [*source_fields, target_field]})
                    text = spoken(col, note)
                    if not text:
                        raise ToolError("There's no text to read: the source fields are empty.")
                    if SOUND.search(note[target_field]) and not overwrite:
                        raise ToolError(f"{target_field} already has audio. Pass overwrite to replace it.")
                    out.append({"note_id": nid, "text": text})
                except ToolError as e:
                    out.append({"note_id": nid, "error": str(e)})
            return out

        plans = await cm.read(plan)
        if preview:
            return {"preview": plans}

        client = _speech()
        audio: dict[int, bytes] = {}
        for p in plans:
            if "error" in p:
                continue
            try:
                audio[p["note_id"]] = await client.synthesize(p["text"], voice, rate)
            except SpeechError as e:
                p["error"] = str(e)
        if not audio:
            return {"added": 0, "results": plans}

        def save(col: Collection) -> list[dict[str, Any]]:
            for p in plans:
                if p["note_id"] not in audio:
                    continue
                try:
                    note = _get_note(col, p["note_id"])
                except ToolError as e:
                    p["error"] = str(e)
                    continue
                # Recorded from the text as it was; if the note changed while Azure worked, the audio may not match it.
                if spoken(col, note) != p["text"]:
                    p["error"] = "The note changed while the audio was being made. Nothing was saved; try it again."
                    continue
                name = col.media.write_data(audio_filename(p["text"], voice, rate), audio[p["note_id"]])
                kept = SOUND.sub("", note[target_field]).strip() if overwrite else note[target_field].strip()
                note[target_field] = f"{kept} [sound:{name}]" if kept else f"[sound:{name}]"
                col.update_note(note)
                p["audio"] = name
            return plans

        results = await cm.write(save, media=True)
        return {"added": sum(1 for r in results if "audio" in r), "results": results}
