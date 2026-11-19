from typing import Any

from franki_reader import xray


def _chars(*items: tuple[str, str, int | None]) -> tuple[tuple[str, str, int | None], ...]:
    return xray.parse_characters(
        [{"name": n, "fact": f, **({"since": s} if s else {})} for n, f, s in items]
    )


def test_parse_drops_empty_and_repeated_names() -> None:
    got = xray.parse_characters(
        [
            {"name": "Hanna", "fact": "Mia's neighbor."},
            {"name": "hanna", "fact": "Second fact."},
            {"name": "", "fact": "Nobody."},
            {"name": "Mia", "fact": ""},
            "junk",
        ]
    )
    assert got == (("Hanna", "Mia's neighbor.", None),)
    assert xray.parse_characters(None) == ()


def test_merge_adds_facts_by_episode_and_skips_repeats() -> None:
    known = xray.merge([], _chars(("Hanna", "A neighbor.", None)), 1)
    known = xray.merge(
        known, _chars(("hanna", "Bakes cakes.", None), ("Mia", "New here.", None)), 2
    )
    known = xray.merge(known, _chars(("Hanna", "bakes cakes.", None)), 3)
    assert [c["name"] for c in known] == ["Hanna", "Mia"]
    assert known[0]["facts"] == [
        {"episode": 1, "text": "A neighbor."},
        {"episode": 2, "text": "Bakes cakes."},
    ]


def test_first_fill_takes_each_characters_own_first_episode() -> None:
    known = xray.merge([], _chars(("Mia", "Moved here.", 1), ("Hanna", "Baker.", 9)), 4)
    assert [f["episode"] for c in known for f in c["facts"]] == [1, 4]


def test_visible_hides_later_facts_and_characters() -> None:
    known = xray.merge([], _chars(("Hanna", "A neighbor.", None)), 1)
    known = xray.merge(
        known, _chars(("Hanna", "Bakes cakes.", None), ("Brandt", "The baker.", None)), 3
    )
    assert xray.visible(known, 2) == [
        {"name": "Hanna", "description": "A neighbor.", "first_episode": 1}
    ]
    shown = xray.visible(known, 3)
    assert [c["name"] for c in shown] == ["Hanna", "Brandt"]
    assert shown[0]["description"] == "A neighbor. Bakes cakes."
    assert xray.visible(known, 0) == []


def test_matches_handles_inflected_names() -> None:
    assert xray.matches("Hanna", "hanna")
    assert xray.matches("Аня", "Аня")
    assert xray.matches("Дмитрий", "Дмитрию")
    assert not xray.matches("Mia", "Miau")
    assert not xray.matches("Hanna", "Han")


def test_tag_names_tags_only_name_words() -> None:
    lines: list[dict[str, Any]] = [
        {"words": [{"text": "Hanna", "status": "name"}, {"text": "Hanna", "status": "known"}]},
        {"words": [{"text": "Mia", "status": "name"}, {"text": ".", "status": None}]},
    ]
    here = xray.tag_names(lines, [{"name": "Hanna"}, {"name": "Brandt"}])
    assert here == {"Hanna"}
    assert lines[0]["words"][0]["character"] == "Hanna"
    assert "character" not in lines[0]["words"][1]
    assert "character" not in lines[1]["words"][0]
