"""
Filling the Omnilanguage note type's Forms field, which Franki's forms practice reads.

A word's forms come from UniMorph (unimorph.github.io): Wiktionary's inflection tables, one form
per line with its features (`esperar  esperé  V;IND;PST;PFV;1;SG`), under CC BY-SA 3.0. Each
language's file is downloaded once into the MCP's data folder and read from there.

What goes into the field is fixed per language (`TABLES`): which tenses, which persons, and the
label each line gets, so every note of a language is labeled the same way and Franki can match a
form across words (`present · yo: espero`, the format `src/core/forms.ts` reads). A field that
already holds anything is never overwritten: a correction made in Anki stays.

A verb is looked up as its Entry says it, without a trailing preposition or a bracketed note
("vengarse de", "internarse (en)"). A reflexive UniMorph lacks is built from its base verb with the
pronoun added (vengarse: me vengo, te vengas; bać się: boję się). A verb that still isn't found, or
whose table is less than half full, is reported as not found and left empty, for Claude to fill on
request (tagged `forms-unverified`) or the user in Anki.
"""

from __future__ import annotations

import logging
import re
import urllib.request
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import anyio
from anki.collection import Collection  # first: the anki package's modules import each other
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from .collection import CollectionManager

log = logging.getLogger(__name__)

NOTE_TYPE = "Omnilanguage"
FIELD = "Forms"
# Collection config (synced with Anki) saying whether the daily fill runs.
AUTO_FILL_KEY = "frankiFormsAutoFill"
SOURCE_URL = "https://raw.githubusercontent.com/unimorph/{code}/master/{code}"


@dataclass(frozen=True)
class Row:
    """One line of a table: its label, and the UniMorph features a form needs to fill it."""

    label: str
    features: frozenset[str]

    @staticmethod
    def of(label: str, features: str) -> Row:
        return Row(label, frozenset(features.split(";")))


@dataclass(frozen=True)
class Table:
    group: str
    rows: tuple[Row, ...]


def _persons(group: str, base: str, labels: list[tuple[str, str]]) -> Table:
    return Table(group, tuple(Row.of(label, f"V;{base};{person}") for label, person in labels))


SPANISH_PERSONS = [("yo", "1;SG"), ("tú", "2;SG;INFM"), ("él", "3;SG"), ("nosotros", "1;PL"), ("vosotros", "2;PL"), ("ellos", "3;PL")]
SLAVIC_PERSONS_PL = [("ja", "1;SG"), ("ty", "2;SG"), ("on", "3;SG"), ("my", "1;PL"), ("wy", "2;PL"), ("oni", "3;PL")]
SLAVIC_PERSONS_RU = [("я", "1;SG"), ("ты", "2;SG"), ("он", "3;SG"), ("мы", "1;PL"), ("вы", "2;PL"), ("они", "3;PL")]


Transform = Callable[[str, str], str]  # (label, form) -> the form as the line shows it


def _same(_: str, form: str) -> str:
    return form


SPANISH_PRONOUNS = {"yo": "me", "tú": "te", "él": "se", "nosotros": "nos", "vosotros": "os", "ellos": "se"}


def _spanish_lookups(word: str) -> list[tuple[str, Transform]]:
    """esperar as it is; a reflexive (vengarse) also as its base verb, with the pronoun put back."""
    out: list[tuple[str, Transform]] = [(word, _same)]
    if word.endswith("se") and len(word) > 4:
        out.append((word[:-2], lambda label, form: f"{SPANISH_PRONOUNS[label]} {form}"))
    return out


def _polish_lookups(word: str) -> list[tuple[str, Transform]]:
    out: list[tuple[str, Transform]] = [(word, _same)]
    if word.endswith(" się"):
        out.append((word[: -len(" się")], lambda _label, form: f"{form} się"))
    return out


@dataclass(frozen=True)
class Language:
    code: str  # UniMorph's
    tables: tuple[Table, ...]
    # Words that may follow a verb in an Entry ("vengarse de"), dropped to look it up.
    prepositions: frozenset[str] = frozenset()
    lookups: Callable[[str], list[tuple[str, Transform]]] = lambda word: [(word, _same)]

    def lemma(self, entry: str) -> str:
        """The verb an Entry names: without a bracketed note or a trailing preposition."""
        word = re.sub(r"\s*\(.*?\)\s*$", "", entry).strip()
        parts = word.split(" ")
        if len(parts) > 1 and parts[-1] in self.prepositions:
            word = " ".join(parts[:-1])
        return word


