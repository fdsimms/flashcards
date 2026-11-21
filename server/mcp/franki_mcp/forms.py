"""
Filling the Omnilanguage note type's Forms field, which Franki's forms practice reads: a verb's
conjugations, and in a language with noun tables (`Language.noun_tables`) a noun's cases.

A word's forms come from UniMorph (unimorph.github.io): Wiktionary's inflection tables, one form
per line with its features (`esperar  esperé  V;IND;PST;PFV;1;SG`), under CC BY-SA 3.0. Each
language's file is downloaded once into the MCP's data folder and read from there.

What goes into the field is fixed per language (`TABLES`): which tenses, which persons, which
cases, and the label each line gets, so every note of a language is labeled the same way and Franki
can match a form across words (`present · yo: espero`, `accusative · singular: ptaka`, the format
`src/core/forms.ts` reads). A noun's group is its case, so practice can be narrowed to one case
across every noun. A field that already holds anything is never overwritten: a correction made in
Anki stays.

A verb is looked up as its Entry says it, without a trailing preposition or a bracketed note
("vengarse de", "internarse (en)"). A reflexive UniMorph lacks is built from its base verb with the
pronoun added (vengarse: me vengo, te vengas; bać się: boję się). A verb that still isn't found, or
whose table is less than half full, is reported as not found and left empty, for Claude to fill on
request (tagged `forms-unverified`) or the user in Anki.

Japanese verbs aren't in UniMorph's tables in a usable form: their lines are worked out by Read &
Listen's server (/api/conjugations, conjugation.py there), from the verb's conjugation type as
Sudachi gives it, each form with its reading in kana. Without Read & Listen they're left empty and
the result says why.

A noun is looked up without the demonstrative its Entry starts with ("ten ptak"). One whose Entry
names a plural ("te buty", "ci rodzice") gets only the plural lines, from the noun UniMorph lists
that plural under (but, rodzic), or from the word itself for a noun with no singular (spodnie).

UniMorph is an extract of Wiktionary made years ago, and misses pages Wiktionary has had since
(czas, koń, woda). A noun it lacks is looked up in kaikki.org's weekly extract of Wiktionary
(Wiktextract, also CC BY-SA), one page per word, kept for `KAIKKI_FRESH` so the daily fill doesn't
ask again each day. Only nouns: kaikki's Polish verb tables leave out the person (czekam and czekasz
are both "present, singular"), so a verb's table can't be read from them.
"""

from __future__ import annotations

import json
import logging
import re
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import anyio
from anki.collection import Collection  # first: the anki package's modules import each other
from anki.errors import NotFoundError
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from .collection import CollectionManager
from .reader import ReaderClient

log = logging.getLogger(__name__)

NOTE_TYPE = "Omnilanguage"
FIELD = "Forms"
# Collection config (synced with Anki) saying whether the daily fill runs.
AUTO_FILL_KEY = "frankiFormsAutoFill"
SOURCE_URL = "https://raw.githubusercontent.com/unimorph/{code}/master/{code}"
KAIKKI_URL = "https://kaikki.org/dictionary/{language}/meaning/{a}/{ab}/{word}.jsonl"
# How long a kaikki.org page (or its absence) is kept before it's asked for again.
KAIKKI_FRESH = 30 * 24 * 60 * 60
# Wiktextract's tags for a case and a number, as UniMorph's features (`Row`s are written in them).
KAIKKI_FEATURES = {"nominative": "NOM", "genitive": "GEN", "dative": "DAT", "accusative": "ACC", "instrumental": "INS",
                   "locative": "ESS", "vocative": "VOC", "singular": "SG", "plural": "PL"}
KAIKKI_CASES = frozenset({"NOM", "GEN", "DAT", "ACC", "INS", "ESS", "VOC"})
# Forms a table lists that aren't the word's own standard ones (a diminutive, a dialect's).
KAIKKI_SKIP = frozenset({"dialectal", "obsolete", "archaic", "rare", "diminutive", "augmentative", "alternative",
                         "adjective", "romanization", "table-tags", "inflection-template"})


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


