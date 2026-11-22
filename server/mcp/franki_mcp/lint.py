"""
The house style's tools: what a language's notes should look like (`note_guide`), where the notes in
the collection depart from it (`lint_notes`, which can also apply the fixes that need no judgment),
and the cards left behind for a kind their note no longer makes (`empty_cards`).

The rules themselves are in omnilanguage.py, the same ones add_notes and update_notes check a note
against as it's written.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any, Literal

from anki.collection import Collection  # first: the anki package's modules import each other
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from . import omnilanguage
from .collection import CollectionManager

READ = ToolAnnotations(readOnlyHint=True, openWorldHint=False)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False)
DESTRUCTIVE = ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False)

MAX_LISTED = 200  # note ids a rule lists
DUPLICATE = "duplicate-entry"
# An article is a word of its own, so a space must follow it; only an elided l' joins the noun.
# Without that, "len" read as "n" and "dieser" as "ser", and two unrelated words were called one.
_ARTICLE = re.compile(r"^(?:(?:el|la|los|las|le|les|der|die|das|en|ei|et|å|ο|η|το|οι|τα)\s+|l['’]\s*)", re.IGNORECASE)


def _bare(entry: str) -> str:
    """An Entry as two notes of one word share it: lower case, without a leading article."""
    return _ARTICLE.sub("", entry.strip().lower(), count=1).strip()


def _short(value: str, limit: int = 120) -> str:
    return value if len(value) <= limit else value[: limit - 1] + "…"


def survey(col: Collection, query: str = "") -> list[tuple[Any, dict[str, str], list[str]]]:
    """The Omnilanguage notes matching `query`, each with its fields and tags."""
    if col.models.by_name(omnilanguage.NOTE_TYPE) is None:
        raise ToolError(f"There's no {omnilanguage.NOTE_TYPE} note type in this collection.")
    search = f'"note:{omnilanguage.NOTE_TYPE}"' + (f" ({query})" if query.strip() else "")
    try:
        ids = col.find_notes(search)
    except Exception as e:  # noqa: BLE001 - Anki's own message says what's wrong with the search
        raise ToolError(f"Anki couldn't read that search ({e}).") from e
    out = []
    for nid in ids:
        note = col.get_note(nid)
        out.append((note, dict(note.items()), list(note.tags)))
    return out


def register(server: MCPServer, cm: CollectionManager) -> None:
    """Adds note_guide, lint_notes and empty_cards."""

    @server.tool(annotations=READ)
    async def note_guide(language: str) -> dict[str, Any]:
        """How an Omnilanguage note is written, for one language ("thai", "german", "japanese"...):
        the rule for every field, what that language's nouns and verbs carry, the values the list
        fields take, and one finished note. Read it before add_notes or update_notes on a language's
        notes: they tidy what needs no judgment and refuse the rest, with the reason."""
        return omnilanguage.guide(language)

    @server.tool(annotations=WRITE)
    async def lint_notes(
        query: str = "",
        rules: list[str] | None = None,
        fix: Literal["none", "preview", "apply"] = "none",
        limit: int = 20,
    ) -> dict[str, Any]:
        """Checks the Omnilanguage notes matching `query` (Anki's search syntax; all of them when
        empty) against the house style, and reports each rule broken: what it is, how many notes,
        whether a fix needs no judgment (`fixable`), the note ids (up to 200) and a few examples.
        `rules` narrows the report to some rules. Levels: "format" and "required" are what add_notes
        would refuse, "gap" is grammar still to fill, "review" needs a person to read it.

        fix="preview" shows what the fixable rules would change, `limit` notes per rule, and writes
        nothing. fix="apply" writes them: name the `rules` to apply (the ones the user saw
        previewed), since Entry changes among them (an article dropped, an aspect pair split) show
        on the card. A note whose new Entry another note already has is skipped and listed. Only
        fixes that need no judgment are ever applied; everything else is for update_notes."""
        if rules:
            unknown = [r for r in rules if r not in omnilanguage.RULES and r != DUPLICATE]
            if unknown:
                raise ToolError(f"No rule called {', '.join(unknown)}. Rules: {', '.join(omnilanguage.RULES)}, {DUPLICATE}.")
        if fix == "apply" and not rules:
            raise ToolError('Name the rules to apply (fix="preview" lists what each would change). Nothing was changed.')
        shown = max(1, min(limit, 100))

        def run(col: Collection) -> dict[str, Any]:
            notes = survey(col, query)
            wanted = set(rules) if rules else None
            found: dict[str, list[tuple[int, str, str, str]]] = defaultdict(list)  # rule -> (note id, entry, field, value)
            levels: dict[str, str] = {}
            words: dict[tuple[str, str], list[int]] = defaultdict(list)
            for note, fields, tags in notes:
                entry = omnilanguage.plain(fields.get("Entry", ""))
                words[(omnilanguage.plain(fields.get("Language", "")).lower(), _bare(entry))].append(note.id)
                for p in omnilanguage.problems(fields, tags):
                    if wanted is None or p.rule in wanted:
                        value = " ".join(tags) if p.field == "tags" else fields.get(p.field, "")
                        found[p.rule].append((note.id, entry, p.field, value))
                        levels[p.rule] = p.level
            report = [{
                "rule": rule, "what": omnilanguage.RULES[rule], "level": levels[rule], "fixable": rule in omnilanguage.FIXABLE,
                "notes": len({nid for nid, *_ in hits}), "note_ids": list(dict.fromkeys(nid for nid, *_ in hits))[:MAX_LISTED],
                "examples": [{"note_id": nid, "entry": entry, "field": name, "value": _short(value)} for nid, entry, name, value in hits[:3]],
            } for rule, hits in sorted(found.items(), key=lambda kv: -len(kv[1]))]  # fmt: skip
            if wanted is None or DUPLICATE in wanted:
                twice = {key: ids for key, ids in words.items() if key[1] and len(ids) > 1}
                if twice:
                    report.append({
                        "rule": DUPLICATE, "what": "The same word twice in one language (a homograph is fine: check their meanings)",
                        "level": "review", "fixable": False, "notes": sum(len(ids) for ids in twice.values()),
                        "groups": [{"language": lang, "entry": word, "note_ids": ids} for (lang, word), ids in list(twice.items())[:MAX_LISTED]],
                    })  # fmt: skip
            out: dict[str, Any] = {"checked": len(notes), "rules": report}
            if fix == "none":
                return out

            by_rule: Counter[str] = Counter()
            samples: dict[str, list[dict[str, Any]]] = defaultdict(list)
            skipped: list[dict[str, Any]] = []
            # Entries as written, by language: a fix may not turn one note's Entry into another's.
            taken = {(omnilanguage.plain(f.get("Language", "")).lower(), omnilanguage.plain(f.get("Entry", "")).lower()) for _, f, _ in notes}
            changed = 0
            for note, fields, tags in notes:
                fixed = omnilanguage.fix(fields, tags, rules=rules)
                names = set(fields)
                if any(n != "tags" and n not in names for p in fixed.applied for n in (p.fix or {})):
                    continue  # a fix for a field this note type doesn't have
                if not fixed.applied:
                    continue
                language = omnilanguage.plain(fields.get("Language", "")).lower()
                old_word, new_word = omnilanguage.plain(fields.get("Entry", "")).lower(), omnilanguage.plain(fixed.fields.get("Entry", "")).lower()
                if new_word != old_word and (language, new_word) in taken:
                    skipped.append({"note_id": note.id, "entry": omnilanguage.plain(fields.get("Entry", "")),
                                    "reason": f'Another note already has "{new_word}". Merge them, or tell them apart, by hand.'})  # fmt: skip
                    continue
                taken.add((language, new_word))
                changes = {n: {"from": _short(fields.get(n, "")), "to": _short(v)} for n, v in fixed.fields.items() if fields.get(n, "") != v}
                if fixed.tags != tags:
                    changes["tags"] = {"from": " ".join(tags), "to": " ".join(fixed.tags)}
                for rule in {p.rule for p in fixed.applied}:
                    by_rule[rule] += 1
                    if len(samples[rule]) < shown:
                        samples[rule].append({"note_id": note.id, "changes": changes})
                if fix == "apply":
                    for name, value in fixed.fields.items():
                        if fields.get(name, "") != value:
                            note[name] = value
                    note.tags = fixed.tags
                    col.update_note(note)
                changed += 1
            out["fix"] = {
                "applied" if fix == "apply" else "would_change": changed,
                "by_rule": dict(by_rule.most_common()),
                "samples": samples,
                "skipped": skipped,
            }
            return out

        return await (cm.write(run) if fix == "apply" else cm.read(run))

    @server.tool(annotations=DESTRUCTIVE)
    async def empty_cards(apply: bool = False, include_reviewed: bool = False) -> dict[str, Any]:
        """Cards whose note no longer makes them (an Omnilanguage note whose GenerateReverse or
        GenerateAudioCard was cleared keeps the old card), as Anki's Empty Cards finds them: how
        many, by note type and card type, and how many were ever reviewed. With `apply`, deletes
        the ones never reviewed; `include_reviewed` deletes the reviewed ones too, with their
        history. A note's last card is never deleted. Deleting can't be undone here: show the user
        the counts first."""

        def run(col: Collection) -> dict[str, Any]:
            report = col.get_empty_cards()
            kinds: Counter[tuple[str, str]] = Counter()
            fresh: list[int] = []
            reviewed: list[int] = []
            kept_last = 0
            for entry in report.notes:
                if entry.will_delete_note:
                    kept_last += len(entry.card_ids)
                    continue
                for cid in entry.card_ids:
                    card = col.get_card(cid)
                    note_type = card.note_type()
                    kinds[(note_type["name"], card.template()["name"])] += 1
                    (reviewed if card.reps else fresh).append(cid)
            out: dict[str, Any] = {
                "empty": len(fresh) + len(reviewed), "never_reviewed": len(fresh), "reviewed": len(reviewed),
                "by_kind": [{"note_type": nt, "card_type": ct, "cards": n} for (nt, ct), n in kinds.most_common()],
                "left_alone": kept_last,
            }  # fmt: skip
            if apply:
                doomed = fresh + (reviewed if include_reviewed else [])
                if doomed:
                    col.remove_cards_and_orphaned_notes(doomed)
                out["deleted"] = len(doomed)
            return out

        return await (cm.write(run) if apply else cm.read(run))