TABLES: dict[str, Language] = {
    "spanish": Language("spa", prepositions=frozenset({"a", "de", "en", "con", "contra", "por", "para", "sobre"}), lookups=_spanish_lookups, tables=(
        _persons("present", "IND;PRS", SPANISH_PERSONS),
        _persons("preterite", "IND;PST;PFV", SPANISH_PERSONS),
        _persons("imperfect", "IND;PST;IPFV", SPANISH_PERSONS),
        _persons("future", "IND;FUT", SPANISH_PERSONS),
        _persons("conditional", "COND", SPANISH_PERSONS),
        _persons("present subjunctive", "SBJV;PRS", SPANISH_PERSONS),
    )),
    "polish": Language("pol", lookups=_polish_lookups, tables=(
        _persons("present", "PRS", SLAVIC_PERSONS_PL),
        Table("past", (
            Row.of("ja (m)", "V;PST;1;SG;MASC"), Row.of("ja (f)", "V;PST;1;SG;FEM"),
            Row.of("on", "V;PST;3;SG;MASC"), Row.of("ona", "V;PST;3;SG;FEM"),
            Row.of("oni", "V;PST;3;PL;MASC;HUM"), Row.of("one", "V;PST;3;PL"),
        )),
    )),
    "russian": Language("rus", tables=(
        _persons("present", "PRS", SLAVIC_PERSONS_RU),
        Table("past", (
            Row.of("он", "V;PST;SG;MASC"), Row.of("она", "V;PST;SG;FEM"), Row.of("оно", "V;PST;SG;NEUT"), Row.of("они", "V;PST;PL"),
        )),
        _persons("future", "FUT", SLAVIC_PERSONS_RU),
    )),
}
# What the Language field may say for each (Omnilanguage's own names, as `speechLangFor` reads them).
LANGUAGE_NAMES = {"spanish": "spanish", "español": "spanish", "espanol": "spanish", "polish": "polish", "polski": "polish",
                  "russian": "russian", "русский": "russian"}


def form_lines(language: Language, forms: list[tuple[str, frozenset[str]]], transform: Transform = _same) -> list[str]:
    """
    The Forms field's lines for one lemma, from its UniMorph forms in file order. A row takes the
    form with all of the row's features and the fewest others (the first, when several tie), so
    Polish's past "oni" (MASC;HUM) and "one" (neither) don't take each other's form.
    """
    lines = []
    for table in language.tables:
        for row in table.rows:
            matches = [(len(f - row.features), form) for form, f in forms if row.features <= f]
            if not matches:
                continue
            fewest = min(n for n, _ in matches)
            form = next(form for n, form in matches if n == fewest)
            lines.append(f"{table.group} · {row.label}: {transform(row.label, form)}")
    return lines


def rows_in(language: Language) -> int:
    return sum(len(t.rows) for t in language.tables)


def lines_for(language: Language, entry: str, found: dict[str, list[tuple[str, frozenset[str]]]]) -> list[str]:
    """
    The Forms lines for an Entry, from the first lookup UniMorph has (`Language.lookups`), or none
    when that table is less than half full: a partial fill would stop a full one later, since a
    field with anything in it is never overwritten.
    """
    for lemma, transform in language.lookups(language.lemma(entry)):
        lines = form_lines(language, found.get(lemma, []), transform)
        if lines:
            return lines if len(lines) * 2 >= rows_in(language) else []
    return []


def lemmas_for(language: Language, entry: str) -> list[str]:
    """Every lemma `lines_for` may look up for an Entry, to read from UniMorph's file."""
    return [lemma for lemma, _ in language.lookups(language.lemma(entry))]


@dataclass
class UniMorph:
    """UniMorph's files, downloaded into `folder` on first use. `fetch` is replaceable for the tests."""

    folder: Path
    fetch: Callable[[str, Path], None] = field(default=lambda url, dest: _download(url, dest))

    def path(self, code: str) -> Path:
        p = self.folder / code
        if not p.exists():
            self.folder.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(".part")
            self.fetch(SOURCE_URL.format(code=code), tmp)
            tmp.replace(p)
        return p

    def forms_of(self, code: str, lemmas: Iterable[str]) -> dict[str, list[tuple[str, frozenset[str]]]]:
        """Each lemma's verb forms, in file order. Lemmas the file doesn't have are missing from the result."""
        wanted = set(lemmas)
        out: dict[str, list[tuple[str, frozenset[str]]]] = {}
        with self.path(code).open(encoding="utf-8") as f:
            for line in f:
                parts = line.rstrip("\n").split("\t")
                if len(parts) < 3 or parts[0] not in wanted:
                    continue
                features = frozenset(parts[2].split(";"))
                if "V" in features:
                    out.setdefault(parts[0], []).append((parts[1], features))
        return out


