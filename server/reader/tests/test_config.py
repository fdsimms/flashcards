from pathlib import Path

from franki_reader.config import MIN_PASSPHRASE, SECRET_NAMES, load


def test_defaults_without_environment() -> None:
    settings = load({})
    assert settings.db_path == Path("reader.db")
    assert settings.missing() == list(SECRET_NAMES)


def test_reads_paths_and_secrets() -> None:
    settings = load(
        {"READER_DB_PATH": "/data/reader.db", "ANTHROPIC_API_KEY": "k", "ANKI_SYNC_ENDPOINT": ""}
    )
    assert settings.db_path == Path("/data/reader.db")
    assert settings.secrets == {"ANTHROPIC_API_KEY": "k"}
    assert "ANKI_SYNC_ENDPOINT" in settings.missing()


def test_a_short_passphrase_is_flagged_but_still_works() -> None:
    assert load({"APP_PASSPHRASE": "short"}).short_passphrase()
    assert load({"APP_PASSPHRASE": "short"}).secrets["APP_PASSPHRASE"] == "short"
    assert not load({"APP_PASSPHRASE": "x" * MIN_PASSPHRASE}).short_passphrase()
    # Unset is reported as missing, not as short.
    assert not load({}).short_passphrase()
