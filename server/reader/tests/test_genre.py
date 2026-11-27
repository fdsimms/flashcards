from franki_reader.generator import TextRequest, request_message
from franki_reader.genre import DEFAULT, GENRES, instruction


def test_every_genre_but_the_default_has_its_own_instruction() -> None:
    assert DEFAULT == "any" and instruction(DEFAULT) == ""
    asked = [instruction(g) for g in GENRES if g != DEFAULT]
    assert all(asked) and len(set(asked)) == len(asked)


def test_a_text_is_only_told_a_genre_that_isnt_the_default() -> None:
    assert "Genre:" not in request_message(TextRequest("food"))
    for genre in GENRES:
        if genre == DEFAULT:
            continue
        message = request_message(TextRequest("food", genre=genre))
        assert "Genre:" in message and instruction(genre) in message
