"""Content audits: checks Claude makes by reading what was written (a note, a grammar page, a Read & Listen
text), which need judgment no rule in omnilanguage.py can make ("does Sense say what the word doesn't
cover?"), run a batch at a time and remembered per item.

An audit is a file in `audit_definitions/`: where its items come from (`source`), and its checks, each
with a version. What's remembered is per item and per check, not per run: which version of the check
passed which content (a hash of what the checks read), when and by whom. So an item added or changed
since its check, or a check whose version went up, is due again, and a run can stop after any batch
without losing what it covered. Each run is kept too, for when it ran and how often it found something.

Where a finding goes depends on the source. On a note it's flagged the way the user flags a card in
Franki (the purple flag and a flag:: reason tag), so it reaches the one place a note's fixes are made:
flagged_cards shows the finding, and resolve_flag closes it once the user has decided. A grammar page or
a text has no flag, so its findings wait in audit_findings until close_audit_findings. The records live
beside the collection (`audits.sqlite` in the MCP's data folder), not in it: a row per note and check
would sync to every device for nothing. Losing the file loses only the record of what was checked."""

from __future__ import annotations

import hashlib
import json
import random
import sqlite3
import tomllib
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from anki.collection import Collection  # first: the anki package's modules import each other
from anki.utils import ids2str
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import BaseModel, Field

from .collection import CollectionManager
from .reader import ReaderClient
from .tools import AGENT_FLAG, FLAG_REASONS, FLAG_TAG_PREFIX, READ, WRITE, _deck_id, _deck_name, search_text

DEFINITIONS = Path(__file__).parent / "audit_definitions"
# Where an audit's items come from: the collection's notes (an Anki search), or what Read & Listen's
# server wrote, read through its audit routes (reader.py's tools read the same ones).
SOURCES = ("notes", "grammar_pages", "texts")
# The most items one batch can hold: a text is long, so a text audit sets a lower `batch_max`.
BATCH_MAX = 25
# The most texts one listing returns (the server's own cap): a text audit's window holds at most this many.
TEXTS_LISTED = 200


@dataclass(frozen=True)
class Check:
    id: str
    version: int
    flag_reason: str | None
    ask: str


@dataclass(frozen=True)
class Audit:
    id: str
    title: str
    about: str
    source: str
    checks: tuple[Check, ...]
    scope: str = ""  # notes: the Anki search
    fields: tuple[str, ...] = ()  # notes: the fields the checks read
    window_days: int | None = None  # texts: only those written in the last this many days
    sample: bool = False  # take a batch at random rather than newest (or most forgotten) first
    batch_max: int = BATCH_MAX

    def check(self, check_id: str) -> Check | None:
        return next((c for c in self.checks if c.id == check_id), None)

    def content_hash(self, fields: dict[str, str]) -> str:
        """A note's audited fields, as a short hash: a note whose hash differs from its record has changed."""
        return digest([fields.get(f, "") for f in self.fields])


def digest(content: Any) -> str:
    return hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]


