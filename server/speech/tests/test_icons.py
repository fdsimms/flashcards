from franki_speech.icons import icon_drawing, normalize_name, similar_names, tabler_name_of


def test_an_icon_is_looked_up_by_its_name() -> None:
    drawing = icon_drawing("umbrella")
    assert drawing and drawing.startswith("M")
    assert tabler_name_of(drawing) == "umbrella"


def test_the_name_is_read_as_the_set_spells_it() -> None:
    assert normalize_name("  Tabler:Building Monument ") == "building-monument"
    assert icon_drawing("tabler:Building_Monument") == icon_drawing("building-monument")


def test_an_unknown_name_is_no_icon() -> None:
    assert icon_drawing("running-track-for-thai-people") is None
    assert icon_drawing("") is None


def test_only_the_sets_own_path_data_is_one_of_its_drawings() -> None:
    assert tabler_name_of("M3 12a9 9 0 0 1 18 0z|M12 12v7a2 2 0 0 1-4 0") is None


def test_crossed_out_variants_are_not_in_the_set() -> None:
    assert icon_drawing("umbrella-off") is None


def test_similar_names_point_at_what_to_try() -> None:
    names = similar_names("building")
    assert names and all("building" in n for n in names)
    assert similar_names("") == []