def _cases(cases: list[tuple[str, str]]) -> tuple[Table, ...]:
    """One table per case, with its singular and plural."""
    return tuple(Table(case, (Row.of("singular", f"N;{tag};SG"), Row.of("plural", f"N;{tag};PL"))) for case, tag in cases)


PLURAL = "plural"
# UniMorph tags the locative ESS.
POLISH_CASES = [("nominative", "NOM"), ("genitive", "GEN"), ("dative", "DAT"), ("accusative", "ACC"),
                ("instrumental", "INS"), ("locative", "ESS"), ("vocative", "VOC")]
# Russian's prepositional is UniMorph's ESS too; its vocative isn't tabulated.
RUSSIAN_CASES = [("nominative", "NOM"), ("genitive", "GEN"), ("dative", "DAT"), ("accusative", "ACC"),
                 ("instrumental", "INS"), ("prepositional", "ESS")]
GERMAN_CASES = [("nominative", "NOM"), ("genitive", "GEN"), ("dative", "DAT"), ("accusative", "ACC")]
# Greek has no dative.
GREEK_CASES = [("nominative", "NOM"), ("genitive", "GEN"), ("accusative", "ACC"), ("vocative", "VOC")]


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
    # A noun's cases. A language without them has its nouns reported as unsupported.
    noun_tables: tuple[Table, ...] = ()
    # Words a noun's Entry may start with ("ten ptak"), dropped to look it up, and those of them
    # that say the Entry names a plural ("te buty").
    determiners: frozenset[str] = frozenset()
    plural_determiners: frozenset[str] = frozenset()
    # The language as kaikki.org names it, for nouns UniMorph lacks; none for no fallback.
    kaikki: str = ""

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
    ), noun_tables=_cases(POLISH_CASES),
        determiners=frozenset({"ten", "ta", "to", "te", "ci"}), plural_determiners=frozenset({"te", "ci"}), kaikki="Polish"),
    "russian": Language("rus", tables=(
        _persons("present", "PRS", SLAVIC_PERSONS_RU),
        Table("past", (
            Row.of("он", "V;PST;SG;MASC"), Row.of("она", "V;PST;SG;FEM"), Row.of("оно", "V;PST;SG;NEUT"), Row.of("они", "V;PST;PL"),
        )),
        _persons("future", "FUT", SLAVIC_PERSONS_RU),
    ), noun_tables=_cases(RUSSIAN_CASES)),
    # No verb tables yet: only nouns are filled, and German and Greek verbs are reported as unsupported.
    # "die" is left out of the plural determiners (it is also the feminine singular); a plural-only
    # noun ("die Eltern") still gets the plural lines it has.
    "german": Language("deu", tables=(), noun_tables=_cases(GERMAN_CASES), determiners=frozenset({"der", "die", "das"})),
    "greek": Language("ell", tables=(), noun_tables=_cases(GREEK_CASES), determiners=frozenset({"ο", "η", "το", "οι", "τα"}),
                      plural_determiners=frozenset({"οι", "τα"})),
}
# Japanese verbs are conjugated by Read & Listen's server, not read from UniMorph (`japanese_lines`).
JAPANESE = "japanese"
# The lines a Japanese verb gets (server/reader conjugation.ROWS), for writing a not_found one by hand.
JAPANESE_TABLE = ["polite · present", "polite · past", "polite · negative", "polite · past negative", "past · plain",
                  "negative · plain", "negative · plain past", "te-form · plain", "potential · plain", "passive · plain",
                  "causative · plain", "volitional · plain", "volitional · polite", "conditional · ば", "conditional · たら",
                  "imperative · plain", "desire · plain"]