def _download(url: str, dest: Path) -> None:
    log.info("downloading %s", url)
    with urllib.request.urlopen(url, timeout=120) as r, dest.open("wb") as f:  # noqa: S310 - a fixed https URL
        while chunk := r.read(1 << 20):
            f.write(chunk)


# ---- which notes ----

TAG = re.compile(r"<[^>]+>")


def _plain(html: str) -> str:
    return re.sub(r"\s+", " ", TAG.sub(" ", html.replace("&nbsp;", " "))).strip()


@dataclass
class Candidate:
    note_id: int
    word: str
    language: str  # a TABLES key


@dataclass
class Survey:
    candidates: list[Candidate]
    # Verbs with an empty Forms field in a language there's no table for yet.
    unsupported: dict[str, int]


def survey(col: Collection, query: str = "") -> Survey:
    """Omnilanguage verbs with an empty Forms field, matching `query` (Anki's search syntax)."""
    nt = col.models.by_name(NOTE_TYPE)
    if nt is None or FIELD not in col.models.field_names(nt):
        raise MissingField()
    search = f'"note:{NOTE_TYPE}" "{FIELD}:" (PartOfSpeech:verb OR tag:verb)'
    if query.strip():
        search += f" ({query})"
    candidates: list[Candidate] = []
    unsupported: dict[str, int] = {}
    for nid in col.find_notes(search):
        note = col.get_note(nid)
        lang = LANGUAGE_NAMES.get(_plain(note["Language"]).lower(), "") if "Language" in note else ""
        word = _plain(note["Entry"]) if "Entry" in note else ""
        if not word:
            continue
        if lang in TABLES:
            candidates.append(Candidate(nid, word, lang))
        else:
            name = _plain(note["Language"]).lower() if "Language" in note else ""
            unsupported[name or "(no language)"] = unsupported.get(name or "(no language)", 0) + 1
    return Survey(candidates, unsupported)


class MissingField(Exception):
    """The Omnilanguage note type has no Forms field yet."""

    MESSAGE = (
        "The Omnilanguage note type has no Forms field yet. Adding a field changes the note type, which makes "
        "every device do a full sync, so it's done in Anki on a computer: first sync every device (Franki, "
        "AnkiMobile, Anki), then in Anki choose Tools, Manage Note Types, Omnilanguage, Fields, Add, name it "
        "Forms, and sync, choosing Upload. Then sync the other devices, choosing Download."
    )


@dataclass
class Planned:
    note_id: int
    word: str
    lines: list[str]


@dataclass
class FillPlan:
    filled: list[Planned]
    not_found: list[str]
    unsupported: dict[str, int]
    # Candidates beyond the limit, for the next call.
    remaining: int


def plan(survey_: Survey, unimorph: UniMorph, limit: int | None) -> FillPlan:
    """What filling would write: each candidate's lines, up to `limit` notes, reading only the files needed."""
    chosen = survey_.candidates if limit is None else survey_.candidates[:limit]
    by_lang: dict[str, list[Candidate]] = {}
    for c in chosen:
        by_lang.setdefault(c.language, []).append(c)
    filled: list[Planned] = []
    not_found: list[str] = []
    for lang, cs in by_lang.items():
        language = TABLES[lang]
        found = unimorph.forms_of(language.code, (lemma for c in cs for lemma in lemmas_for(language, c.word)))
        for c in cs:
            lines = lines_for(language, c.word, found)
            if lines:
                filled.append(Planned(c.note_id, c.word, lines))
            else:
                not_found.append(c.word)
    return FillPlan(filled, not_found, survey_.unsupported, len(survey_.candidates) - len(chosen))


def apply(col: Collection, fill: FillPlan) -> int:
    """Writes the planned lines, as Anki writes a field (lines joined by <br>), into fields still empty."""
    notes = []
    for p in fill.filled:
        note = col.get_note(p.note_id)
        if FIELD not in note or _plain(note[FIELD]):
            continue  # filled meanwhile, here or on another device
        note[FIELD] = "<br>".join(p.lines)
        notes.append(note)
    if notes:
        col.update_notes(notes)
    return len(notes)


