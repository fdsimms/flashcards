"""Filling Omnilanguage's Forms field from UniMorph: the lines it writes, and that they reach Anki on another device."""

from __future__ import annotations

import io
import json
import urllib.error
import urllib.parse
from pathlib import Path

import anyio
import httpx
import pytest

from anki.collection import Collection  # noqa: F401 - first, for the anki package's imports
from conftest import call, call_error
from franki_mcp import forms
from franki_mcp.reader import ReaderClient, ReaderSettings
from franki_mcp.server import build_server
from mcp import Client

pytestmark = pytest.mark.anyio

# Real excerpts of UniMorph's files (tests/unimorph; Russian, German and Greek nouns too): esperar, vengar and querer (only the noun,
# in UniMorph) in Spanish; czekać and uczyć, and the nouns ptak, stół, but and rodzic, in Polish.
EXCERPTS = Path(__file__).parent / "unimorph"
# kaikki.org's pages for czas (which UniMorph lacks) and para, cut down (tests/kaikki).
KAIKKI = Path(__file__).parent / "kaikki"


def rows(code: str, lemma: str) -> list[tuple[str, frozenset[str]]]:
    lines = (line.split("\t") for line in (EXCERPTS / code).read_text(encoding="utf-8").splitlines())
    return [(form, frozenset(tags.split(";"))) for lem, form, tags in lines if lem == lemma]


class Files:
    """UniMorph's files and kaikki.org's pages as the tests have them, counting downloads."""

    def __init__(self):
        self.fetched: list[str] = []

    def __call__(self, url: str, dest: Path) -> None:
        self.fetched.append(url)
        if "kaikki.org" in url:
            page = KAIKKI / urllib.parse.unquote(url.rsplit("/", 1)[1])
            if not page.exists():
                raise urllib.error.HTTPError(url, 404, "Not Found", {}, io.BytesIO())  # type: ignore[arg-type]
            dest.write_text(page.read_text(encoding="utf-8"), encoding="utf-8")
            return
        code = url.rsplit("/", 1)[1]
        source = EXCERPTS / code
        dest.write_text(source.read_text(encoding="utf-8") if source.exists() else "", encoding="utf-8")


def spanish() -> forms.Language:
    return forms.TABLES["spanish"]


def test_lines_follow_the_table_and_take_the_first_form_for_each_person():
    lines = forms.form_lines(spanish(), rows("spa", "esperar"))
    assert len(lines) == forms.rows_in(spanish()) == 36
    # tú is esperas, not the voseo esperás that UniMorph lists with the same features after it.
    assert lines[:3] == ["present · yo: espero", "present · tú: esperas", "present · él: espera"]
    assert "preterite · yo: esperé" in lines and "present subjunctive · ellos: esperen" in lines


def test_a_row_takes_the_form_with_the_fewest_other_features():
    lines = forms.form_lines(forms.TABLES["polish"], rows("pol", "czekać"))
    assert "past · oni: czekali" in lines and "past · one: czekały" in lines


def test_reflexives_and_prepositions_are_looked_up_as_their_verb():
    found = {"vengar": rows("spa", "vengar"), "uczyć": rows("pol", "uczyć")}
    assert spanish().lemma("vengarse de") == "vengarse" and spanish().lemma("internarse (en)") == "internarse"
    lines = forms.lines_for(spanish(), "vengarse de", found)
    assert lines[:2] == ["present · yo: me vengo", "present · tú: te vengas"]
    assert "preterite · nosotros: nos vengamos" in lines
    assert forms.lines_for(forms.TABLES["polish"], "uczyć się", found)[0] == "present · ja: uczę się"


def test_a_table_less_than_half_full_counts_as_not_found():
    present_only = [r for r in rows("spa", "esperar") if {"IND", "PRS"} <= r[1]]
    assert len(forms.form_lines(spanish(), present_only)) == 6
    assert forms.lines_for(spanish(), "esperar", {"esperar": present_only}) == []
    # UniMorph's only "querer" is the noun (el querer), so the verb isn't found at all.
    assert forms.lines_for(spanish(), "querer", {"querer": rows("spa", "querer")}) == []


def polish() -> forms.Language:
    return forms.TABLES["polish"]


