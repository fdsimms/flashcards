"""A Japanese verb's forms, from Sudachi's conjugation type (conjugation.py)."""

import json
import re
from pathlib import Path

import franki_reader
from franki_reader.conjugation import ROWS, form_lines, verb_of


def forms(entry: str, reading: str = "") -> dict[str, str]:
    lines = form_lines(entry, reading)
    assert lines is not None, entry
    return dict(line.split(": ", 1) for line in lines)


def test_an_ichidan_verb_and_its_reading() -> None:
    f = forms("食べる", "たべる")
    assert f["polite · present"] == "食べます / たべます"
    assert f["negative · plain"] == "食べない / たべない"
    assert f["potential · plain"] == "食べられる / たべられる"
    assert f["imperative · plain"] == "食べろ / たべろ"
    assert len(f) == len(ROWS)


def test_a_godan_ru_verb_is_never_taken_for_ichidan() -> None:
    # 帰る ends like 食べる but is godan: Sudachi's type says so.
    f = forms("帰る")
    assert f["past · plain"] == "帰った / かえった"
    assert f["negative · plain"] == "帰らない / かえらない"
    assert f["potential · plain"] == "帰れる / かえれる"


def test_the_te_form_by_each_godan_ending_and_iku() -> None:
    te = {
        verb: forms(verb)["te-form · plain"].split(" / ")[0]
        for verb in ["買う", "待つ", "読む", "遊ぶ", "死ぬ", "書く", "泳ぐ", "話す", "行く"]
    }
    assert te == {"買う": "買って", "待つ": "待って", "読む": "読んで", "遊ぶ": "遊んで", "死ぬ": "死んで",
                  "書く": "書いて", "泳ぐ": "泳いで", "話す": "話して", "行く": "行って"}  # fmt: skip
    assert forms("泳ぐ")["past · plain"] == "泳いだ / およいだ"
    assert forms("買う")["negative · plain"] == "買わない / かわない"


def test_suru_and_kuru() -> None:
    assert forms("勉強する")["potential · plain"] == "勉強できる / べんきょうできる"
    assert forms("する")["volitional · plain"] == "しよう"
    kuru = forms("来る", "くる")
    assert kuru["negative · plain"] == "来ない / こない"
    assert kuru["conditional · ば"] == "来れば / くれば"
    assert forms("くる")["polite · present"] == "きます"


def test_a_phrase_conjugates_its_last_verb() -> None:
    assert (
        forms("約束を破る", "やくそくをやぶる")["past · plain"]
        == "約束を破った / やくそくをやぶった"
    )


def test_honorific_verbs_and_aru() -> None:
    assert forms("くださる")["polite · present"] == "くださいます"
    assert forms("くださる")["imperative · plain"] == "ください"
    aru = forms("ある")
    assert aru["negative · plain"] == "ない" and aru["negative · plain past"] == "なかった"
    assert "potential · plain" not in aru


def test_the_notes_reading_is_conjugated_and_sudachis_stands_in_for_one_that_doesnt_fit() -> None:
    assert forms("入る", "いる")["past · plain"] == "入った / いった"  # the deck's reading, kept
    assert forms("食べる", "x")["past · plain"] == "食べた / たべた"
    assert forms("食べる", "たべる、くう")["past · plain"] == "食べた / たべた"


def test_not_a_verb_in_its_dictionary_form() -> None:
    assert form_lines("劇団") is None
    assert form_lines("食べた") is None
    assert verb_of("静かな") is None


def test_each_japanese_grammar_points_forms_group_is_one_the_lines_have() -> None:
    # The app finds a form's grammar point by its group's name (src/core/grammar.ts).
    catalog = json.loads(
        (Path(franki_reader.__file__).parent / "grammar_points.json").read_text(encoding="utf-8")
    )
    linked = [g for p in catalog["points"] if p["language"] == "ja" for g in p.get("forms", [])]
    assert linked and set(linked) <= {group for group, _, _ in ROWS}


def test_the_mcps_list_of_japanese_lines_is_this_ones() -> None:
    # fill_forms names these lines for writing a verb by hand; the MCP can't import this package.
    forms_py = Path(__file__).resolve().parents[2] / "mcp" / "franki_mcp" / "forms.py"
    listed = re.search(
        r"JAPANESE_TABLE = \[(.*?)\]", forms_py.read_text(encoding="utf-8"), re.DOTALL
    )
    assert listed is not None
    assert re.findall(r'"([^"]+)"', listed.group(1)) == [
        f"{group} · {label}" for group, label, _ in ROWS
    ]