# What the Language field may say for each (Omnilanguage's own names, as `speechLangFor` reads them).
LANGUAGE_NAMES = {"spanish": "spanish", "español": "spanish", "espanol": "spanish", "polish": "polish", "polski": "polish",
                  "russian": "russian", "русский": "russian", "german": "german", "deutsch": "german",
                  "greek": "greek", "ελληνικά": "greek", "japanese": JAPANESE, "日本語": JAPANESE}


def form_lines(language: Language, forms: list[tuple[str, frozenset[str]]], transform: Transform = _same,
               tables: tuple[Table, ...] | None = None) -> list[str]:
    """
    The Forms field's lines for one lemma, from its UniMorph forms in file order, by `tables` (the
    verb tables when none are given). A row takes the form with all of the row's features and the
    fewest others (the first, when several tie), so Polish's past "oni" (MASC;HUM) and "one"
    (neither) don't take each other's form.
    """
    lines = []
    for table in language.tables if tables is None else tables:
        for row in table.rows:
            matches = [(len(f - row.features), form) for form, f in forms if row.features <= f]
            if not matches:
                continue
            fewest = min(n for n, _ in matches)
            form = next(form for n, form in matches if n == fewest)
            lines.append(f"{table.group} · {row.label}: {transform(row.label, form)}")
    return lines


def rows_in(language: Language, tables: tuple[Table, ...] | None = None) -> int:
    return sum(len(t.rows) for t in (language.tables if tables is None else tables))


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


def noun_of(language: Language, entry: str) -> tuple[str, bool]:
    """The noun an Entry names, without a leading determiner or a bracketed note, and whether it names a plural."""
    word = re.sub(r"\s*\(.*?\)\s*$", "", entry).strip()
    first, _, rest = word.partition(" ")
    if rest and first.lower() in language.determiners:
        return rest.strip(), first.lower() in language.plural_determiners
    return word, False


def plural_tables(language: Language) -> tuple[Table, ...]:
    """The noun tables with only their plural rows, for a noun whose Entry names a plural."""
    return tuple(Table(t.group, tuple(r for r in t.rows if r.label == PLURAL)) for t in language.noun_tables)


def noun_lines_for(language: Language, entry: str, found: dict[str, list[tuple[str, frozenset[str]]]],
                   plurals: dict[str, str]) -> list[str]:
    """
    The Forms lines for a noun's Entry, or none when its table is less than half full (as for a
    verb). A plural Entry is looked up as the noun UniMorph lists it as the plural of (`plurals`,
    buty: but), else as itself, and takes only the plural rows.
    """
    word, plural = noun_of(language, entry)
    tables = plural_tables(language) if plural else language.noun_tables
    lemma = plurals.get(word, word) if plural else word
    lines = form_lines(language, found.get(lemma, []), tables=tables)
    return lines if lines and len(lines) * 2 >= rows_in(language, tables) else []


def _part(p: Path) -> Path:
    """Where a download into `p` is written before it's moved there: a name of its own, so the tool
    and the daily fill fetching the same file at once don't write into one file."""
    return p.with_name(f"{p.name}.{secrets.token_hex(4)}.part")