def test_a_noun_gets_each_case_singular_and_plural():
    found = {"ptak": rows("pol", "ptak")}
    lines = forms.noun_lines_for(polish(), "ten ptak", found, {})
    assert len(lines) == forms.rows_in(polish(), polish().noun_tables) == 14
    assert lines[:2] == ["nominative · singular: ptak", "nominative · plural: ptaki"]
    # Animate: the accusative is the genitive. UniMorph's ESS is the locative.
    assert "accusative · singular: ptaka" in lines and "locative · singular: ptaku" in lines
    assert "accusative · singular: stół" in forms.noun_lines_for(polish(), "ten stół", {"stół": rows("pol", "stół")}, {})


def test_a_plural_entry_gets_the_plural_lines_of_the_noun_it_is_the_plural_of():
    assert forms.noun_of(polish(), "ci rodzice") == ("rodzice", True)
    assert forms.noun_of(polish(), "ten ptak (bird)") == ("ptak", False)
    found = {"rodzic": rows("pol", "rodzic")}
    lines = forms.noun_lines_for(polish(), "ci rodzice", found, {"rodzice": "rodzic"})
    assert len(lines) == 7 and all("· plural:" in line for line in lines)
    assert "accusative · plural: rodziców" in lines
    # A plural UniMorph doesn't list (spodnie has no entry) isn't found, rather than guessed.
    assert forms.noun_lines_for(polish(), "te spodnie", found, {"rodzice": "rodzic"}) == []


def test_russian_nouns_have_six_cases_with_the_prepositional_for_ESS():
    ru = forms.TABLES["russian"]
    lines = forms.noun_lines_for(ru, "собака", {"собака": rows("rus", "собака")}, {})
    # UniMorph has no accusative plural for собака: the row is left out, not guessed.
    assert len(lines) == forms.rows_in(ru, ru.noun_tables) - 1 == 11
    assert lines[:2] == ["nominative · singular: собака", "nominative · plural: собаки"]
    assert "prepositional · singular: собаке" in lines and "accusative · singular: собаку" in lines
    assert not any("accusative · plural" in line for line in lines)
    # No determiners: a first word is part of the Entry.
    assert forms.noun_of(ru, "мальчик") == ("мальчик", False)
    # UniMorph's Russian forms carry no stress marks, so what is written is what checkAnswer compares.
    assert not any("\u0301" in form for form, _ in rows("rus", "мальчик") + rows("rus", "собака"))


def test_german_nouns_take_the_first_form_of_a_case_and_drop_the_article():
    de = forms.TABLES["german"]
    assert forms.noun_of(de, "der Hund") == ("Hund", False)
    lines = forms.noun_lines_for(de, "der Hund", {"Hund": rows("deu", "Hund")}, {})
    assert len(lines) == forms.rows_in(de, de.noun_tables) == 8
    assert "genitive · singular: Hundes" in lines and "dative · plural: Hunden" in lines
    assert not any(line.startswith("vocative") for line in lines)
    # "die" is also the plural article, so a feminine Entry is read as singular.
    assert forms.noun_of(de, "die Frau") == ("Frau", False)
    assert "nominative · plural: Frauen" in forms.noun_lines_for(de, "die Frau", {"Frau": rows("deu", "Frau")}, {})
    # A noun with no singular gets the plural lines it has.
    assert forms.noun_lines_for(de, "die Eltern", {"Eltern": rows("deu", "Eltern")}, {}) == [
        "nominative · plural: Eltern", "genitive · plural: Eltern", "dative · plural: Eltern", "accusative · plural: Eltern"]


def test_greek_nouns_have_no_dative_and_plural_articles_mark_a_plural():
    el = forms.TABLES["greek"]
    assert [t.group for t in el.noun_tables] == ["nominative", "genitive", "accusative", "vocative"]
    assert forms.noun_of(el, "η γυναίκα") == ("γυναίκα", False)
    assert forms.noun_of(el, "τα βιβλία") == ("βιβλία", True)
    lines = forms.noun_lines_for(el, "η γυναίκα", {"γυναίκα": rows("ell", "γυναίκα")}, {})
    assert len(lines) == 8 and "genitive · plural: γυναικών" in lines
    lines = forms.noun_lines_for(el, "τα βιβλία", {"βιβλίο": rows("ell", "βιβλίο")}, {"βιβλία": "βιβλίο"})
    assert len(lines) == 4 and all("· plural:" in line for line in lines)


def test_german_and_greek_verbs_are_still_reported_as_other_languages():
    assert forms.TABLES["german"].tables == () and forms.TABLES["greek"].tables == ()
    assert forms.LANGUAGE_NAMES["deutsch"] == "german" and forms.LANGUAGE_NAMES["ελληνικά"] == "greek"