# ---- running it: the tools, and the daily fill ----

MAX_PER_CALL = 100
FIRST_RUN_DELAY = 10 * 60
EVERY = 24 * 60 * 60


@dataclass
class FillResult:
    plan: FillPlan
    written: int


async def fill(cm: CollectionManager, unimorph: UniMorph, query: str, limit: int | None, dry_run: bool) -> FillResult:
    """Finds the notes (a read), works out their lines from UniMorph outside the lock (a download the first time), then writes them."""
    found = await cm.read(lambda col: survey(col, query))
    planned = await anyio.to_thread.run_sync(plan, found, unimorph, limit)
    if dry_run or not planned.filled:
        return FillResult(planned, 0)
    return FillResult(planned, await cm.write(lambda col: apply(col, planned)))


async def auto_fill_loop(cm: CollectionManager, unimorph: UniMorph, first_delay: float = FIRST_RUN_DELAY, every: float = EVERY) -> None:
    """Once a day, while it's turned on (`set_forms_auto_fill`), fills every Omnilanguage verb's empty Forms field."""
    await anyio.sleep(first_delay)
    while True:
        try:
            if await cm.read(lambda col: bool(col.get_config(AUTO_FILL_KEY, False))):
                result = await fill(cm, unimorph, "", None, dry_run=False)
                log.info("forms filled on %d notes; %d not found", result.written, len(result.plan.not_found))
        except MissingField:
            log.info("forms auto-fill is on, but the Omnilanguage note type has no Forms field yet")
        except Exception:  # noqa: BLE001 - a failed run waits for the next one
            log.exception("forms auto-fill failed")
        await anyio.sleep(every)


def register(server: MCPServer, cm: CollectionManager, unimorph: UniMorph) -> None:
    """The forms tools: fill_forms (a batch, previewed first) and set_forms_auto_fill."""

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=True))
    async def fill_forms(query: str = "", limit: int = 20, dry_run: bool = True) -> dict[str, Any]:
        """Fills the Forms field of Omnilanguage verbs that have it empty, from Wiktionary's inflection
        tables (UniMorph), for Franki's forms practice: one line per form, like "present · yo: espero".
        Spanish, Polish and Russian so far. `query` narrows the notes (Anki's search syntax, e.g.
        "deck:Español"); `limit` is how many notes, up to 100. With dry_run (the default) nothing is
        written: show the user the lines first. A field that has anything in it is never changed.
        Words Wiktionary doesn't have come back in not_found and are left empty. Fill those only if
        the user asks: write the Forms field with update_notes in exactly the same lines (the same
        tenses and labels as the filled ones, `table` gives them), and add the tag forms-unverified."""
        if not 1 <= limit <= MAX_PER_CALL:
            raise ToolError(f"limit must be between 1 and {MAX_PER_CALL}.")
        try:
            result = await fill(cm, unimorph, query, limit, dry_run)
        except MissingField as e:
            raise ToolError(MissingField.MESSAGE) from e
        except OSError as e:
            raise ToolError(f"Couldn't download Wiktionary's inflection tables (UniMorph): {e}. Try again later.") from e
        except Exception as e:  # noqa: BLE001 - Anki's search errors
            raise ToolError(f"Anki couldn't read the search: {e}") from e
        p = result.plan
        auto = await cm.read(lambda col: bool(col.get_config(AUTO_FILL_KEY, False)))
        return {
            "would_fill" if dry_run else "filled": [{"note_id": x.note_id, "word": x.word, "lines": x.lines} for x in p.filled],
            "written": result.written,
            "not_found": p.not_found,
            "other_languages": p.unsupported,
            "remaining": p.remaining,
            "auto_fill": auto,
            "source": "Wiktionary via UniMorph, CC BY-SA 3.0",
            # The lines a Forms field holds, per language: for writing a not_found word's by hand.
            "table": {lang: [f"{t.group} · {r.label}: <form>" for t in TABLES[lang].tables for r in t.rows] for lang in sorted({x for x in TABLES})},
        }

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False))
    async def set_forms_auto_fill(on: bool) -> dict[str, Any]:
        """Turns the daily fill on or off: once a day, every Omnilanguage verb with an empty Forms field
        is filled as fill_forms would. Turn it on only after the user has checked a batch."""
        await cm.write(lambda col: col.set_config(AUTO_FILL_KEY, on))
        return {"auto_fill": on}