@dataclass
class UniMorph:
    """UniMorph's files, downloaded into `folder` on first use. `fetch` is replaceable for the tests."""

    folder: Path
    fetch: Callable[[str, Path], None] = field(default=lambda url, dest: _download(url, dest))

    def path(self, code: str) -> Path:
        p = self.folder / code
        if not p.exists():
            self.folder.mkdir(parents=True, exist_ok=True)
            tmp = _part(p)
            try:
                self.fetch(SOURCE_URL.format(code=code), tmp)
            except BaseException:
                tmp.unlink(missing_ok=True)
                raise
            tmp.replace(p)
        return p

    def forms_of(self, code: str, lemmas: Iterable[str], pos: str = "V") -> dict[str, list[tuple[str, frozenset[str]]]]:
        """Each lemma's forms as a `pos` ("V", "N"), in file order. Lemmas the file doesn't have are missing from the result."""
        wanted = set(lemmas)
        out: dict[str, list[tuple[str, frozenset[str]]]] = {}
        for lemma, form, features in self._lines(code):
            if lemma in wanted and pos in features:
                out.setdefault(lemma, []).append((form, features))
        return out

    def plurals_of(self, code: str, words: Iterable[str]) -> dict[str, str]:
        """The noun each word is the nominative plural of (buty: but), for the words the file has as one."""
        wanted = set(words)
        out: dict[str, str] = {}
        for lemma, form, features in self._lines(code):
            if form in wanted and form not in out and {"N", "NOM", "PL"} <= features:
                out[form] = lemma
        return out

    def kaikki_nouns(self, language: str, words: Iterable[str]) -> dict[str, list[tuple[str, frozenset[str]]]]:
        """Each word's noun forms from kaikki.org (`language` as it names it), for the words it has a table for."""
        out: dict[str, list[tuple[str, frozenset[str]]]] = {}
        for word in words:
            found = kaikki_noun_forms(self._kaikki_page(language, word))
            if found:
                out[word] = found
        return out

    def _kaikki_page(self, language: str, word: str) -> str:
        """A word's kaikki.org page, from the cache while it's fresh; empty when there's none, or it couldn't be fetched."""
        q = lambda part: urllib.parse.quote(part, safe="")  # noqa: E731
        p = self.folder / "kaikki" / q(language) / f"{q(word)}.jsonl"
        if p.exists() and time.time() - p.stat().st_mtime < KAIKKI_FRESH:
            return p.read_text(encoding="utf-8")
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = _part(p)
        try:
            self.fetch(KAIKKI_URL.format(language=q(language), a=q(word[:1]), ab=q(word[:2]), word=q(word)), tmp)
        except urllib.error.HTTPError as e:
            if e.code != 404:
                log.warning("kaikki.org answered %s for %s", e.code, word)
                tmp.unlink(missing_ok=True)
                return ""
            tmp.write_text("", encoding="utf-8")  # kept, so a word it doesn't have isn't asked for daily
        except OSError as e:
            log.warning("couldn't reach kaikki.org for %s: %s", word, e)
            tmp.unlink(missing_ok=True)
            return ""  # not kept: asked for again next time
        tmp.replace(p)
        return p.read_text(encoding="utf-8")

    def _lines(self, code: str) -> Iterable[tuple[str, str, frozenset[str]]]:
        with self.path(code).open(encoding="utf-8") as f:
            for line in f:
                parts = line.rstrip("\n").split("\t")
                if len(parts) >= 3:
                    yield parts[0], parts[1], frozenset(parts[2].split(";"))


def kaikki_noun_forms(page: str) -> list[tuple[str, frozenset[str]]]:
    """
    The noun on a kaikki.org page with the fullest declension table, as UniMorph-style forms
    (`czasu`, {N, GEN, SG}), in the table's order, so `form_lines` reads them as it reads UniMorph's.
    The fullest, as a page can hold several nouns spelled alike: para is "steam" (no plural) before
    "couple". A form with one case and one number is kept, unless it's tagged as something other
    than the word's standard form (`KAIKKI_SKIP`).
    """
    best: list[tuple[str, frozenset[str]]] = []
    for line in page.splitlines():
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if not isinstance(entry, dict) or entry.get("pos") != "noun":
            continue
        out = []
        for f in entry.get("forms", []):
            tags = set(f.get("tags") or [])
            form = str(f.get("form", "")).strip()
            if not form or tags & KAIKKI_SKIP:
                continue
            features = {KAIKKI_FEATURES[t] for t in tags if t in KAIKKI_FEATURES}
            if len(features & KAIKKI_CASES) == 1 and len(features - KAIKKI_CASES) == 1:
                out.append((form, frozenset({"N", *features})))
        if len({f for _, f in out}) > len({f for _, f in best}):
            best = out
    return best