def test_plurals_and_nouns_are_read_from_the_file(tmp_path):
    u = forms.UniMorph(tmp_path, fetch=Files())
    assert u.plurals_of("pol", ["buty", "rodzice", "spodnie"]) == {"buty": "but", "rodzice": "rodzic"}
    assert set(u.forms_of("pol", ["ptak", "czekać"], pos="N")) == {"ptak"}
    assert set(u.forms_of("pol", ["ptak", "czekać"])) == {"czekać"}


def test_a_noun_unimorph_lacks_is_read_from_kaikki():
    page = (KAIKKI / "czas.jsonl").read_text(encoding="utf-8")
    lines = forms.noun_lines_for(polish(), "ten czas", {"czas": forms.kaikki_noun_forms(page)}, {})
    assert len(lines) == 14
    assert "genitive · singular: czasu" in lines and "locative · singular: czasie" in lines
    # The table lists the obsolete instrumental czasy after czasami; the first is the one taken.
    assert "instrumental · plural: czasami" in lines
    # The diminutive and the dialect's forms aren't the word's own.
    assert not any("czasik" in line for line in lines)


def test_kaikki_takes_the_noun_with_the_fullest_table():
    # para's first noun is "steam", with no plural; the deck's "couple" has one.
    lines = forms.noun_lines_for(polish(), "ta para", {"para": forms.kaikki_noun_forms((KAIKKI / "para.jsonl").read_text(encoding="utf-8"))}, {})
    assert "genitive · plural: par" in lines and len(lines) == 14


def kaikki_lines(language: str, entry: str, word: str, unstress: bool = False) -> list[str]:
    page = (KAIKKI / f"{word}.jsonl").read_text(encoding="utf-8")
    return forms.noun_lines_for(forms.TABLES[language], entry, {word: forms.kaikki_noun_forms(page, unstress)}, {})


def test_russian_nouns_from_kaikki_have_no_stress_marks_and_keep_the_accusative_plural():
    # воздух's page has a romanized twin of each form (marked with a diamond), the dated spellings, and a partitive.
    lines = kaikki_lines("russian", "воздух", "воздух", unstress=True)
    assert len(lines) == 12
    assert lines[:2] == ["nominative · singular: воздух", "nominative · plural: воздухи"]
    assert "prepositional · plural: воздухах" in lines and "accusative · plural: воздухи" in lines
    assert not any("\u0301" in line or "⟐" in line or "ъ" in line for line in lines)
    # Without unstress the marks are kept, which is what Polish and Greek get (their accents are letters).
    assert "nominative · singular: во\u0301здух" in kaikki_lines("russian", "воздух", "воздух")
    # ё is a letter: it stays. And the page's dated block (тьма́мъ, тьмѣ́) is not the word's own.
    assert forms.kaikki_noun_forms('{"pos": "noun", "forms": [{"form": "ёлка\u0301", "tags": ["nominative", "singular"]}]}', True) == [
        ("ёлка", frozenset({"N", "NOM", "SG"}))]
    lines = kaikki_lines("russian", "тьма", "тьма", unstress=True)
    assert "prepositional · singular: тьме" in lines and "dative · plural: тьмам" in lines and "genitive · plural: тем" in lines
    assert not any("ѣ" in line or "мъ" in line for line in lines)


def test_german_nouns_from_kaikki_take_the_first_form_of_a_case():
    lines = kaikki_lines("german", "das Haus", "Haus")
    assert len(lines) == 8 and "dative · singular: Haus" in lines and "nominative · plural: Häuser" in lines
    assert "dative · plural: Häusern" in lines
    assert not any("Häuschen" in line or "Hauß" in line for line in lines)


def test_greek_nouns_from_kaikki_have_a_vocative_and_keep_their_accents():
    lines = kaikki_lines("greek", "η χώρα", "χώρα")
    assert len(lines) == 8 and "genitive · plural: χωρών" in lines and "vocative · singular: χώρα" in lines
    assert "genitive · singular: παιδιού" in kaikki_lines("greek", "το παιδί", "παιδί")
    assert "accusative · plural: δρόμους" in kaikki_lines("greek", "ο δρόμος", "δρόμος")


