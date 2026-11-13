"""Grammar points for Japanese (grammar_japanese.py): each is found in a sentence that uses it, as
the words the reader shows, and left alone in look-alikes and in a plain present-tense text, since a
false find under "avoid" sends a good draft back."""

import pytest

from franki_reader.grammar import find_in_lines, points_for, words
from franki_reader.lexicon import lexicon_from

LEXICON = lexicon_from([], "ja")


def found(text: str) -> dict[str, list[str]]:
    ws = words(text, LEXICON)
    out = {}
    for p in points_for("ja"):
        if spans := p.find(ws):
            out[p.id] = ["".join(ws[a:b]) for a, b in spans]
    return out


CASES: list[tuple[str, str, list[str]]] = [
    ("毎日学校に行きます。", "ja.masu", ["行きます"]),
    ("昨日は行きませんでした。", "ja.masu", ["行きませんでした"]),
    ("昨日パンを食べた。", "ja.past", ["食べた"]),
    ("本を読んだ。", "ja.past", ["読んだ"]),
    ("とても静かだった。", "ja.past", ["静かだった"]),
    ("高かったね。", "ja.past", ["高かった"]),
    ("今ご飯を食べている。", "ja.te_iru", ["食べている"]),
    ("東京に住んでいます。", "ja.te_iru", ["住んでいます"]),
    ("何してるの？", "ja.te_iru", ["してる"]),
    ("日本に行きたい。", "ja.tai", ["行きたい"]),
    ("何も飲みたくない。", "ja.tai", ["飲みたくない"]),
    ("ちょっと待ってください。", "ja.te_kudasai", ["待ってください"]),
    ("一緒に行こう。", "ja.volitional", ["行こう"]),
    ("さあ、食べよう。", "ja.volitional", ["食べよう"]),
    ("駅で会いましょう。", "ja.volitional", ["会いましょう"]),
    ("雨が降ったら行かない。", "ja.conditional", ["降ったら"]),
    ("早く行けば間に合う。", "ja.conditional", ["行けば"]),
    ("子供に野菜を食べさせた。", "ja.causative", ["食べさせた"]),
    ("弟を行かせる。", "ja.causative", ["行かせる"]),
    ("財布を忘れてしまった。", "ja.te_shimau", ["忘れてしまった"]),
    ("全部食べちゃった。", "ja.te_shimau", ["食べちゃった"]),
    ("先生がいらっしゃいました。", "ja.keigo", ["いらっしゃいました"]),
    ("田中と申します。", "ja.keigo", ["申します"]),
]


@pytest.mark.parametrize(("text", "point", "matches"), CASES)
def test_a_point_is_found_where_it_is_used(text: str, point: str, matches: list[str]) -> None:
    assert found(text).get(point) == matches


def test_a_plain_present_tense_text_uses_no_point() -> None:
    assert found("私は毎日本を読む。猫が好きだ。駅は遠い。") == {}


def test_look_alikes_are_left_alone() -> None:
    # The past isn't the conditional, a request isn't ongoing, and ください alone isn't a request.
    assert "ja.past" not in found("雨が降ったら行かない。")
    assert "ja.te_iru" not in found("ちょっと待ってください。")
    assert "ja.te_kudasai" not in found("水をください。")
    # いる on its own is "to be", not ている.
    assert "ja.te_iru" not in found("猫がいる。")


def test_probably_is_not_lets() -> None:
    # でしょう and だろう have the volitional form too, but mean "probably".
    assert "ja.volitional" not in found("明日は雨でしょう。")
    assert "ja.volitional" not in found("彼は学生だろう。")
    assert found("一緒に行きましょう。")["ja.volitional"] == ["行きましょう"]


def test_matches_line_up_with_the_readers_words() -> None:
    assert words("ご飯を食べている。", LEXICON) == ["ご飯", "を", "食べて", "いる"]
    found_in = find_in_lines(["ご飯|を|食べて|いる。"], LEXICON, ("ja.te_iru",))
    assert found_in == {"ja.te_iru": ["食べている"]}


def test_masu_and_the_past_read_as_known_until_the_owner_chooses() -> None:
    from franki_reader import store
    from franki_reader.exposure import unset_points

    conn = store.connect(":memory:")
    choices = store.load_grammar(conn)
    assert choices["ja.masu"] == "normal" and choices["ja.past"] == "normal"
    assert "ja.masu" not in unset_points(choices, "ja")
    assert "ja.te_iru" in unset_points(choices, "ja")
    store.set_grammar(conn, "ja.past", "practice")
    assert store.load_grammar(conn)["ja.past"] == "practice"