def _download(url: str, dest: Path) -> None:
    log.info("downloading %s", url)
    with urllib.request.urlopen(url, timeout=120) as r, dest.open("wb") as f:  # noqa: S310 - a fixed https URL
        while chunk := r.read(1 << 20):
            f.write(chunk)


# ---- which notes ----

TAG = re.compile(r"<[^>]+>")


def _plain(html: str) -> str:
    return re.sub(r"\s+", " ", TAG.sub(" ", html.replace("&nbsp;", " "))).strip()


VERB = "verb"
NOUN = "noun"


@dataclass
class Candidate:
    note_id: int
    word: str
    language: str  # a TABLES key, or JAPANESE
    pos: str = VERB  # VERB or NOUN
    reading: str = ""  # a Japanese verb's KanaReading


@dataclass
class Survey:
    candidates: list[Candidate]
    # Verbs and nouns with an empty Forms field in a language there's no table for yet, by
    # language ("thai") for verbs and "<language> nouns" for nouns.
    unsupported: dict[str, int]


def _pos_of(note: Any) -> str:
    """VERB or NOUN, by the PartOfSpeech field first, then the tags."""
    said = _plain(note["PartOfSpeech"]).lower() if "PartOfSpeech" in note else ""
    if said in (VERB, NOUN):
        return said
    return VERB if note.has_tag(VERB) else NOUN


def survey(col: Collection, query: str = "") -> Survey:
    """Omnilanguage verbs and nouns with an empty Forms field, matching `query` (Anki's search syntax)."""
    nt = col.models.by_name(NOTE_TYPE)
    if nt is None or FIELD not in col.models.field_names(nt):
        raise MissingField()
    search = f'"note:{NOTE_TYPE}" "{FIELD}:" (PartOfSpeech:verb OR tag:verb OR PartOfSpeech:noun OR tag:noun)'
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
        pos = _pos_of(note)
        if lang == JAPANESE and pos == VERB:
            reading = _plain(note["KanaReading"]) if "KanaReading" in note else ""
            candidates.append(Candidate(nid, word, lang, pos, reading))
        elif lang in TABLES and (TABLES[lang].tables if pos == VERB else TABLES[lang].noun_tables):
            candidates.append(Candidate(nid, word, lang, pos))
        else:
            name = (_plain(note["Language"]).lower() if "Language" in note else "") or "(no language)"
            key = name if pos == VERB else f"{name} nouns"
            unsupported[key] = unsupported.get(key, 0) + 1
    return Survey(candidates, unsupported)