def test_a_table_unimorph_filled_is_not_completed_from_kaikki(tmp_path):
    files = Files()
    survey = forms.Survey([forms.Candidate(1, "собака", "russian", forms.NOUN), forms.Candidate(2, "воздух", "russian", forms.NOUN)], {})
    result = forms.plan(survey, forms.UniMorph(tmp_path, fetch=files), None)
    by_word = {p.word: p.lines for p in result.filled}
    # UniMorph's 11 of 12 lines are kept as they are; the missing accusative plural isn't filled in.
    assert len(by_word["собака"]) == 11 and not any("accusative · plural" in line for line in by_word["собака"])
    # воздух isn't in UniMorph's file: kaikki's table is used, unstressed.
    assert len(by_word["воздух"]) == 12 and "genitive · singular: воздуха" in by_word["воздух"]
    assert [u for u in files.fetched if "kaikki.org" in u] == ["https://kaikki.org/dictionary/Russian/meaning/%D0%B2/%D0%B2%D0%BE/%D0%B2%D0%BE%D0%B7%D0%B4%D1%83%D1%85.jsonl"]


def test_kaikki_pages_are_kept_and_a_missing_one_is_asked_for_once(tmp_path):
    files = Files()
    u = forms.UniMorph(tmp_path, fetch=files)
    assert set(u.kaikki_nouns("Polish", ["czas", "żaba"])) == {"czas"}
    assert files.fetched[-1] == "https://kaikki.org/dictionary/Polish/meaning/%C5%BC/%C5%BCa/%C5%BCaba.jsonl"
    u.kaikki_nouns("Polish", ["czas", "żaba"])
    assert len(files.fetched) == 2


def test_kaikki_unreachable_is_not_kept(tmp_path):
    calls = []

    def down(url: str, dest: Path) -> None:
        calls.append(url)
        raise urllib.error.URLError("no network")

    u = forms.UniMorph(tmp_path, fetch=down)
    assert u.kaikki_nouns("Polish", ["czas"]) == {}
    assert u.kaikki_nouns("Polish", ["czas"]) == {}
    assert len(calls) == 2
    assert not list(tmp_path.rglob("*.part"))  # nothing half-written left behind


def test_a_note_deleted_while_its_forms_are_looked_up_is_passed_over(tmp_path):
    col = Collection(str(tmp_path / "c.anki2"))
    try:
        basic = col.models.by_name("Basic")
        col.models.add_field(basic, col.models.new_field(forms.FIELD))
        col.models.update_dict(basic)
        note = col.new_note(basic)
        note["Front"] = "esperar"
        col.add_note(note, col.decks.id("D"))
        plan = forms.FillPlan([forms.Planned(1, "gone", ["x"]), forms.Planned(note.id, "esperar", ["present · yo: espero"])], [], [], 0)
        assert forms.apply(col, plan) == 1
        assert col.get_note(note.id)[forms.FIELD] == "present · yo: espero"
    finally:
        col.close()


def test_every_group_a_grammar_point_links_to_is_one_the_fill_writes():
    # The app finds a form's grammar point by its group's name (src/core/grammar.ts), so a group
    # renamed here would quietly unlink it. Languages the fill doesn't cover are written by hand.
    catalog = Path(__file__).resolve().parents[2] / "reader" / "src" / "franki_reader" / "grammar_points.json"
    tables = {"es": forms.TABLES["spanish"], "pl": forms.TABLES["polish"], "ru": forms.TABLES["russian"]}
    linked = [(p["language"], g) for p in json.loads(catalog.read_text(encoding="utf-8"))["points"] for g in p.get("forms", [])]
    assert linked
    for language, group in linked:
        if language in tables:
            assert group in {t.group for t in tables[language].tables}, (language, group)


def test_downloads_each_file_once(tmp_path):
    files = Files()
    u = forms.UniMorph(tmp_path, fetch=files)
    assert set(u.forms_of("spa", ["esperar", "nada"])) == {"esperar"}
    u.forms_of("spa", ["esperar"])
    assert files.fetched == ["https://raw.githubusercontent.com/unimorph/spa/master/spa"]


OMNI_FIELDS = "Entry,Meaning,Language,PartOfSpeech,Forms"


