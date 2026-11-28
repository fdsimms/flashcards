"""Content audits: checks Claude makes by reading notes, which need judgment no rule in omnilanguage.py can
make ("does Sense say what the word doesn't cover?"), run a batch at a time and remembered per note.

An audit is a file in `audit_definitions/`: the notes it covers (an Anki search), the fields it reads,
and its checks, each with a version. What's remembered is per note and per check, not per run: which
version of the check passed which content (a hash of the audit's fields), when and by whom. So a note
added or edited since its check, or a check whose version went up, is due again, and a run can stop
after any batch without losing what it covered.

What an audit finds is flagged the way the user flags a card in Franki (the purple flag and a flag::
reason tag), so it reaches the one place fixes are made: flagged_cards shows the finding, and
resolve_flag closes it once the user has decided. The records live beside the collection
(`audits.sqlite` in the MCP's data folder), not in it: a row per note and check would sync to every
device for nothing. Losing the file loses only the record of what was checked."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import tomllib
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from anki.collection import Collection  # first: the anki package's modules import each other
from anki.utils import ids2str
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import BaseModel, Field

from .collection import CollectionManager
from .tools import AGENT_FLAG, FLAG_REASONS, FLAG_TAG_PREFIX, READ, WRITE, _deck_id, _deck_name, search_text

DEFINITIONS = Path(__file__).parent / "audit_definitions"
BATCH_MAX = 25


@dataclass(frozen=True)
class Check:
    id: str
    version: int
    flag_reason: str
    ask: str


@dataclass(frozen=True)
class Audit:
    id: str
    title: str
    about: str
    scope: str
    fields: tuple[str, ...]
    checks: tuple[Check, ...]

    def check(self, check_id: str) -> Check | None:
        return next((c for c in self.checks if c.id == check_id), None)

    def content_hash(self, fields: dict[str, str]) -> str:
        """What the checks read, as a short hash: a note whose hash differs from its record has changed."""
        text = json.dumps([fields.get(f, "") for f in self.fields], ensure_ascii=False)
        return hashlib.sha256(text.encode()).hexdigest()[:16]


def load_definitions(folder: Path = DEFINITIONS) -> dict[str, Audit]:
    """Every audit in `folder`, by its file's name. A malformed file stops the server from starting,
    so a broken definition can't deploy and then fail at the first call."""
    audits: dict[str, Audit] = {}
    for path in sorted(folder.glob("*.toml")):
        raw = tomllib.loads(path.read_text())
        checks = tuple(Check(c["id"], int(c["version"]), c["flag_reason"], c["ask"].strip()) for c in raw["checks"])
        ids = [c.id for c in checks]
        if len(set(ids)) != len(ids):
            raise ValueError(f"{path.name}: two checks share an id.")
        for c in checks:
            if c.flag_reason not in FLAG_REASONS:
                raise ValueError(f"{path.name}: check {c.id}'s flag_reason {c.flag_reason!r} isn't one of {', '.join(FLAG_REASONS)}.")
            if c.version < 1:
                raise ValueError(f"{path.name}: check {c.id}'s version starts at 1.")
        audits[path.stem] = Audit(path.stem, raw["title"], raw["about"].strip(), raw["scope"], tuple(raw["fields"]), checks)
    return audits


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class AuditStore:
    """The audit definitions and what's been checked against them (sqlite, beside the collection)."""

    def __init__(self, db_path: Path, definitions: dict[str, Audit] | None = None):
        self.audits = load_definitions() if definitions is None else definitions
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(db_path, check_same_thread=False, isolation_level=None)
        self._db.executescript("""
            CREATE TABLE IF NOT EXISTS checked (
                audit TEXT NOT NULL, check_id TEXT NOT NULL, note_id INTEGER NOT NULL,
                version INTEGER NOT NULL, content_hash TEXT NOT NULL, checked_at TEXT NOT NULL, checked_by TEXT NOT NULL,
                PRIMARY KEY (audit, check_id, note_id));
            CREATE TABLE IF NOT EXISTS findings (
                id INTEGER PRIMARY KEY, audit TEXT NOT NULL, check_id TEXT NOT NULL, note_id INTEGER NOT NULL,
                problem TEXT NOT NULL, suggestion TEXT, found_at TEXT NOT NULL, found_by TEXT NOT NULL,
                closed_at TEXT, closed_how TEXT);
            CREATE INDEX IF NOT EXISTS open_findings ON findings (note_id) WHERE closed_at IS NULL;
            CREATE TABLE IF NOT EXISTS runs (
                audit TEXT NOT NULL, at TEXT NOT NULL, checked_by TEXT NOT NULL, notes INTEGER NOT NULL, findings INTEGER NOT NULL);
        """)

    def audit(self, audit_id: str) -> Audit:
        found = self.audits.get(audit_id)
        if found is None:
            raise ToolError(f"There's no audit called {audit_id!r}. Audits: {', '.join(self.audits) or 'none'}.")
        return found

    # ---- what's been checked ----

    def records(self, audit: Audit) -> dict[int, dict[str, tuple[int, str]]]:
        """Each note's records for `audit`: check id to (version, content hash)."""
        out: dict[int, dict[str, tuple[int, str]]] = {}
        for check_id, nid, version, h in self._db.execute(
                "SELECT check_id, note_id, version, content_hash FROM checked WHERE audit = ?", (audit.id,)):
            out.setdefault(nid, {})[check_id] = (version, h)
        return out

    def record(self, audit: Audit, note_id: int, content_hash: str, checked_by: str, at: str) -> None:
        self._db.executemany(
            "INSERT OR REPLACE INTO checked VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(audit.id, c.id, note_id, c.version, content_hash, at, checked_by) for c in audit.checks])

    def add_finding(self, audit: Audit, note_id: int, check_id: str, problem: str, suggestion: str | None, by: str, at: str) -> None:
        self._db.execute(
            "INSERT INTO findings (audit, check_id, note_id, problem, suggestion, found_at, found_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (audit.id, check_id, note_id, problem, suggestion, at, by))

    def add_run(self, audit: Audit, checked_by: str, notes: int, findings: int, at: str) -> None:
        self._db.execute("INSERT INTO runs VALUES (?, ?, ?, ?, ?)", (audit.id, at, checked_by, notes, findings))

    def last_run(self, audit: Audit) -> dict[str, Any] | None:
        row = self._db.execute(
            "SELECT at, checked_by, notes, findings FROM runs WHERE audit = ? ORDER BY rowid DESC LIMIT 1", (audit.id,)).fetchone()
        return None if row is None else {"at": row[0], "checked_by": row[1], "notes": row[2], "findings": row[3]}

    # ---- findings ----

    def open_findings(self, note_ids: list[int] | None = None, audit: Audit | None = None) -> list[dict[str, Any]]:
        where, args = ["closed_at IS NULL"], []
        if note_ids is not None:
            where.append(f"note_id IN {ids2str(note_ids)}")
        if audit is not None:
            where.append("audit = ?")
            args.append(audit.id)
        rows = self._db.execute(
            f"SELECT id, audit, check_id, note_id, problem, suggestion, found_at, found_by FROM findings WHERE {' AND '.join(where)} ORDER BY id",
            args).fetchall()
        return [{"finding_id": r[0], "audit": r[1], "check": r[2], "note_id": r[3], "problem": r[4], "suggestion": r[5],
                 "found_at": r[6], "found_by": r[7]} for r in rows]

    def close_findings(self, note_id: int, fields: dict[str, str] | None, how: str, audit: Audit | None = None) -> list[str]:
        """Closes `note_id`'s open findings (only `audit`'s, when given). With `fields` (the note as the
        user approved it), each audit that had one counts that content as checked, so the fixed note
        isn't due again."""
        at = _now()
        only, args = ("", ()) if audit is None else (" AND audit = ?", (audit.id,))
        audits = [a for (a,) in self._db.execute(
            f"SELECT DISTINCT audit FROM findings WHERE note_id = ? AND closed_at IS NULL{only}", (note_id, *args))]
        self._db.execute(f"UPDATE findings SET closed_at = ?, closed_how = ? WHERE note_id = ? AND closed_at IS NULL{only}",
                         (at, how, note_id, *args))
        if fields is not None:
            for audit_id in audits:
                if audit_id in self.audits:
                    self._db.execute("UPDATE checked SET content_hash = ? WHERE audit = ? AND note_id = ?",
                                     (self.audits[audit_id].content_hash(fields), audit_id, note_id))
        return audits

    def close_unflagged(self, col: Collection) -> int:
        """Closes open findings whose note is gone or no longer flagged for an agent (cleared in
        Franki or Anki rather than with resolve_flag). Their records stay as they were, so a note
        edited since its check is due again."""
        open_ids = sorted({f["note_id"] for f in self.open_findings()})
        if not open_ids:
            return 0
        flagged = set(col.db.list(f"SELECT DISTINCT nid FROM cards WHERE nid IN {ids2str(open_ids)} AND (flags & 7) = {AGENT_FLAG}"))
        gone = [nid for nid in open_ids if nid not in flagged]
        for nid in gone:
            self.close_findings(nid, None, "flag cleared elsewhere")
        return len(gone)


# ---- the notes an audit covers ----


def _scope_query(col: Collection, audit: Audit, deck: str | None) -> str:
    query = f"({audit.scope})"
    if deck:
        query += f' "deck:{search_text(_deck_name(col, _deck_id(col, deck)))}"'
    return query


def _notes(col: Collection, audit: Audit, note_ids: list[int]) -> dict[int, dict[str, str]]:
    """The audit's fields of each note, read in one query (a note type without a field gives it as "")."""
    names: dict[int, list[str]] = {}
    out: dict[int, dict[str, str]] = {}
    for nid, mid, flds in col.db.all(f"SELECT id, mid, flds FROM notes WHERE id IN {ids2str(note_ids)}"):
        if mid not in names:
            nt = col.models.get(mid)
            names[mid] = [f["name"] for f in nt["flds"]] if nt else []
        have = dict(zip(names[mid], flds.split("\x1f")))
        out[nid] = {f: have.get(f, "") for f in audit.fields}
    return out


STATE_ORDER = ("unchecked", "edited", "check_changed")


def _state(audit: Audit, records: dict[str, tuple[int, str]] | None, content_hash: str) -> tuple[str | None, list[str]]:
    """Why a note is due for `audit` (None when it isn't), and the checks that are due on it."""
    if not records:
        return "unchecked", [c.id for c in audit.checks]
    if any(h != content_hash for _, h in records.values()):
        return "edited", [c.id for c in audit.checks]
    due = [c.id for c in audit.checks if c.id not in records or records[c.id][0] < c.version]
    return ("check_changed", due) if due else (None, [])


def coverage(col: Collection, store: AuditStore, audit: Audit, deck: str | None) -> list[dict[str, Any]]:
    """Every note in the audit's scope with why it's due (or None) and its checks due, the notes with
    the most lapses first (a card often forgotten is the likeliest to be a bad card), then the newest."""
    ids = list(col.find_notes(_scope_query(col, audit, deck)))
    if not ids:
        return []
    fields = _notes(col, audit, ids)
    lapses = dict(col.db.all(f"SELECT nid, MAX(lapses) FROM cards WHERE nid IN {ids2str(ids)} GROUP BY nid"))
    records = store.records(audit)
    out = []
    for nid in ids:
        h = audit.content_hash(fields[nid])
        state, due = _state(audit, records.get(nid), h)
        out.append({"note_id": nid, "state": state, "checks_due": due, "content_hash": h,
                    "lapses": lapses.get(nid, 0), "fields": fields[nid]})
    out.sort(key=lambda n: (-n["lapses"], -n["note_id"]))
    return out


class Finding(BaseModel):
    check: str = Field(description="The id of the check that failed, from next_audit_batch's checks.")
    problem: str = Field(description="What's wrong, in a sentence the user will read on the flagged card.")
    suggestion: str | None = Field(default=None, description="The fix you'd make, e.g. the field and its new text.")


class Checked(BaseModel):
    note_id: int
    content_hash: str = Field(description="The note's content_hash exactly as next_audit_batch gave it.")
    findings: list[Finding] = Field(default_factory=list, description="Empty when the note passed every check due on it.")


def register(server: MCPServer, cm: CollectionManager, store: AuditStore) -> None:
    """Adds list_audits, next_audit_batch and record_audit."""

    @server.tool(annotations=READ)
    async def list_audits(deck: str | None = None) -> dict[str, Any]:
        """The content audits there are: checks you make by reading notes, for what needs judgment
        (lint_notes covers the rest). For each, its checks, how many notes in its scope (`deck` narrows
        it to one deck and its subdecks) are checked against the current checks and how many are due
        (never checked, edited since, or a check changed since), its open findings, and its last run
        (when, by whom, how many notes, how many findings). Run one with next_audit_batch."""

        def run(col: Collection) -> dict[str, Any]:
            store.close_unflagged(col)
            out = []
            for audit in store.audits.values():
                notes = coverage(col, store, audit, deck)
                counts = {s: sum(1 for n in notes if n["state"] == s) for s in STATE_ORDER}
                out.append({
                    "audit": audit.id, "title": audit.title, "about": audit.about,
                    "checks": [{"id": c.id, "version": c.version} for c in audit.checks],
                    "notes": len(notes), "checked": sum(1 for n in notes if n["state"] is None), "due": counts,
                    "open_findings": len(store.open_findings(audit=audit)), "last_run": store.last_run(audit),
                })
            return {"audits": out}

        return await cm.read(run)

    @server.tool(annotations=READ)
    async def next_audit_batch(audit: str, deck: str | None = None, limit: int = 10) -> dict[str, Any]:
        """The next notes due for `audit` (list_audits names them), with the checks to make, the
        notes most often forgotten first. `deck` narrows it to one deck and its subdecks; `limit` is at
        most 25. Each note comes with its fields as HTML (only the ones the audit reads and the note
        fills), why it's due, the checks due on it, and its `content_hash`, which record_audit needs back.

        Read note_guide for the notes' language first, then judge each note against each check due on it.
        A finding is something you're confident is wrong, not a matter of taste. Then call record_audit
        with every note you checked, passed or not, before fixing anything."""

        def run(col: Collection) -> dict[str, Any]:
            a = store.audit(audit)
            notes = coverage(col, store, a, deck)
            due = [n for n in notes if n["state"] is not None]
            page = due[: max(1, min(limit, BATCH_MAX))]
            for n in page:
                cards = col.find_cards(f"nid:{n['note_id']}")
                n["deck"] = _deck_name(col, col.get_card(cards[0]).did) if cards else None
                n["fields"] = {k: v for k, v in n["fields"].items() if v.strip()}
            return {
                "audit": a.id, "about": a.about,
                "checks": [{"id": c.id, "ask": c.ask} for c in a.checks],
                "due": len(due), "notes": page,
            }

        return await cm.read(run)

    @server.tool(annotations=WRITE)
    async def record_audit(audit: str, checked: list[Checked], checked_by: str) -> dict[str, Any]:
        """Saves which notes you checked for `audit`, from next_audit_batch: every note passed or
        not, with the findings on each. `checked_by` is who did the checking (your model's name, or
        "user" for a note the user checked themselves). Call it right after checking a batch, before
        fixing anything: a note changed since next_audit_batch read it is refused, with the reason.
        Leave out a finding the user has already dismissed.

        A note with findings is flagged for an agent (the purple flag, and a flag:: reason tag unless
        it already has one), so the user sees it in Franki and flagged_cards lists it with its
        `audit_findings`. Fix those as any flag: show the change, update_notes once the user approves,
        then resolve_flag, which closes the findings and counts the fixed note as checked."""

        a = store.audit(audit)
        if not checked_by.strip():
            raise ToolError("Say who did the checking in checked_by: your model's name, or \"user\".")

        def run(col: Collection) -> list[dict[str, Any]]:
            ids = [c.note_id for c in checked]
            current = _notes(col, a, ids) if ids else {}
            results = []
            for c in checked:
                if c.note_id not in current:
                    results.append({"note_id": c.note_id, "recorded": False, "reason": "There's no such note any more."})
                    continue
                if a.content_hash(current[c.note_id]) != c.content_hash:
                    results.append({"note_id": c.note_id, "recorded": False, "reason": (
                        "The note changed since next_audit_batch read it (or the content_hash isn't the one it gave). "
                        "Nothing was recorded for it; it's still due, so the next batch has it as it is now.")})
                    continue
                unknown = [f.check for f in c.findings if a.check(f.check) is None]
                if unknown:
                    results.append({"note_id": c.note_id, "recorded": False, "reason": (
                        f"{a.id} has no check {', '.join(unknown)}. Its checks: {', '.join(x.id for x in a.checks)}. Nothing was recorded for it.")})
                    continue
                flagged = False
                if c.findings:
                    note = col.get_note(c.note_id)
                    cards = sorted(note.cards(), key=lambda card: card.ord)
                    if not any(card.user_flag() == AGENT_FLAG for card in cards):
                        col.set_user_flag_for_cards(AGENT_FLAG, [cards[0].id])
                    if not any(t.lower().startswith(FLAG_TAG_PREFIX) for t in note.tags):
                        note.add_tag(FLAG_TAG_PREFIX + a.check(c.findings[0].check).flag_reason)
                        col.update_note(note)
                    flagged = True
                results.append({"note_id": c.note_id, "recorded": True, "findings": len(c.findings), "flagged": flagged})
            return results

        needs_write = any(c.findings for c in checked)
        results = await (cm.write(run) if needs_write else cm.read(run))
        at = _now()
        by = {c.note_id: c for c in checked}
        recorded = [r for r in results if r["recorded"]]
        for r in recorded:
            c = by[r["note_id"]]
            # A note checked again replaces what the last check found on it.
            store.close_findings(c.note_id, None, "checked again", a)
            store.record(a, c.note_id, c.content_hash, checked_by.strip(), at)
            for f in c.findings:
                store.add_finding(a, c.note_id, f.check, f.problem.strip(), (f.suggestion or "").strip() or None, checked_by.strip(), at)
        if recorded:
            store.add_run(a, checked_by.strip(), len(recorded), sum(r["findings"] for r in recorded), at)
        return {"recorded": len(recorded), "results": results}