class MissingField(Exception):
    """The Omnilanguage note type has no Forms field yet."""

    MESSAGE = (
        "The Omnilanguage note type has no Forms field yet. Add it with add_field (note_type Omnilanguage, "
        "field Forms). That makes every device download the whole collection, so ask the user to sync "
        "Anki, AnkiMobile and Franki first."
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
    # Why the Japanese verbs among them weren't conjugated (Read & Listen out of reach), if they weren't.
    japanese_skipped: str = ""


def plan(survey_: Survey, unimorph: UniMorph, limit: int | None) -> FillPlan:
    """What filling would write: each candidate's lines, up to `limit` notes, reading only the files needed."""
    chosen = survey_.candidates if limit is None else survey_.candidates[:limit]
    by_lang: dict[str, list[Candidate]] = {}
    for c in chosen:
        by_lang.setdefault(c.language, []).append(c)
    filled: list[Planned] = []
    not_found: list[str] = []
    for lang, cs in by_lang.items():
        if lang == JAPANESE:
            continue  # conjugated by Read & Listen's server (`japanese_lines`)
        language = TABLES[lang]
        verbs = [c for c in cs if c.pos == VERB]
        nouns = [noun_of(language, c.word) for c in cs if c.pos == NOUN]
        found = unimorph.forms_of(language.code, (lemma for c in verbs for lemma in lemmas_for(language, c.word))) if verbs else {}
        plurals = unimorph.plurals_of(language.code, (w for w, plural in nouns if plural)) if any(p for _, p in nouns) else {}
        found_nouns = unimorph.forms_of(language.code, {w for w, _ in nouns} | set(plurals.values()), pos="N") if nouns else {}
        lines = {c.note_id: lines_for(language, c.word, found) if c.pos == VERB else noun_lines_for(language, c.word, found_nouns, plurals)
                 for c in cs}
        # Nouns UniMorph lacks, from kaikki.org: a plural Entry as the word itself (drzwi's page is its plural).
        missing = [c for c in cs if c.pos == NOUN and not lines[c.note_id]]
        if missing and language.kaikki:
            pages = unimorph.kaikki_nouns(language.kaikki, {noun_of(language, c.word)[0] for c in missing})
            for c in missing:
                lines[c.note_id] = noun_lines_for(language, c.word, pages, {})
        for c in cs:
            if lines[c.note_id]:
                filled.append(Planned(c.note_id, c.word, lines[c.note_id]))
            else:
                not_found.append(c.word)
    return FillPlan(filled, not_found, survey_.unsupported, len(survey_.candidates) - len(chosen))


def apply(col: Collection, fill: FillPlan) -> int:
    """Writes the planned lines, as Anki writes a field (lines joined by <br>), into fields still empty."""
    notes = []
    for p in fill.filled:
        try:
            note = col.get_note(p.note_id)
        except NotFoundError:
            continue  # deleted while its forms were looked up: the rest are still written
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


async def japanese_lines(reader: ReaderClient | None, verbs: list[Candidate], fill_: FillPlan) -> None:
    """Adds the Japanese verbs' lines to `fill_`, from Read & Listen's /api/conjugations, or says
    why it couldn't (`japanese_skipped`); a verb it can't conjugate is not found."""
    if not verbs:
        return
    try:
        if reader is None:
            raise ToolError("Read & Listen isn't connected to the MCP.")
        found: list[list[str] | None] = []
        for start in range(0, len(verbs), MAX_PER_CALL):
            batch = verbs[start : start + MAX_PER_CALL]
            body = {"verbs": [{"entry": c.word, "reading": c.reading} for c in batch]}
            found += (await reader.post("/api/conjugations", body))["forms"]
    except ToolError as e:
        fill_.japanese_skipped = f"{len(verbs)} Japanese verbs were left empty: their forms come from Read & Listen. {e}"
        return
    for c, lines in zip(verbs, found, strict=True):
        if lines:
            fill_.filled.append(Planned(c.note_id, c.word, lines))
        else:
            fill_.not_found.append(c.word)


async def fill(cm: CollectionManager, unimorph: UniMorph, query: str, limit: int | None, dry_run: bool,
               reader: ReaderClient | None = None) -> FillResult:
    """Finds the notes (a read), works out their lines from UniMorph outside the lock (a download the first time),
    and Japanese verbs' from Read & Listen, then writes them."""
    found = await cm.read(lambda col: survey(col, query))
    planned = await anyio.to_thread.run_sync(plan, found, unimorph, limit)
    chosen = found.candidates if limit is None else found.candidates[:limit]
    await japanese_lines(reader, [c for c in chosen if c.language == JAPANESE], planned)
    if dry_run or not planned.filled:
        return FillResult(planned, 0)
    return FillResult(planned, await cm.write(lambda col: apply(col, planned)))


async def auto_fill_loop(cm: CollectionManager, unimorph: UniMorph, first_delay: float = FIRST_RUN_DELAY, every: float = EVERY,
                         reader: ReaderClient | None = None) -> None:
    """Once a day, while it's turned on (`set_forms_auto_fill`), fills every Omnilanguage verb's and noun's empty Forms field."""
    await anyio.sleep(first_delay)
    while True:
        try:
            if await cm.read(lambda col: bool(col.get_config(AUTO_FILL_KEY, False))):
                result = await fill(cm, unimorph, "", None, dry_run=False, reader=reader)
                log.info("forms filled on %d notes; %d not found", result.written, len(result.plan.not_found))
                if result.plan.japanese_skipped:
                    log.info(result.plan.japanese_skipped)
        except MissingField:
            log.info("forms auto-fill is on, but the Omnilanguage note type has no Forms field yet")
        except Exception:  # noqa: BLE001 - a failed run waits for the next one
            log.exception("forms auto-fill failed")
        await anyio.sleep(every)


def register(server: MCPServer, cm: CollectionManager, unimorph: UniMorph, reader: ReaderClient | None = None) -> None:
    """The forms tools: fill_forms (a batch, previewed first) and set_forms_auto_fill."""

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=True))
    async def fill_forms(query: str = "", limit: int = 20, dry_run: bool = True) -> dict[str, Any]:
        """Fills the Forms field of Omnilanguage verbs and nouns that have it empty, from Wiktionary's
        inflection tables (UniMorph), for Franki's forms practice: one line per form, like
        "present · yo: espero" or "accusative · singular: ptaka". Verbs in Spanish, Polish and Russian
        so far, nouns in Polish, Russian, German and Greek (a plural Entry like "te buty" gets the plural lines only). Japanese
        verbs are conjugated by Read & Listen's server from their type as Sudachi gives it, each form
        with its reading ("past · plain: 帰った / かえった"); without Read & Listen they're left empty
        and japanese_skipped says so. `query` narrows the notes (Anki's search syntax, e.g.
        "deck:Español"); `limit` is how many notes, up to 100. With dry_run (the default) nothing is
        written: show the user the lines first. A field that has anything in it is never changed.
        Nouns UniMorph's older copy of Wiktionary lacks are looked up on kaikki.org. Words neither has come back in not_found and are left empty. Fill those only if
        the user asks: write the Forms field with update_notes in exactly the same lines (the same
        tenses and labels as the filled ones, `table` gives them), and add the tag forms-unverified."""
        if not 1 <= limit <= MAX_PER_CALL:
            raise ToolError(f"limit must be between 1 and {MAX_PER_CALL}.")
        try:
            result = await fill(cm, unimorph, query, limit, dry_run, reader)
        except MissingField as e:
            raise ToolError(MissingField.MESSAGE) from e
        except OSError as e:
            raise ToolError(f"Couldn't download Wiktionary's inflection tables (UniMorph): {e}. Try again later.") from e
        except ToolError:
            raise  # already says what to change (a sync problem, for one)
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
            **({"japanese_skipped": p.japanese_skipped} if p.japanese_skipped else {}),
            "auto_fill": auto,
            "source": "Wiktionary via UniMorph and kaikki.org, CC BY-SA; Japanese conjugated from Sudachi's verb types",
            # The lines a Forms field holds, per language: for writing a not_found word's by hand.
            "table": {
                **{lang: [f"{t.group} · {r.label}: <form>" for t in TABLES[lang].tables for r in t.rows]
                   for lang in sorted(TABLES) if TABLES[lang].tables},
                **{f"{lang} nouns": [f"{t.group} · {r.label}: <form>" for t in TABLES[lang].noun_tables for r in t.rows]
                   for lang in sorted(TABLES) if TABLES[lang].noun_tables},
                JAPANESE: [f"{row}: <form> / <reading>" for row in JAPANESE_TABLE],
            },
        }

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False))
    async def set_forms_auto_fill(on: bool) -> dict[str, Any]:
        """Turns the daily fill on or off: once a day, every Omnilanguage verb and noun with an empty Forms field
        is filled as fill_forms would. Turn it on only after the user has checked a batch."""
        await cm.write(lambda col: col.set_config(AUTO_FILL_KEY, on))
        return {"auto_fill": on}