def omni(desktop, fields: str = OMNI_FIELDS) -> list[int]:
    """Puts an Omnilanguage note type with some verbs on the server, from the user's computer."""
    note = lambda **f: json.dumps(f)  # noqa: E731
    out = desktop.run(
        "add-notetype", "Omnilanguage", fields,
        "+", "add-fields-note", "Omnilanguage", "Español", note(Entry="esperar", Meaning="to wait", Language="spanish", PartOfSpeech="verb"),
        "+", "add-fields-note", "Omnilanguage", "Español", note(Entry="inventadear", Meaning="made up", Language="spanish"), "verb",
        "+", "add-fields-note", "Omnilanguage", "Español", note(Entry="la casa", Meaning="house", Language="spanish", PartOfSpeech="noun"),
        "+", "add-fields-note", "Omnilanguage", "Polski", note(Entry="czekać", Meaning="to wait", Language="polish", PartOfSpeech="verb"),
        "+", "add-fields-note", "Omnilanguage", "Polski", note(Entry="te buty", Meaning="shoes", Language="polish", PartOfSpeech="noun"),
        "+", "add-fields-note", "Omnilanguage", "Polski", note(Entry="ten czas", Meaning="time", Language="polish", PartOfSpeech="noun"),
        "+", "add-fields-note", "Omnilanguage", "Thai", note(Entry="รอ", Meaning="to wait", Language="thai", PartOfSpeech="verb"),
        "+", "sync",
    )
    return out["notes"]


@pytest.fixture
async def forms_client(cm, tmp_path):
    files = Files()
    async with Client(build_server(cm, unimorph=forms.UniMorph(tmp_path / "unimorph", fetch=files))) as c:
        c.files = files
        yield c


async def test_previews_then_fills_and_the_lines_reach_another_device(forms_client, desktop):
    esperar, _, casa, czekac, buty, _, _ = omni(desktop)
    preview = await call(forms_client, "fill_forms")
    # ten czas from kaikki.org, as UniMorph's file doesn't have it.
    assert [w["word"] for w in preview["would_fill"]] == ["esperar", "czekać", "te buty", "ten czas"]
    assert preview["would_fill"][2]["lines"][0] == "nominative · plural: buty"
    assert preview["written"] == 0 and preview["not_found"] == ["inventadear"]
    # Spanish has verb tables but no noun tables, so la casa is reported, not skipped silently.
    assert preview["other_languages"] == {"spanish nouns": 1, "thai": 1}
    assert "accusative · singular: <form>" in preview["table"]["polish nouns"]
    assert preview["auto_fill"] is False

    # Nothing was written by the preview.
    assert desktop.run("sync", "+", "fields", f"nid:{esperar}")["fields"][str(esperar)]["Forms"] == ""

    done = await call(forms_client, "fill_forms", dry_run=False, query="deck:Español")
    assert done["written"] == 1 and [w["word"] for w in done["filled"]] == ["esperar"]
    fields = desktop.run("sync", "+", "fields", f"nid:{esperar} OR nid:{casa} OR nid:{czekac} OR nid:{buty}")["fields"]
    assert fields[str(esperar)]["Forms"].split("<br>")[:2] == ["present · yo: espero", "present · tú: esperas"]
    assert fields[str(casa)]["Forms"] == "" and fields[str(czekac)]["Forms"] == "" and fields[str(buty)]["Forms"] == ""

    done = await call(forms_client, "fill_forms", dry_run=False, query="deck:Polski")
    assert done["written"] == 3
    fields = desktop.run("sync", "+", "fields", f"nid:{buty}")["fields"]
    assert "genitive · plural: butów" in fields[str(buty)]["Forms"].split("<br>")


async def test_never_overwrites_a_field_with_something_in_it(forms_client, desktop):
    esperar = omni(desktop)[0]
    desktop.run("sync")
    # The user's own correction, made in Anki.
    col = Collection(str(desktop.path))
    try:
        n = col.get_note(esperar)
        n["Forms"] = "present · yo: espero (mine)"
        col.update_note(n)
    finally:
        col.close()
    desktop.run("sync")
    out = await call(forms_client, "fill_forms", dry_run=False)
    assert "esperar" not in [w["word"] for w in out["filled"]]
    assert desktop.run("sync", "+", "fields", f"nid:{esperar}")["fields"][str(esperar)]["Forms"] == "present · yo: espero (mine)"


async def test_says_how_to_add_the_field_when_the_note_type_has_none(forms_client, desktop):
    omni(desktop, "Entry,Meaning,Language,PartOfSpeech")
    message = await call_error(forms_client, "fill_forms")
    assert "no Forms field yet" in message and "add_field" in message