def load_definitions(folder: Path = DEFINITIONS) -> dict[str, Audit]:
    """Every audit in `folder`, by its file's name. A malformed file stops the server from starting,
    so a broken definition can't deploy and then fail at the first call."""
    audits: dict[str, Audit] = {}
    for path in sorted(folder.glob("*.toml")):
        raw = tomllib.loads(path.read_text())
        source = raw.get("source", "notes")
        if source not in SOURCES:
            raise ValueError(f"{path.name}: source {source!r} isn't one of {', '.join(SOURCES)}.")
        checks = tuple(Check(c["id"], int(c["version"]), c.get("flag_reason"), c["ask"].strip()) for c in raw["checks"])
        ids = [c.id for c in checks]
        if len(set(ids)) != len(ids):
            raise ValueError(f"{path.name}: two checks share an id.")
        for c in checks:
            if source == "notes" and c.flag_reason not in FLAG_REASONS:
                raise ValueError(f"{path.name}: check {c.id}'s flag_reason {c.flag_reason!r} isn't one of {', '.join(FLAG_REASONS)}.")
            if source != "notes" and c.flag_reason is not None:
                raise ValueError(f"{path.name}: check {c.id} has a flag_reason, but only a note can be flagged.")
            if c.version < 1:
                raise ValueError(f"{path.name}: check {c.id}'s version starts at 1.")
        if source == "notes" and not (raw.get("scope") and raw.get("fields")):
            raise ValueError(f"{path.name}: an audit of notes needs a scope and fields.")
        audits[path.stem] = Audit(
            path.stem, raw["title"], raw["about"].strip(), source, checks, raw.get("scope", ""), tuple(raw.get("fields", ())),
            raw.get("window_days"), bool(raw.get("sample", False)), min(int(raw.get("batch_max", BATCH_MAX)), BATCH_MAX))
    return audits


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class AuditStore:
    """The audit definitions and what's been checked against them (sqlite, beside the collection).
    An item is a note's id, a text's id, or a grammar page as `kind:id`, always as text."""

    def __init__(self, db_path: Path, definitions: dict[str, Audit] | None = None):
        self.audits = load_definitions() if definitions is None else definitions
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(db_path, check_same_thread=False, isolation_level=None)
        self._db.executescript("""
            CREATE TABLE IF NOT EXISTS checked (
                audit TEXT NOT NULL, check_id TEXT NOT NULL, item TEXT NOT NULL,
                version INTEGER NOT NULL, content_hash TEXT NOT NULL, checked_at TEXT NOT NULL, checked_by TEXT NOT NULL,
                PRIMARY KEY (audit, check_id, item));
            CREATE TABLE IF NOT EXISTS findings (
                id INTEGER PRIMARY KEY, audit TEXT NOT NULL, check_id TEXT NOT NULL, item TEXT NOT NULL,
                problem TEXT NOT NULL, suggestion TEXT, found_at TEXT NOT NULL, found_by TEXT NOT NULL,
                closed_at TEXT, closed_how TEXT);
            CREATE INDEX IF NOT EXISTS open_findings ON findings (item) WHERE closed_at IS NULL;
            CREATE TABLE IF NOT EXISTS runs (
                audit TEXT NOT NULL, at TEXT NOT NULL, checked_by TEXT NOT NULL, items INTEGER NOT NULL, findings INTEGER NOT NULL);
        """)

    def audit(self, audit_id: str) -> Audit:
        found = self.audits.get(audit_id)
        if found is None:
            raise ToolError(f"There's no audit called {audit_id!r}. Audits: {', '.join(self.audits) or 'none'}.")
        return found

    # ---- what's been checked ----

    def records(self, audit: Audit) -> dict[str, dict[str, tuple[int, str]]]:
        """Each item's records for `audit`: check id to (version, content hash)."""
        out: dict[str, dict[str, tuple[int, str]]] = {}
        for check_id, item, version, h in self._db.execute(
                "SELECT check_id, item, version, content_hash FROM checked WHERE audit = ?", (audit.id,)):
            out.setdefault(item, {})[check_id] = (version, h)
        return out

    def record(self, audit: Audit, item: str, content_hash: str, checked_by: str, at: str) -> None:
        self._db.executemany(
            "INSERT OR REPLACE INTO checked VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(audit.id, c.id, item, c.version, content_hash, at, checked_by) for c in audit.checks])

    def add_finding(self, audit: Audit, item: str, check_id: str, problem: str, suggestion: str | None, by: str, at: str) -> None:
        self._db.execute(
            "INSERT INTO findings (audit, check_id, item, problem, suggestion, found_at, found_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (audit.id, check_id, item, problem, suggestion, at, by))

    def add_run(self, audit: Audit, checked_by: str, items: int, findings: int, at: str) -> None:
        self._db.execute("INSERT INTO runs VALUES (?, ?, ?, ?, ?)", (audit.id, at, checked_by, items, findings))

    def last_run(self, audit: Audit) -> dict[str, Any] | None:
        row = self._db.execute(
            "SELECT at, checked_by, items, findings FROM runs WHERE audit = ? ORDER BY rowid DESC LIMIT 1", (audit.id,)).fetchone()
        return None if row is None else {"at": row[0], "checked_by": row[1], "items": row[2], "findings": row[3]}

    def by_month(self, audit: Audit, months: int = 6) -> list[dict[str, Any]]:
        """The items checked and findings made in each of the last `months` months with a run, newest
        first: a share of findings that climbs says what's being written got worse."""
        rows = self._db.execute(
            "SELECT substr(at, 1, 7), SUM(items), SUM(findings) FROM runs WHERE audit = ? GROUP BY 1 ORDER BY 1 DESC LIMIT ?",
            (audit.id, months)).fetchall()
        return [{"month": m, "items": n, "findings": f, "findings_per_item": round(f / n, 2) if n else 0} for m, n, f in rows]

    # ---- findings ----

    def open_findings(self, items: list[str] | None = None, audit: Audit | None = None, limit: int | None = None) -> list[dict[str, Any]]:
        where, args = ["closed_at IS NULL"], []
        if items is not None:
            where.append(f"item IN ({', '.join('?' for _ in items)})")
            args += items
        if audit is not None:
            where.append("audit = ?")
            args.append(audit.id)
        rows = self._db.execute(
            f"SELECT id, audit, check_id, item, problem, suggestion, found_at, found_by FROM findings WHERE {' AND '.join(where)} ORDER BY id"
            + (f" LIMIT {int(limit)}" if limit else ""), args).fetchall()
        return [{"finding_id": r[0], "audit": r[1], "check": r[2], "item_id": r[3], "problem": r[4], "suggestion": r[5],
                 "found_at": r[6], "found_by": r[7]} for r in rows]

    def finding_audits(self, finding_ids: list[int]) -> dict[int, tuple[str, str | None]]:
        """Each finding's audit and, when it's still open, None; else how it was closed."""
        rows = self._db.execute(
            f"SELECT id, audit, closed_how FROM findings WHERE id IN ({', '.join('?' for _ in finding_ids)})", finding_ids)
        return {r[0]: (r[1], r[2]) for r in rows}

    def close_finding_ids(self, finding_ids: list[int], how: str) -> None:
        self._db.execute(
            f"UPDATE findings SET closed_at = ?, closed_how = ? WHERE closed_at IS NULL AND id IN ({', '.join('?' for _ in finding_ids)})",
            (_now(), how, *finding_ids))

    def close_findings(self, item: str, fields: dict[str, str] | None, how: str, audit: Audit | None = None) -> list[str]:
        """Closes a note's open findings (only `audit`'s, when given). With `fields` (the note as the
        user approved it), each audit that had one counts that content as checked, so the fixed note
        isn't due again."""
        only, args = ("", ()) if audit is None else (" AND audit = ?", (audit.id,))
        audits = [a for (a,) in self._db.execute(
            f"SELECT DISTINCT audit FROM findings WHERE item = ? AND closed_at IS NULL{only}", (item, *args))]
        self._db.execute(f"UPDATE findings SET closed_at = ?, closed_how = ? WHERE item = ? AND closed_at IS NULL{only}",
                         (_now(), how, item, *args))
        if fields is not None:
            for audit_id in audits:
                known = self.audits.get(audit_id)
                if known is not None and known.source == "notes":
                    self._db.execute("UPDATE checked SET content_hash = ? WHERE audit = ? AND item = ?",
                                     (known.content_hash(fields), audit_id, item))
        return audits

    def close_unflagged(self, col: Collection) -> int:
        """Closes open findings on notes that are gone or no longer flagged for an agent (cleared in
        Franki or Anki rather than with resolve_flag). Their records stay as they were, so a note
        edited since its check is due again."""
        note_audits = [a.id for a in self.audits.values() if a.source == "notes"]
        if not note_audits:
            return 0
        rows = self._db.execute(
            f"SELECT DISTINCT item FROM findings WHERE closed_at IS NULL AND audit IN ({', '.join('?' for _ in note_audits)})", note_audits)
        open_ids = sorted(int(item) for (item,) in rows)
        if not open_ids:
            return 0
        flagged = set(col.db.list(f"SELECT DISTINCT nid FROM cards WHERE nid IN {ids2str(open_ids)} AND (flags & 7) = {AGENT_FLAG}"))
        gone = [nid for nid in open_ids if nid not in flagged]
        for nid in gone:
            self.close_findings(str(nid), None, "flag cleared elsewhere")
        return len(gone)


# ---- where an audit's items come from ----
# Each source gives the items in the audit's scope as dicts with `item_id`, `content_hash` and an
# order of its own (most forgotten, or newest, first), and fills in a batch's content separately, so
# counting what's due never reads every item in full.


def _scope_query(col: Collection, audit: Audit, deck: str | None) -> str:
    query = f"({audit.scope})"
    if deck:
        query += f' "deck:{search_text(_deck_name(col, _deck_id(col, deck)))}"'
    return query


def _note_fields(col: Collection, audit: Audit, note_ids: list[int]) -> dict[int, dict[str, str]]:
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


def note_items(col: Collection, audit: Audit, deck: str | None) -> list[dict[str, Any]]:
    """The notes in the audit's scope, the ones with the most lapses first (a card often forgotten is
    the likeliest to be a bad card), then the newest."""
    ids = list(col.find_notes(_scope_query(col, audit, deck)))
    if not ids:
        return []
    fields = _note_fields(col, audit, ids)
    lapses = dict(col.db.all(f"SELECT nid, MAX(lapses) FROM cards WHERE nid IN {ids2str(ids)} GROUP BY nid"))
    out = [{"item_id": str(nid), "content_hash": audit.content_hash(fields[nid]), "lapses": lapses.get(nid, 0),
            "fields": fields[nid], "_order": (-lapses.get(nid, 0), -nid)} for nid in ids]
    out.sort(key=lambda n: n["_order"])
    return out


async def reader_items(client: ReaderClient, audit: Audit, language: str | None) -> list[dict[str, Any]]:
    """The grammar pages or texts in the audit's scope, newest first, from Read & Listen's server."""
    if audit.source == "grammar_pages":
        pages = await client.get("/api/audit/grammar", {"language": language} if language else None)
        # A page being written, or whose write failed, has nothing to check yet.
        return [{"item_id": f"{p['kind']}:{p['id']}", "content_hash": p.get("digest") or digest(p), "language": p["language"],
                 "title": p["title"]} for p in pages if p["status"] == "ready"]
    params: dict[str, Any] = {"status": "shown", "limit": TEXTS_LISTED}
    if audit.window_days:
        params["days"] = audit.window_days
    if language:
        params["language"] = language
    # A text doesn't change once it's on the shelf, so its id is its content.
    return [{"item_id": str(t["id"]), "content_hash": digest(t["id"]), "language": t["language"], "title": t["title"]}
            for t in await client.get("/api/audit/texts", params)]


async def reader_content(client: ReaderClient, audit: Audit, item_id: str) -> dict[str, Any]:
    if audit.source == "grammar_pages":
        kind, _, page_id = item_id.partition(":")
        return await client.get(f"/api/audit/grammar/{kind}/{page_id}")
    return await client.get(f"/api/audit/texts/{item_id}")


STATE_ORDER = ("unchecked", "changed", "check_changed")


def _state(audit: Audit, records: dict[str, tuple[int, str]] | None, content_hash: str) -> tuple[str | None, list[str]]:
    """Why an item is due for `audit` (None when it isn't), and the checks that are due on it."""
    if not records:
        return "unchecked", [c.id for c in audit.checks]
    if any(h != content_hash for _, h in records.values()):
        return "changed", [c.id for c in audit.checks]
    due = [c.id for c in audit.checks if c.id not in records or records[c.id][0] < c.version]
    return ("check_changed", due) if due else (None, [])


def with_states(store: AuditStore, audit: Audit, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    records = store.records(audit)
    for item in items:
        item["state"], item["checks_due"] = _state(audit, records.get(item["item_id"]), item["content_hash"])
    return items


class Finding(BaseModel):
    check: str = Field(description="The id of the check that failed, from next_audit_batch's checks.")
    problem: str = Field(description="What's wrong, in a sentence the user will read.")
    suggestion: str | None = Field(default=None, description="The fix you'd make, e.g. the field and its new text.")


class Checked(BaseModel):
    item_id: str = Field(description="The item's item_id exactly as next_audit_batch gave it.")
    content_hash: str = Field(description="The item's content_hash exactly as next_audit_batch gave it.")
    findings: list[Finding] = Field(default_factory=list, description="Empty when it passed every check due on it.")


def register(server: MCPServer, cm: CollectionManager, store: AuditStore, client: ReaderClient) -> None:
    """Adds list_audits, next_audit_batch, record_audit, audit_findings and close_audit_findings."""

    async def items_of(audit: Audit, deck: str | None, language: str | None) -> list[dict[str, Any]]:
        if audit.source == "notes":
            return await cm.read(lambda col: with_states(store, audit, note_items(col, audit, deck)))
        return with_states(store, audit, await reader_items(client, audit, language))

    @server.tool(annotations=READ)
    async def list_audits(deck: str | None = None, language: str | None = None) -> dict[str, Any]:
        """The content audits there are: checks you make by reading what was written, for what needs
        judgment (lint_notes covers the rest). Each reads `source`: the collection's notes, or Read &
        Listen's grammar pages or texts. For each: its checks; how many items in its scope are checked
        against the current checks and how many are due (never checked, changed since, or a check
        changed since); its open findings; its last run (when, by whom, how many items and findings);
        and `by_month`, the share of items with findings in each recent month. `deck` narrows the
        note audits to one deck and its subdecks, `language` ("th", "pl"...) the Read & Listen ones.
        An audit whose items can't be read now says why in `unavailable`. Run one with next_audit_batch."""

        await cm.read(store.close_unflagged)
        out = []
        for audit in store.audits.values():
            entry: dict[str, Any] = {
                "audit": audit.id, "title": audit.title, "source": audit.source, "about": audit.about,
                "checks": [{"id": c.id, "version": c.version} for c in audit.checks],
                "open_findings": len(store.open_findings(audit=audit)), "last_run": store.last_run(audit),
                "by_month": store.by_month(audit),
            }
            try:
                items = await items_of(audit, deck, language)
            except ToolError as e:
                entry["unavailable"] = str(e)
            else:
                entry["items"] = len(items)
                entry["checked"] = sum(1 for i in items if i["state"] is None)
                entry["due"] = {s: sum(1 for i in items if i["state"] == s) for s in STATE_ORDER}
                if audit.window_days:
                    entry["window_days"] = audit.window_days
            out.append(entry)
        return {"audits": out}

    @server.tool(annotations=READ)
    async def next_audit_batch(audit: str, deck: str | None = None, language: str | None = None, limit: int = 10) -> dict[str, Any]:
        """The next items due for `audit` (list_audits names them), with the checks to make. Notes
        come most often forgotten first, a grammar page newest first, and a text audit picks its batch
        at random from the texts in its window (it's a sample, not a sweep). `deck` narrows a note
        audit to one deck and its subdecks, `language` ("th", "pl"...) a Read & Listen one; `limit` is
        at most 25 (fewer for texts, which are long). Each item comes with its content (a note's fields
        as HTML, only the ones the audit reads and the note fills; a page or text as
        get_grammar_page or get_read_and_listen_text gives it), why it's due, the checks due on it, and
        its `item_id` and `content_hash`, which record_audit needs back.

        For notes, read note_guide for their language first. Judge each item against each check due on
        it; a finding is something you're confident is wrong, not a matter of taste. Then call
        record_audit with every item you checked, passed or not, before fixing anything."""

        a = store.audit(audit)
        due = [i for i in await items_of(a, deck, language) if i["state"] is not None]
        if a.sample:
            random.shuffle(due)
        page = due[: max(1, min(limit, a.batch_max))]
        if a.source == "notes" and page:
            def fill(col: Collection) -> None:
                for item in page:
                    cards = col.find_cards(f"nid:{item['item_id']}")
                    item["deck"] = _deck_name(col, col.get_card(cards[0]).did) if cards else None
                    item["fields"] = {k: v for k, v in item["fields"].items() if v.strip()}
            await cm.read(fill)
        else:
            for item in page:
                item["content"] = await reader_content(client, a, item["item_id"])
        for item in page:
            item.pop("_order", None)
        return {
            "audit": a.id, "source": a.source, "about": a.about,
            "checks": [{"id": c.id, "ask": c.ask} for c in a.checks],
            "due": len(due), "items": page,
        }

    @server.tool(annotations=WRITE)
    async def record_audit(audit: str, checked: list[Checked], checked_by: str) -> dict[str, Any]:
        """Saves which items you checked for `audit`, from next_audit_batch: every item passed or
        not, with the findings on each. `checked_by` is who did the checking (your model's name, or
        "user" for one the user checked themselves). Call it right after checking a batch, before
        fixing anything: an item changed since next_audit_batch read it is refused, with the reason.
        Leave out a finding the user has already dismissed.

        A note with findings is flagged for an agent (the purple flag, and a flag:: reason tag unless
        it already has one), so the user sees it in Franki and flagged_cards lists it with its
        `audit_findings`. Fix those as any flag: show the change, update_notes once the user approves,
        then resolve_flag, which closes the findings and counts the fixed note as checked. A grammar
        page's or text's findings are listed by audit_findings, for the user to act on in Read & Listen
        (or in its code, for something every text gets wrong), and closed with close_audit_findings."""

        a = store.audit(audit)
        by = checked_by.strip()
        if not by:
            raise ToolError("Say who did the checking in checked_by: your model's name, or \"user\".")

        def refusal(c: Checked, current: dict[str, str]) -> str | None:
            if c.item_id not in current:
                return "There's no such item in the audit's scope any more."
            if current[c.item_id] != c.content_hash:
                return ("It changed since next_audit_batch read it (or the content_hash isn't the one it gave). "
                        "Nothing was recorded for it; it's still due, so the next batch has it as it is now.")
            unknown = [f.check for f in c.findings if a.check(f.check) is None]
            if unknown:
                return f"{a.id} has no check {', '.join(unknown)}. Its checks: {', '.join(x.id for x in a.checks)}. Nothing was recorded for it."
            return None

        if a.source == "notes":
            def run(col: Collection) -> list[dict[str, Any]]:
                ids = [int(c.item_id) for c in checked if c.item_id.isdigit()]
                fields = _note_fields(col, a, ids) if ids else {}
                current = {str(nid): a.content_hash(f) for nid, f in fields.items()}
                results = []
                for c in checked:
                    reason = refusal(c, current)
                    if reason:
                        results.append({"item_id": c.item_id, "recorded": False, "reason": reason})
                        continue
                    flagged = False
                    if c.findings:
                        note = col.get_note(int(c.item_id))
                        cards = sorted(note.cards(), key=lambda card: card.ord)
                        if not any(card.user_flag() == AGENT_FLAG for card in cards):
                            col.set_user_flag_for_cards(AGENT_FLAG, [cards[0].id])
                        if not any(t.lower().startswith(FLAG_TAG_PREFIX) for t in note.tags):
                            note.add_tag(FLAG_TAG_PREFIX + a.check(c.findings[0].check).flag_reason)
                            col.update_note(note)
                        flagged = True
                    results.append({"item_id": c.item_id, "recorded": True, "findings": len(c.findings), "flagged": flagged})
                return results

            results = await (cm.write(run) if any(c.findings for c in checked) else cm.read(run))
        else:
            current = {i["item_id"]: i["content_hash"] for i in await reader_items(client, a, None)}
            results = []
            for c in checked:
                reason = refusal(c, current)
                results.append({"item_id": c.item_id, "recorded": False, "reason": reason} if reason
                               else {"item_id": c.item_id, "recorded": True, "findings": len(c.findings)})

        at = _now()
        given = {c.item_id: c for c in checked}
        recorded = [r for r in results if r["recorded"]]
        for r in recorded:
            c = given[r["item_id"]]
            # An item checked again replaces what the last check found on it.
            store.close_findings(c.item_id, None, "checked again", a)
            store.record(a, c.item_id, c.content_hash, by, at)
            for f in c.findings:
                store.add_finding(a, c.item_id, f.check, f.problem.strip(), (f.suggestion or "").strip() or None, by, at)
        if recorded:
            store.add_run(a, by, len(recorded), sum(r["findings"] for r in recorded), at)
        return {"recorded": len(recorded), "results": results}

    @server.tool(annotations=READ)
    async def audit_findings(audit: str | None = None, limit: int = 50) -> dict[str, Any]:
        """What the audits found that nobody has acted on yet, oldest first (`audit` narrows it to
        one): each finding's id, audit, check, item, problem and suggested fix, when and by whom.
        A note's findings are also on its flagged card (flagged_cards) and close with resolve_flag;
        a grammar page's or text's close with close_audit_findings once the user has decided."""
        a = store.audit(audit) if audit else None
        await cm.read(store.close_unflagged)
        return {"findings": store.open_findings(audit=a, limit=max(1, min(limit, 200)))}

    @server.tool(annotations=WRITE)
    async def close_audit_findings(finding_ids: list[int], how: Literal["fixed", "dismissed"]) -> dict[str, Any]:
        """Closes findings on grammar pages or texts once the user has decided: "fixed" (the page was
        written again, or the cause fixed) or "dismissed" (not a problem after all). A note's finding
        closes with resolve_flag instead, which also takes its flag off."""
        known = store.finding_audits(finding_ids)
        missing = [i for i in finding_ids if i not in known]
        notes = [i for i, (a, _) in known.items() if a in store.audits and store.audits[a].source == "notes"]
        if missing or notes:
            problems = ([f"No finding {', '.join(map(str, missing))}; audit_findings lists the open ones."] if missing else []) + (
                [f"Finding {', '.join(map(str, notes))} is on a note: resolve_flag on its card closes it."] if notes else [])
            raise ToolError(" ".join(problems) + " Nothing was closed.")
        still_open = [i for i, (_, closed) in known.items() if closed is None]
        if still_open:
            store.close_finding_ids(still_open, how)
        return {"closed": len(still_open), "already_closed": [i for i in finding_ids if i not in still_open]}
