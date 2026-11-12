"""Filling Omnilanguage's Forms field from UniMorph: the lines it writes, and that they reach Anki on another device."""

from __future__ import annotations

import json
from pathlib import Path

import anyio
import pytest

from anki.collection import Collection  # noqa: F401 - first, for the anki package's imports
from conftest import call, call_error
from franki_mcp import forms
from franki_mcp.server import build_server
from mcp import Client

pytestmark = pytest.mark.anyio

# Real excerpts of UniMorph's files (tests/unimorph): esperar, vengar and querer (only the noun,
# in UniMorph) in Spanish; czekać and uczyć in Polish.
EXCERPTS = Path(__file__).parent / "unimorph"


def rows(code: str, lemma: str) -> list[tuple[str, frozenset[str]]]:
    lines = (line.split("\t") for line in (EXCERPTS / code).read_text(encoding="utf-8").splitlines())
    return [(form, frozenset(tags.split(";"))) for lem, form, tags in lines if lem == lemma]


class Files:
    """UniMorph's files as the tests have them, counting downloads."""

    def __init__(self):
        self.fetched: list[str] = []

    def __call__(self, url: str, dest: Path) -> None:
        self.fetched.append(url)
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
    esperar, _, casa, czekac, _ = omni(desktop)
    preview = await call(forms_client, "fill_forms")
    assert [w["word"] for w in preview["would_fill"]] == ["esperar", "czekać"]
    assert preview["written"] == 0 and preview["not_found"] == ["inventadear"]
    assert preview["other_languages"] == {"thai": 1}
    assert preview["auto_fill"] is False

    # Nothing was written by the preview.
    assert desktop.run("sync", "+", "fields", f"nid:{esperar}")["fields"][str(esperar)]["Forms"] == ""

    done = await call(forms_client, "fill_forms", dry_run=False, query="deck:Español")
    assert done["written"] == 1 and [w["word"] for w in done["filled"]] == ["esperar"]
    fields = desktop.run("sync", "+", "fields", f"nid:{esperar} OR nid:{casa} OR nid:{czekac}")["fields"]
    assert fields[str(esperar)]["Forms"].split("<br>")[:2] == ["present · yo: espero", "present · tú: esperas"]
    assert fields[str(casa)]["Forms"] == "" and fields[str(czekac)]["Forms"] == ""


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