async def test_the_daily_fill_runs_only_once_turned_on(cm, desktop, tmp_path):
    esperar = omni(desktop)[0]
    unimorph = forms.UniMorph(tmp_path / "unimorph", fetch=Files())
    async with Client(build_server(cm, unimorph=unimorph)) as c:
        async with anyio.create_task_group() as tg:
            tg.start_soon(forms.auto_fill_loop, cm, unimorph, 0, 0.2)
            await anyio.sleep(1)
            assert desktop.run("sync", "+", "fields", f"nid:{esperar}")["fields"][str(esperar)]["Forms"] == ""
            assert (await call(c, "set_forms_auto_fill", on=True))["auto_fill"] is True
            await anyio.sleep(1.5)
            tg.cancel_scope.cancel()
    assert desktop.run("sync", "+", "fields", f"nid:{esperar}")["fields"][str(esperar)]["Forms"].startswith("present · yo: espero")


def japanese_verbs(desktop) -> list[int]:
    """Two Japanese verbs and a noun on the server."""
    note = lambda **f: json.dumps(f)  # noqa: E731
    return desktop.run(
        "add-notetype", "Omnilanguage", OMNI_FIELDS + ",KanaReading",
        "+", "add-fields-note", "Omnilanguage", "日本語", note(Entry="帰る", Meaning="to go home", Language="japanese", PartOfSpeech="verb", KanaReading="かえる"),
        "+", "add-fields-note", "Omnilanguage", "日本語", note(Entry="食べた", Meaning="ate", Language="japanese", PartOfSpeech="verb"),
        "+", "add-fields-note", "Omnilanguage", "日本語", note(Entry="劇団", Meaning="theater company", Language="japanese", PartOfSpeech="noun"),
        "+", "sync",
    )["notes"]


def reader_answering(answer):
    """Read & Listen's /api/conjugations, answering `answer` (None: out of reach), and what it was asked."""
    asked: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(json.loads(request.content))
        return httpx.Response(200, json={"forms": answer}) if answer is not None else httpx.Response(502)

    return ReaderClient(ReaderSettings("http://reader", "pw"), httpx.AsyncClient(transport=httpx.MockTransport(handler))), asked


async def test_japanese_verbs_are_conjugated_by_read_and_listen(cm, desktop, tmp_path):
    kaeru, tabeta, _ = japanese_verbs(desktop)
    reader, asked = reader_answering([["past · plain: 帰った / かえった"], None])
    unimorph = forms.UniMorph(tmp_path / "unimorph", fetch=Files())
    async with Client(build_server(cm, unimorph=unimorph, reader=reader)) as c:
        done = await call(c, "fill_forms", dry_run=False)
    assert asked == [{"verbs": [{"entry": "帰る", "reading": "かえる"}, {"entry": "食べた", "reading": ""}]}]
    assert done["filled"] == [{"note_id": kaeru, "word": "帰る", "lines": ["past · plain: 帰った / かえった"]}]
    assert done["not_found"] == ["食べた"] and done["other_languages"] == {"japanese nouns": 1}
    assert "past · plain: <form> / <reading>" in done["table"]["japanese"]
    fields = desktop.run("sync", "+", "fields", f"nid:{kaeru} OR nid:{tabeta}")["fields"]
    assert fields[str(kaeru)]["Forms"] == "past · plain: 帰った / かえった" and fields[str(tabeta)]["Forms"] == ""


async def test_without_read_and_listen_japanese_verbs_are_left_empty_and_it_says_why(cm, desktop, tmp_path):
    japanese_verbs(desktop)
    reader, _ = reader_answering(None)
    async with Client(build_server(cm, unimorph=forms.UniMorph(tmp_path / "unimorph", fetch=Files()), reader=reader)) as c:
        preview = await call(c, "fill_forms")
    assert preview["would_fill"] == [] and preview["not_found"] == []
    assert preview["japanese_skipped"].startswith("2 Japanese verbs were left empty")


def test_a_limit_counts_only_notes_with_lines_so_unfillable_ones_never_use_up_a_batch():
    found = [forms.Planned(i, f"w{i}", ["line"]) for i in range(5)]
    planned = forms.FillPlan(found, ["nowhere"] * 30, {}, 0)
    cut = forms.cut(planned, 2)
    assert [p.note_id for p in cut.filled] == [0, 1] and cut.remaining == 3 and len(cut.not_found) == 30
    assert forms.cut(planned, None) is planned and forms.cut(planned, 9) is planned
