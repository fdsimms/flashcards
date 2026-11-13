"""SQLite storage: the lexicon snapshot, topics, generated texts, the reading log, the difficulty
setting and the owner's settings. Only the latest lexicon snapshot is kept (docs/read-and-listen/architecture.md, Lexicon)."""

import json
import logging
import sqlite3
import statistics
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta, tzinfo
from pathlib import Path
from typing import Any, Literal

from franki_reader import grammar
from franki_reader.comprehension import Question, from_json
from franki_reader.difficulty import Difficulty
from franki_reader.gateway import AnkiUnavailable
from franki_reader.generator import MODEL, Choice, Form, Generated, Line
from franki_reader.languages import HIDDEN_LANGUAGES, LANGUAGES, VOICE_SLOTS, Code, with_deck
from franki_reader.lexicon import Entry, ReadDeck
from franki_reader.study_day import DEFAULT_ROLLOVER, study_day
from franki_reader.wanikani import ReadWaniKani, WaniKaniUnavailable, WaniKaniWord

SNAPSHOT_MAX_AGE = timedelta(hours=24)
# How the reading log names each language (it said "thai" before there was a second one).
LOG_LANGUAGE: dict[Code, str] = {
    "th": "thai",
    "es": "spanish",
    "de": "german",
    "fr": "french",
    "ru": "russian",
    "el": "greek",
    "pl": "polish",
    "nb": "norwegian",
    "ja": "japanese",
}
MODE = "read_listen"

log = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS lexicon (
    note_id INTEGER PRIMARY KEY,
    entry TEXT NOT NULL,
    meaning TEXT NOT NULL,
    tier TEXT NOT NULL,
    due INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wanikani (
    subject_id INTEGER PRIMARY KEY,
    characters TEXT NOT NULL,
    meaning TEXT NOT NULL,
    reading TEXT NOT NULL,
    srs_stage INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS topics (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    favorite INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS texts (
    id INTEGER PRIMARY KEY,
    topic_id INTEGER NOT NULL REFERENCES topics(id),
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ready',
    title TEXT NOT NULL,
    lines TEXT NOT NULL,
    glosses TEXT NOT NULL,
    stretch TEXT NOT NULL,
    coverage REAL NOT NULL,
    token_count INTEGER NOT NULL,
    floor REAL NOT NULL,
    attempts INTEGER NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cache_read_tokens INTEGER NOT NULL,
    cache_write_tokens INTEGER NOT NULL,
    cost_usd REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY,
    text_id INTEGER NOT NULL REFERENCES texts(id),
    logged_at TEXT NOT NULL,
    language TEXT NOT NULL,
    mode TEXT NOT NULL,
    rating TEXT,
    finished INTEGER NOT NULL,
    words_glossed TEXT NOT NULL,
    words_flagged TEXT NOT NULL,
    audio_speed REAL,
    listen_only INTEGER NOT NULL,
    seconds INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cleared_words (
    word TEXT PRIMARY KEY,
    cleared_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS explanations (
    text_id INTEGER NOT NULL REFERENCES texts(id),
    line INTEGER NOT NULL,
    simple INTEGER NOT NULL,
    points TEXT NOT NULL,
    created_at TEXT NOT NULL,
    cost_usd REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (text_id, line, simple)
);
-- Claude's answer to "Does this sound natural?" on a line, asked once per line on the owner's tap.
CREATE TABLE IF NOT EXISTS naturalness (
    text_id INTEGER NOT NULL REFERENCES texts(id),
    line INTEGER NOT NULL,
    answer TEXT NOT NULL,
    created_at TEXT NOT NULL,
    cost_usd REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (text_id, line)
);
CREATE TABLE IF NOT EXISTS phrase_explanations (
    text_id INTEGER NOT NULL REFERENCES texts(id),
    line INTEGER NOT NULL,
    phrase TEXT NOT NULL,
    simple INTEGER NOT NULL,
    answer TEXT NOT NULL,
    created_at TEXT NOT NULL,
    cost_usd REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (text_id, line, phrase, simple)
);
-- Grammar drills' fill-the-gap questions (drills.py): each batch Claude wrote, for its cost, and
-- the questions from it that passed the checks, served oldest-served first. A call that failed after
-- Claude answered is a batch with nothing asked or kept, for its cost (and the day's call count).
CREATE TABLE IF NOT EXISTS drill_batches (
    id INTEGER PRIMARY KEY,
    point_id TEXT NOT NULL,
    language TEXT NOT NULL,
    asked INTEGER NOT NULL,
    kept INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    cost_usd REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS drill_questions (
    id INTEGER PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES drill_batches(id),
    point_id TEXT NOT NULL,
    before TEXT NOT NULL,
    answer TEXT NOT NULL,
    after TEXT NOT NULL,
    english TEXT NOT NULL,
    wrong TEXT NOT NULL,
    hint TEXT NOT NULL,
    served_at TEXT
);
CREATE INDEX IF NOT EXISTS drill_questions_point ON drill_questions(point_id);
-- The vocabulary check's questions (vocab_check.py): each batch Claude glossed for a language, for its
-- cost, and the words from it that passed the checks. A word is written once and kept. A call that
-- failed after Claude answered is a batch with nothing asked or kept, for its cost.
CREATE TABLE IF NOT EXISTS vocab_batches (
    id INTEGER PRIMARY KEY,
    language TEXT NOT NULL,
    asked INTEGER NOT NULL,
    kept INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    cost_usd REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS vocab_items (
    language TEXT NOT NULL,
    lemma TEXT NOT NULL,
    rank INTEGER NOT NULL,
    meaning TEXT NOT NULL,
    wrong TEXT NOT NULL,
    batch_id INTEGER NOT NULL REFERENCES vocab_batches(id),
    PRIMARY KEY (language, lemma)
);
-- The note queue (note_queue.py): words the owner typed in the app, for Claude to fill in the other
-- fields of in the background. `fields` is what passed the checks (Anki field name -> value), and a
-- row is deleted once the owner saves the note, or removes it, in the app. Nothing here is an Anki note.
CREATE TABLE IF NOT EXISTS note_queue (
    id INTEGER PRIMARY KEY,
    language TEXT NOT NULL,
    deck TEXT NOT NULL,
    entry TEXT NOT NULL,
    meaning TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'waiting',
    fields TEXT NOT NULL DEFAULT '{}',
    error TEXT NOT NULL DEFAULT '',
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    tried_at TEXT,
    cost_usd REAL NOT NULL DEFAULT 0
);
-- English meanings for words in texts that have no gloss from the deck or the text (meanings.py):
-- common words are known without being in the deck, so the model isn't asked to gloss them. A word is
-- asked about once and kept, as written in lower case; an empty meaning is a word Claude gave none for.
-- A call that failed after Claude answered is a batch with nothing asked or kept, for its cost, and
-- its words are asked again.
CREATE TABLE IF NOT EXISTS meaning_batches (
    id INTEGER PRIMARY KEY,
    language TEXT NOT NULL,
    asked INTEGER NOT NULL,
    kept INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    cost_usd REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS word_meanings (
    language TEXT NOT NULL,
    word TEXT NOT NULL,
    meaning TEXT NOT NULL,
    batch_id INTEGER NOT NULL REFERENCES meaning_batches(id),
    PRIMARY KEY (language, word)
);
CREATE TABLE IF NOT EXISTS stories (
    id INTEGER PRIMARY KEY,
    language TEXT NOT NULL,
    topic_id INTEGER NOT NULL REFERENCES topics(id),
    about TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    cast_ TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
);
-- What a call cost when nothing else keeps it: an explanation, a phrase's or a naturalness check
-- that failed after Claude answered (their caches hold answers only, so the line can be asked
-- again), memory hints (mnemonics.py; the app keeps the hints, in the note), questions for the check
-- after reading (comprehension.py; every call, as the questions are kept on the text), and a card recorded by
-- an Azure voice (POST /api/speech), as the characters Azure billed. A recording's language is
-- left empty: recordings are counted all together, and an older app doesn't say it.
CREATE TABLE IF NOT EXISTS call_costs (
    id INTEGER PRIMARY KEY,
    feature TEXT NOT NULL,
    language TEXT NOT NULL,
    created_at TEXT NOT NULL,
    cost_usd REAL NOT NULL DEFAULT 0,
    audio_chars INTEGER NOT NULL DEFAULT 0
);
"""


@dataclass(frozen=True)
class Topic:
    id: int
    name: str
    favorite: bool
    ready: int  # texts waiting to be read


# Why a text is on the shelf (docs/read-and-listen/architecture.md, Shelf): "liked", a theme the
# owner likes; "due", written around words due today; "new", an idea not tried before; "asked",
# a topic typed in; "story", an episode of the ongoing story. "" for texts from before the shelf.
Reason = Literal["liked", "due", "new", "asked", "story", ""]


@dataclass(frozen=True)
class StoredText:
    id: int
    topic_id: int
    title: str
    lines: tuple[Line, ...]
    glosses: dict[str, str]
    stretch: tuple[str, ...]
    coverage: float
    roles: dict[str, str] = field(default_factory=dict)
    # speaker -> "male" or "female" for a dialogue; empty for a story and for a text written
    # before genders were recorded, which is read with A as a man and B as a woman (gender.py).
    genders: dict[str, str] = field(default_factory=dict)
    # speaker -> a characters.CHARACTERS key for a dialogue; empty before characters, which show A and B
    characters: dict[str, str] = field(default_factory=dict)
    form: Form = "dialogue"
    language: Code = "th"
    # {"practice": [point ids], "avoid": [point ids], "review": [point ids]}, as asked for when it
    # was written ("review" since 12 November 2026: known points worked in, exposure.py)
    grammar: dict[str, list[str]] = field(default_factory=dict)
    # Transliterations the model wrote for the words it glossed, by word (the deck's own are
    # read from the lexicon at render time).
    translits: dict[str, str] = field(default_factory=dict)
    reason: Reason = ""
    story_id: int | None = None
    episode: int = 0
    recap: str = ""  # a story episode's one sentence about what happened in it
    # What the reader can pick to happen next, for an episode that ends on a choice, and the
    # index of the one they picked (None until they do, and for good if they never do).
    choices: tuple[Choice, ...] = ()
    chosen: int | None = None
    # Questions about what happens in it, for the check after reading (comprehension.py); none for
    # a text written before them, or whose call failed.
    questions: tuple[Question, ...] = ()


# "topic": the model chooses stretch words that fit the topic from a list of due and young words.
# "any": the stretch words are picked at random from that list and the model has to use them.
StretchWords = Literal["topic", "any"]


# How many lines a dialogue has: short, medium or long.
Length = Literal[6, 8, 12]


@dataclass(frozen=True)
class Settings:
    stretch_words: StretchWords = "topic"
    lines: Length = 8
    form: Form = "dialogue"
    language: Code = "th"  # the language new texts are written and served in
    # The deck each language's word list comes from, where it isn't the default (languages.py).
    decks: dict[str, str] = field(default_factory=dict)
    # The Azure voice for each voice slot (male, male2, female, female2: languages.VOICE_SLOTS) by
    # language, where one was chosen in the app.
    voices: dict[str, dict[str, str]] = field(default_factory=dict)
    # How many of each language's most common words count as known, where it isn't the default
    # (languages.py). Thai has none: only its deck counts.
    common: dict[str, int] = field(default_factory=dict)

    def common_for(self, language: Code) -> int:
        return self.common.get(language, LANGUAGES[language].common)


@dataclass(frozen=True)
class Reading:
    rating: str | None  # "too_easy", "about_right" or "too_hard"
    finished: bool
    words_glossed: tuple[str, ...]
    words_flagged: tuple[str, ...]
    audio_speed: float | None
    listen_only: bool
    seconds: int
    # The check after reading: questions answered right, of those asked. None when it wasn't taken.
    check_right: int | None = None
    check_asked: int | None = None


def connect(path: Path | str) -> sqlite3.Connection:
    # One connection shared by the async handlers, which all run on the event loop's thread.
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(_SCHEMA)
    if "roles" not in {r[1] for r in conn.execute("PRAGMA table_info(texts)")}:
        # Texts written before speakers had roles have none, and show only A and B.
        conn.execute("ALTER TABLE texts ADD COLUMN roles TEXT NOT NULL DEFAULT '{}'")
    for table in ("lexicon", "texts"):
        if "language" not in {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}:
            # Everything from before Spanish is Thai.
            conn.execute(f"ALTER TABLE {table} ADD COLUMN language TEXT NOT NULL DEFAULT 'th'")
    if "genders" not in {r[1] for r in conn.execute("PRAGMA table_info(texts)")}:
        # Who is a man or a woman in a dialogue; none before it was asked, and those texts are
        # read with A as a man and B as a woman.
        conn.execute("ALTER TABLE texts ADD COLUMN genders TEXT NOT NULL DEFAULT '{}'")
    if "characters" not in {r[1] for r in conn.execute("PRAGMA table_info(texts)")}:
        # The drawn character of each speaker; none before they were asked for, and those texts
        # show only A and B.
        conn.execute("ALTER TABLE texts ADD COLUMN characters TEXT NOT NULL DEFAULT '{}'")
    if "grammar" not in {r[1] for r in conn.execute("PRAGMA table_info(texts)")}:
        # The grammar a text was written to practice and avoid; none before grammar choices.
        conn.execute("ALTER TABLE texts ADD COLUMN grammar TEXT NOT NULL DEFAULT '{}'")
    if "form" not in {r[1] for r in conn.execute("PRAGMA table_info(texts)")}:
        # Every text written before stories was a dialogue.
        conn.execute("ALTER TABLE texts ADD COLUMN form TEXT NOT NULL DEFAULT 'dialogue'")
    if "translit" not in {r[1] for r in conn.execute("PRAGMA table_info(lexicon)")}:
        # Transliterations were read from the deck after the first snapshots. The words stay as
        # they are, but with no snapshot time the next refresh reads the deck again to fill them in.
        conn.execute("ALTER TABLE lexicon ADD COLUMN translit TEXT NOT NULL DEFAULT ''")
        conn.execute("DELETE FROM meta WHERE key LIKE 'snapshot_taken_at%'")
    if "translits" not in {r[1] for r in conn.execute("PRAGMA table_info(texts)")}:
        # The model's transliteration of the words it glossed; none before they were asked for.
        conn.execute("ALTER TABLE texts ADD COLUMN translits TEXT NOT NULL DEFAULT '{}'")
    if "focus" not in {r[1] for r in conn.execute("PRAGMA table_info(texts)")}:
        # The words a text was asked to practice (the app's "Read a text with these words"),
        # sorted and joined by newlines; empty for the texts the queue writes on its own.
        conn.execute("ALTER TABLE texts ADD COLUMN focus TEXT NOT NULL DEFAULT ''")
    if "removed" not in {r[1] for r in conn.execute("PRAGMA table_info(topics)")}:
        # A removed topic is hidden, not deleted, since its texts and readings point at it.
        conn.execute("ALTER TABLE topics ADD COLUMN removed INTEGER NOT NULL DEFAULT 0")
    texts_columns = {r[1] for r in conn.execute("PRAGMA table_info(texts)")}
    for column, sql in (
        # Why a text is on the shelf (Reason); empty for texts written before it.
        ("reason", "reason TEXT NOT NULL DEFAULT ''"),
        # A story episode's story and number, and its one sentence about what happened.
        ("story_id", "story_id INTEGER REFERENCES stories(id)"),
        ("episode", "episode INTEGER NOT NULL DEFAULT 0"),
        ("recap", "recap TEXT NOT NULL DEFAULT ''"),
        # A story episode's choices for what happens next (JSON) and the index the reader picked.
        ("choices", "choices TEXT NOT NULL DEFAULT '[]'"),
        ("chosen", "chosen INTEGER"),
        # Characters Azure has spoken for the text, each time its lines were recorded (a
        # re-recording counts again); what its audio cost is worked out from this.
        ("audio_chars", "audio_chars INTEGER NOT NULL DEFAULT 0"),
        # Questions about the text for the check after reading (JSON, comprehension.py).
        ("questions", "questions TEXT NOT NULL DEFAULT '[]'"),
    ):
        if column not in texts_columns:
            conn.execute(f"ALTER TABLE texts ADD COLUMN {sql}")
    readings_columns = {r[1] for r in conn.execute("PRAGMA table_info(readings)")}
    for column in ("check_right", "check_asked"):
        # The check after reading, when it was taken; NULL for readings before it and when it wasn't.
        if column not in readings_columns:
            conn.execute(f"ALTER TABLE readings ADD COLUMN {column} INTEGER")
    with conn:
        # A text left pending by a restart mid-audio: its missing lines are made on request.
        conn.execute("UPDATE texts SET status = 'ready' WHERE status = 'pending'")
    return conn


# ==== Lexicon ====


def _per_language(key: str, language: Code) -> str:
    # Thai keeps the key it had before there was a second language.
    return key if language == "th" else f"{key}:{language}"


def save_snapshot(
    conn: sqlite3.Connection, entries: list[Entry], taken_at: datetime, language: Code = "th"
) -> None:
    """Replaces one language's whole snapshot in one transaction, so a reader never sees half."""
    with conn:
        conn.execute("DELETE FROM lexicon WHERE language = ?", (language,))
        conn.executemany(
            # OR REPLACE: a note moved to the other language's deck belongs to the newer snapshot.
            "INSERT OR REPLACE INTO lexicon (note_id, entry, meaning, tier, due, language, translit)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                (e.note_id, e.text, e.meaning, e.tier, int(e.due), language, e.translit)
                for e in entries
            ],
        )
        _set_meta(conn, _per_language("snapshot_taken_at", language), taken_at.isoformat())


def load_snapshot(
    conn: sqlite3.Connection, language: Code = "th"
) -> tuple[list[Entry], datetime | None]:
    rows = conn.execute(
        "SELECT note_id, entry, meaning, tier, due, translit FROM lexicon WHERE language = ?"
        " ORDER BY note_id",
        (language,),
    )
    entries = [
        Entry(nid, entry, meaning, tier, bool(due), translit)
        for nid, entry, meaning, tier, due, translit in rows
    ]
    taken_at = _get_meta(conn, _per_language("snapshot_taken_at", language))
    return entries, datetime.fromisoformat(taken_at) if taken_at else None


def clear_snapshot(conn: sqlite3.Connection, language: Code) -> None:
    """Forgets one language's snapshot, when its deck changes: the old deck's words mustn't be
    written with until the new deck has been read."""
    with conn:
        conn.execute("DELETE FROM lexicon WHERE language = ?", (language,))
        conn.execute(
            "DELETE FROM meta WHERE key = ?", (_per_language("snapshot_taken_at", language),)
        )


def is_stale(taken_at: datetime | None, now: datetime) -> bool:
    return taken_at is None or now - taken_at >= SNAPSHOT_MAX_AGE


async def refresh_if_stale(
    conn: sqlite3.Connection,
    read: ReadDeck,
    now: datetime,
    language: Code = "th",
    force: bool = False,
) -> bool:
    """Takes a new snapshot of one language's deck when the last one is a day old, or now with
    `force`. If Anki can't be reached, the old snapshot stays in place and the app keeps running on
    it. Returns whether it refreshed."""
    _, taken_at = load_snapshot(conn, language)
    if not force and not is_stale(taken_at, now):
        return False
    name = LANGUAGES[language].name
    try:
        entries = await read(with_deck(language, load_settings(conn).decks.get(language)))
    except AnkiUnavailable as e:
        log.warning("%s lexicon not refreshed, using the snapshot from %s: %s", name, taken_at, e)
        return False
    if not entries:
        log.warning("The %s deck has no notes; keeping the snapshot from %s", name, taken_at)
        return False
    save_snapshot(conn, entries, now, language)
    return True


# ==== WaniKani ====
# The vocabulary learned in WaniKani, counted as known Japanese words (wanikani.py). Like the
# lexicon, only the latest list is kept.

_WANIKANI_TAKEN_AT = "wanikani_taken_at"


def save_wanikani(conn: sqlite3.Connection, words: list[WaniKaniWord], taken_at: datetime) -> None:
    with conn:
        conn.execute("DELETE FROM wanikani")
        conn.executemany(
            "INSERT OR REPLACE INTO wanikani (subject_id, characters, meaning, reading, srs_stage)"
            " VALUES (?, ?, ?, ?, ?)",
            [(w.subject_id, w.characters, w.meaning, w.reading, w.srs_stage) for w in words],
        )
        _set_meta(conn, _WANIKANI_TAKEN_AT, taken_at.isoformat())


def load_wanikani(conn: sqlite3.Connection) -> list[WaniKaniWord]:
    rows = conn.execute(
        "SELECT subject_id, characters, meaning, reading, srs_stage FROM wanikani"
        " ORDER BY subject_id"
    )
    return [WaniKaniWord(*row) for row in rows]


async def refresh_wanikani_if_stale(
    conn: sqlite3.Connection, read: ReadWaniKani, now: datetime, force: bool = False
) -> bool:
    """Reads WaniKani again when the last list is a day old, or now with `force`. If it can't be
    read, the last list stays. Returns whether it refreshed."""
    taken_at = _get_meta(conn, _WANIKANI_TAKEN_AT)
    if not force and not is_stale(datetime.fromisoformat(taken_at) if taken_at else None, now):
        return False
    try:
        words = await read()
    except WaniKaniUnavailable as e:
        log.warning("WaniKani not refreshed, using the list from %s: %s", taken_at, e)
        return False
    save_wanikani(conn, words, now)
    return True


# ==== Topics ====


def add_topic(
    conn: sqlite3.Connection, name: str, favorite: bool, now: datetime, hidden: bool = False
) -> Topic:
    """Adds a topic, or returns the existing one with that name (ignoring case). A removed topic
    with that name comes back, with any text it still had ready. A `hidden` one is added removed:
    the shelf files its own ideas that way, so they're never listed or offered again, until More
    like this makes one a liked theme (`set_favorite`)."""
    name = " ".join(name.split())
    if not name:
        raise ValueError("A topic needs a name")
    with conn:
        conn.execute(
            "INSERT OR IGNORE INTO topics (name, favorite, created_at, removed) VALUES (?, ?, ?, ?)",
            (name, int(favorite), now.isoformat(), int(hidden)),
        )
        if not hidden:
            conn.execute(
                "UPDATE topics SET removed = 0, favorite = ? WHERE name = ? AND removed = 1",
                (int(favorite), name),
            )
    row = conn.execute("SELECT id FROM topics WHERE name = ?", (name,)).fetchone()
    topic = get_topic(conn, row[0], include_removed=True)
    assert topic is not None
    return topic


def get_topic(
    conn: sqlite3.Connection, topic_id: int, language: Code = "th", include_removed: bool = False
) -> Topic | None:
    """A listed topic, or with `include_removed` a removed one too (a story's own topic is)."""
    found = next((t for t in list_topics(conn, language) if t.id == topic_id), None)
    if found is not None or not include_removed:
        return found
    row = conn.execute(
        """SELECT t.id, t.name, t.favorite,
                  (SELECT COUNT(*) FROM texts x WHERE x.topic_id = t.id AND x.status = 'ready'
                   AND x.language = ? AND x.focus = '')
           FROM topics t WHERE t.id = ?""",
        (language, topic_id),
    ).fetchone()
    return Topic(row[0], row[1], bool(row[2]), row[3]) if row else None


def list_topics(conn: sqlite3.Connection, language: Code = "th") -> list[Topic]:
    """Topics are shared by every language; `ready` counts the texts waiting in this one."""
    rows = conn.execute(
        """SELECT t.id, t.name, t.favorite,
                  (SELECT COUNT(*) FROM texts x WHERE x.topic_id = t.id AND x.status = 'ready'
                   AND x.language = ? AND x.focus = '')
           FROM topics t WHERE t.removed = 0 ORDER BY t.favorite DESC, t.name""",
        (language,),
    )
    return [Topic(i, name, bool(fav), ready) for i, name, fav, ready in rows]


def set_favorite(conn: sqlite3.Connection, topic_id: int, favorite: bool) -> Topic | None:
    """Likes a topic or stops liking it. Liking one the shelf filed away (hidden) lists it again,
    since it's now a theme; a topic removed from the list stays removed either way."""
    with conn:
        conn.execute(
            "UPDATE topics SET favorite = ? WHERE id = ? AND removed = 0", (int(favorite), topic_id)
        )
        if favorite:
            # A shelf idea is hidden, never removed by hand: no reading of it was a removal.
            conn.execute(
                "UPDATE topics SET favorite = 1, removed = 0 WHERE id = ? AND removed = 1"
                " AND id NOT IN (SELECT topic_id FROM stories)",
                (topic_id,),
            )
    return get_topic(conn, topic_id)


def topic_names(conn: sqlite3.Connection) -> set[str]:
    """Every topic's name, removed ones included."""
    return {name for (name,) in conn.execute("SELECT name FROM topics")}


def remove_topic(conn: sqlite3.Connection, topic_id: int) -> bool:
    """Hides a topic from the list and the background top-up. Returns whether there was one."""
    with conn:
        cur = conn.execute(
            "UPDATE topics SET removed = 1 WHERE id = ? AND removed = 0", (topic_id,)
        )
    return cur.rowcount > 0


# ==== Texts ====


def save_text(
    conn: sqlite3.Connection,
    topic_id: int,
    generated: Generated,
    stretch: list[str],
    floor: float,
    now: datetime,
    status: str = "ready",
    form: Form = "dialogue",
    language: Code = "th",
    grammar: dict[str, list[str]] | None = None,
    focus: str = "",
    reason: Reason = "",
    story_id: int | None = None,
    episode: int = 0,
) -> int:
    """Stores a generated text. `status` is "pending" while its audio is made, "ready" once it can
    be served, "dropped" for a text that missed the floor (kept only for its cost), "read" once
    it's been read, or "skipped" for one taken off the shelf unread (Not this)."""
    u = generated.usage
    with conn:
        cur = conn.execute(
            """INSERT INTO texts (topic_id, created_at, status, title, lines, glosses, stretch,
                   coverage, token_count, floor, attempts, model, input_tokens, output_tokens,
                   cache_read_tokens, cache_write_tokens, cost_usd, roles, form, language, grammar,
                   focus, translits, reason, story_id, episode, recap, genders, characters,
                   choices)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?)""",
            (
                topic_id,
                now.isoformat(),
                status,
                generated.title,
                json.dumps([ln.__dict__ for ln in generated.lines], ensure_ascii=False),
                json.dumps(generated.glosses, ensure_ascii=False),
                json.dumps(stretch, ensure_ascii=False),
                generated.coverage.ratio,
                generated.coverage.counted,
                floor,
                generated.attempts,
                u.model or MODEL,
                u.input_tokens,
                u.output_tokens,
                u.cache_read_tokens,
                u.cache_write_tokens,
                u.cost_usd(),
                json.dumps(generated.roles, ensure_ascii=False),
                form,
                language,
                json.dumps(grammar or {}),
                focus,
                json.dumps(generated.translits, ensure_ascii=False),
                reason,
                story_id,
                episode,
                generated.recap,
                json.dumps(generated.genders),
                json.dumps(generated.characters),
                json.dumps([c.__dict__ for c in generated.choices], ensure_ascii=False),
            ),
        )
    assert cur.lastrowid is not None
    return cur.lastrowid


def set_choice(conn: sqlite3.Connection, text_id: int, index: int) -> str:
    """Records which of an episode's choices the reader picked, replacing an earlier pick. Returns
    "ok", "unknown" for no such text or no such choice on it, or "read" for an episode already
    read, since the next episode is written from the pick once it is."""
    with conn:
        row = conn.execute("SELECT status, choices FROM texts WHERE id = ?", (text_id,)).fetchone()
        if row is None or not 0 <= index < len(json.loads(row[1])):
            return "unknown"
        if row[0] == "read":
            return "read"
        conn.execute("UPDATE texts SET chosen = ? WHERE id = ?", (index, text_id))
    return "ok"


def mark_ready(conn: sqlite3.Connection, text_id: int) -> None:
    with conn:
        conn.execute("UPDATE texts SET status = 'ready' WHERE id = ?", (text_id,))


def text_status(conn: sqlite3.Connection, text_id: int) -> str | None:
    row = conn.execute("SELECT status FROM texts WHERE id = ?", (text_id,)).fetchone()
    return row[0] if row else None


def next_ready_text(
    conn: sqlite3.Connection, topic_id: int, language: Code = "th", focus: str = ""
) -> StoredText | None:
    """The oldest ready text, written for `focus` (the queue's own when it's empty)."""
    row = conn.execute(
        f"SELECT {_TEXT_COLUMNS} FROM texts WHERE topic_id = ? AND status = 'ready' "
        "AND language = ? AND focus = ? ORDER BY id LIMIT 1",
        (topic_id, language, focus),
    ).fetchone()
    return _text(row) if row else None


def ready_texts(conn: sqlite3.Connection, language: Code) -> list[StoredText]:
    """Every text written and not yet served in `language`, oldest first."""
    rows = conn.execute(
        f"SELECT {_TEXT_COLUMNS} FROM texts WHERE status = 'ready' AND language = ? ORDER BY id",
        (language,),
    ).fetchall()
    return [_text(r) for r in rows]


def recent_texts(conn: sqlite3.Connection, language: Code, limit: int) -> list[StoredText]:
    """The newest texts in `language` that can be opened (waiting or already read), newest first."""
    rows = conn.execute(
        f"SELECT {_TEXT_COLUMNS} FROM texts WHERE status IN ('ready', 'read') AND language = ?"
        " ORDER BY id DESC LIMIT ?",
        (language, limit),
    ).fetchall()
    return [_text(r) for r in rows]


def get_text(conn: sqlite3.Connection, text_id: int) -> StoredText | None:
    row = conn.execute(f"SELECT {_TEXT_COLUMNS} FROM texts WHERE id = ?", (text_id,)).fetchone()
    return _text(row) if row else None


_TEXT_COLUMNS = (
    "id, topic_id, title, lines, glosses, stretch, coverage, roles, form, language, grammar,"
    " translits, reason, story_id, episode, recap, genders, characters, choices, chosen,"
    " questions"
)


def _text(row: tuple[Any, ...]) -> StoredText:
    (
        text_id,
        topic_id,
        title,
        lines,
        glosses,
        stretch,
        coverage,
        roles,
        form,
        language,
        grammar,
        translits,
        reason,
        story_id,
        episode,
        recap,
        genders,
        characters,
        choices,
        chosen,
        questions,
    ) = row
    return StoredText(
        id=text_id,
        topic_id=topic_id,
        title=title,
        lines=tuple(Line(**ln) for ln in json.loads(lines)),
        glosses=json.loads(glosses),
        stretch=tuple(json.loads(stretch)),
        coverage=coverage,
        roles=json.loads(roles),
        form=form,
        language=language,
        grammar=json.loads(grammar),
        translits=json.loads(translits),
        reason=reason,
        story_id=story_id,
        episode=episode,
        recap=recap,
        genders=json.loads(genders),
        characters=json.loads(characters),
        choices=tuple(Choice(**c) for c in json.loads(choices)),
        chosen=chosen,
        questions=tuple(from_json(q) for q in json.loads(questions)),
    )


def save_questions(conn: sqlite3.Connection, text_id: int, questions: tuple[Question, ...]) -> None:
    with conn:
        conn.execute(
            "UPDATE texts SET questions = ? WHERE id = ?",
            (json.dumps([q.as_json() for q in questions], ensure_ascii=False), text_id),
        )


# ==== Explanations ====


def get_explanation(
    conn: sqlite3.Connection, text_id: int, line: int, simple: bool
) -> list[dict[str, str]] | None:
    row = conn.execute(
        "SELECT points FROM explanations WHERE text_id = ? AND line = ? AND simple = ?",
        (text_id, line, int(simple)),
    ).fetchone()
    return json.loads(row[0]) if row else None


def save_explanation(
    conn: sqlite3.Connection,
    text_id: int,
    line: int,
    simple: bool,
    points: list[dict[str, str]],
    now: datetime,
    cost_usd: float = 0.0,
) -> None:
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO explanations (text_id, line, simple, points, created_at, cost_usd)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (
                text_id,
                line,
                int(simple),
                json.dumps(points, ensure_ascii=False),
                now.isoformat(),
                cost_usd,
            ),
        )


def get_naturalness(conn: sqlite3.Connection, text_id: int, line: int) -> dict[str, str] | None:
    row = conn.execute(
        "SELECT answer FROM naturalness WHERE text_id = ? AND line = ?", (text_id, line)
    ).fetchone()
    return json.loads(row[0]) if row else None


def save_naturalness(
    conn: sqlite3.Connection,
    text_id: int,
    line: int,
    answer: dict[str, str],
    now: datetime,
    cost_usd: float = 0.0,
) -> None:
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO naturalness (text_id, line, answer, created_at, cost_usd)"
            " VALUES (?, ?, ?, ?, ?)",
            (text_id, line, json.dumps(answer, ensure_ascii=False), now.isoformat(), cost_usd),
        )


# ==== Shelf ====


def shelf_texts(conn: sqlite3.Connection, language: Code) -> list[StoredText]:
    """The texts waiting on a language's shelf, oldest first: every ready one written for the shelf
    or a topic, not one written to practice words just studied (focus) or a story episode."""
    rows = conn.execute(
        f"SELECT {_TEXT_COLUMNS} FROM texts WHERE status = 'ready' AND language = ? AND focus = ''"
        " AND story_id IS NULL ORDER BY id",
        (language,),
    ).fetchall()
    return [_text(r) for r in rows]


def ready_counts(conn: sqlite3.Connection) -> dict[Code, int]:
    """How many texts are waiting in each language: the shelf and the story's next episode."""
    rows = conn.execute(
        "SELECT language, COUNT(*) FROM texts WHERE status = 'ready' AND focus = '' GROUP BY language"
    )
    return {language: count for language, count in rows}


def skip_text(conn: sqlite3.Connection, text_id: int) -> bool:
    """Takes a text waiting on the shelf off it unread (Not this). Returns whether one was."""
    with conn:
        cur = conn.execute(
            "UPDATE texts SET status = 'skipped' WHERE id = ? AND status = 'ready'", (text_id,)
        )
    return cur.rowcount > 0


def topic_name(conn: sqlite3.Connection, topic_id: int) -> str:
    row = conn.execute("SELECT name FROM topics WHERE id = ?", (topic_id,)).fetchone()
    return row[0] if row else ""


def liked_topics(conn: sqlite3.Connection) -> list[Topic]:
    """The themes the owner likes (favorite topics), shared by every language, by name. Their
    ready count isn't filled in."""
    rows = conn.execute(
        "SELECT id, name FROM topics WHERE favorite = 1 AND removed = 0 ORDER BY name"
    )
    return [Topic(i, name, True, 0) for i, name in rows]


# ==== Stories ====


@dataclass(frozen=True)
class Story:
    id: int
    language: Code
    topic_id: int  # a hidden topic of its own, which its episodes are filed under
    about: str
    title: str
    cast: str


def start_story(conn: sqlite3.Connection, language: Code, about: str, now: datetime) -> Story:
    """Starts a new story in a language and retires the one before it (its episodes stay readable
    in Past texts)."""
    about = " ".join(about.split())
    with conn:
        conn.execute("UPDATE stories SET active = 0 WHERE language = ? AND active = 1", (language,))
        # Episodes need a topic; the story's is removed, so it's never listed or offered. Its
        # name only has to be unique: the next story's number.
        (number,) = conn.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM stories").fetchone()
        cur = conn.execute(
            "INSERT INTO topics (name, favorite, created_at, removed) VALUES (?, 0, ?, 1)",
            (f"Ongoing story {number}", now.isoformat()),
        )
        topic_id = cur.lastrowid
        cur = conn.execute(
            "INSERT INTO stories (language, topic_id, about, created_at) VALUES (?, ?, ?, ?)",
            (language, topic_id, about, now.isoformat()),
        )
    story = get_story(conn, cur.lastrowid or 0)
    assert story is not None
    return story


def get_story(conn: sqlite3.Connection, story_id: int) -> Story | None:
    row = conn.execute(
        "SELECT id, language, topic_id, about, title, cast_ FROM stories WHERE id = ?",
        (story_id,),
    ).fetchone()
    return Story(*row) if row else None


def active_story(conn: sqlite3.Connection, language: Code) -> Story | None:
    row = conn.execute(
        "SELECT id FROM stories WHERE language = ? AND active = 1 ORDER BY id DESC LIMIT 1",
        (language,),
    ).fetchone()
    return get_story(conn, row[0]) if row else None


def name_story(conn: sqlite3.Connection, story_id: int, title: str, cast: str) -> None:
    """Records the name and cast the first episode gave the story, where it has none yet."""
    with conn:
        conn.execute(
            "UPDATE stories SET title = CASE WHEN title = '' THEN ? ELSE title END,"
            " cast_ = CASE WHEN cast_ = '' THEN ? ELSE cast_ END WHERE id = ?",
            (title, cast, story_id),
        )


def waiting_episode(
    conn: sqlite3.Connection, story_id: int, pending: bool = False
) -> StoredText | None:
    """The story's episode waiting to be read, if there is one; with `pending`, one still having
    its audio made counts too."""
    statuses = "('pending', 'ready')" if pending else "('ready')"
    row = conn.execute(
        f"SELECT {_TEXT_COLUMNS} FROM texts WHERE story_id = ? AND status IN {statuses}"
        " ORDER BY episode LIMIT 1",
        (story_id,),
    ).fetchone()
    return _text(row) if row else None


def episodes(conn: sqlite3.Connection, story_id: int) -> list[StoredText]:
    """A story's episodes, first to last, leaving out drafts that were dropped."""
    rows = conn.execute(
        f"SELECT {_TEXT_COLUMNS} FROM texts WHERE story_id = ? AND status IN ('pending', 'ready',"
        " 'read') ORDER BY episode, id",
        (story_id,),
    ).fetchall()
    return [_text(r) for r in rows]


# ==== Readings ====


def log_reading(conn: sqlite3.Connection, text_id: int, reading: Reading, now: datetime) -> None:
    """Records one session with a text. The text leaves the ready queue either way, so the same
    text isn't served twice."""
    row = conn.execute("SELECT language FROM texts WHERE id = ?", (text_id,)).fetchone()
    language: Code = row[0] if row else "th"
    with conn:
        conn.execute(
            """INSERT INTO readings (text_id, logged_at, language, mode, rating, finished,
                   words_glossed, words_flagged, audio_speed, listen_only, seconds, check_right,
                   check_asked)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                text_id,
                now.isoformat(),
                LOG_LANGUAGE[language],
                MODE,
                reading.rating,
                int(reading.finished),
                json.dumps(list(reading.words_glossed), ensure_ascii=False),
                json.dumps(list(reading.words_flagged), ensure_ascii=False),
                reading.audio_speed,
                int(reading.listen_only),
                reading.seconds,
                reading.check_right,
                reading.check_asked,
            ),
        )
        # Only a text that was served: a dropped or skipped one keeps its status, so the costs
        # still count it as what it was.
        conn.execute(
            "UPDATE texts SET status = 'read' WHERE id = ? AND status = 'ready'", (text_id,)
        )


def reading_seconds(conn: sqlite3.Connection, start: datetime, end: datetime) -> int:
    """Seconds spent reading and listening between two times (naive UTC, the engine's clock), in
    every language, as the app logged each session."""
    row = conn.execute(
        "SELECT COALESCE(SUM(seconds), 0) FROM readings WHERE logged_at >= ? AND logged_at < ?",
        (start.isoformat(), end.isoformat()),
    ).fetchone()
    return int(row[0])


FRANKI_COUNTS_KEY = "franki_counts"


@dataclass(frozen=True)
class FrankiCounts:
    """What Franki's deck list said, the last time Franki reported it: the cards due (reviews and
    learning) and the new cards still to come today, its progress gates included."""

    due: int
    new: int
    reported_at: datetime  # naive UTC, the engine's clock


def save_franki_counts(conn: sqlite3.Connection, counts: FrankiCounts) -> None:
    value = {"due": counts.due, "new": counts.new, "reported_at": counts.reported_at.isoformat()}
    with conn:
        _set_meta(conn, FRANKI_COUNTS_KEY, json.dumps(value))


def load_franki_counts(conn: sqlite3.Connection) -> FrankiCounts | None:
    raw = _get_meta(conn, FRANKI_COUNTS_KEY)
    if not raw:
        return None
    try:
        v = json.loads(raw)
        return FrankiCounts(int(v["due"]), int(v["new"]), datetime.fromisoformat(v["reported_at"]))
    except (ValueError, KeyError, TypeError):
        return None


def last_finished_reading(conn: sqlite3.Connection, language: Code) -> datetime | None:
    """When a text in the language was last read to the end (naive UTC, the engine's clock), or None."""
    row = conn.execute(
        """SELECT MAX(r.logged_at) FROM readings r JOIN texts x ON x.id = r.text_id
           WHERE r.finished = 1 AND x.language = ?""",
        (language,),
    ).fetchone()
    return datetime.fromisoformat(row[0]) if row and row[0] else None


@dataclass(frozen=True)
class Progress:
    """Finished readings since a date: what the Milestone 1 exit check reads (docs/read-and-listen/brief.md)."""

    finished: int
    median_coverage: float | None
    ratings: dict[str, int]  # too_easy, about_right, too_hard, and none for unrated
    # The check after reading, over the readings it was taken with: how many, and the answers right
    # of those asked (None when it wasn't taken).
    checked: int = 0
    check_right: int = 0
    check_asked: int = 0


def progress(conn: sqlite3.Connection, since: datetime, language: Code = "th") -> Progress:
    rows = conn.execute(
        """SELECT x.coverage, r.rating, r.check_right, r.check_asked
           FROM readings r JOIN texts x ON x.id = r.text_id
           WHERE r.finished = 1 AND r.logged_at >= ? AND x.language = ?""",
        (since.isoformat(), language),
    ).fetchall()
    ratings = {"too_easy": 0, "about_right": 0, "too_hard": 0, "none": 0}
    for _, rating, _, _ in rows:
        ratings[rating or "none"] += 1
    coverages = [row[0] for row in rows]
    median = statistics.median(coverages) if coverages else None
    checks = [(right, asked) for _, _, right, asked in rows if asked]
    return Progress(
        len(rows),
        median,
        ratings,
        len(checks),
        sum(right for right, _ in checks),
        sum(asked for _, asked in checks),
    )


@dataclass(frozen=True)
class Spending:
    """What texts cost Claude since a date. Every text written counts: a dropped one (it missed the
    floor and was never served) cost as much as any other."""

    read: int
    waiting: int  # written and not read yet ("pending" while its audio is made, or "ready")
    dropped: int
    attempts: int  # Claude conversations' answers, summed over the texts
    cost_usd: float  # Claude's alone; Azure's is worked out from `audio_chars`
    skipped: int = 0  # taken off the shelf unread (Not this)
    audio_chars: int = 0  # characters Azure spoke for these texts, re-recordings included

    @property
    def texts(self) -> int:
        return self.read + self.waiting + self.dropped + self.skipped


def spending(conn: sqlite3.Connection, since: datetime) -> dict[Code, Spending]:
    """Each language with a text written since `since`, the most spent first. A text's audio counts
    wherever it was recorded: a re-recording months later is still that text's cost."""
    by_language: dict[Code, dict[str, Any]] = {}
    for language, status, count, attempts, cost, chars in conn.execute(
        """SELECT language, status, COUNT(*), SUM(attempts), SUM(cost_usd), SUM(audio_chars)
           FROM texts WHERE created_at >= ? GROUP BY language, status""",
        (since.isoformat(),),
    ):
        row = by_language.setdefault(
            language,
            {
                "read": 0,
                "waiting": 0,
                "dropped": 0,
                "skipped": 0,
                "attempts": 0,
                "cost": 0.0,
                "chars": 0,
            },
        )
        row[status if status in ("read", "dropped", "skipped") else "waiting"] += count
        row["attempts"] += attempts
        row["cost"] += cost
        row["chars"] += chars
    out = {
        language: Spending(
            r["read"],
            r["waiting"],
            r["dropped"],
            r["attempts"],
            r["cost"],
            r["skipped"],
            r["chars"],
        )
        for language, r in by_language.items()
    }
    return dict(sorted(out.items(), key=lambda item: -item[1].cost_usd))


def add_audio_chars(conn: sqlite3.Connection, text_id: int, characters: int) -> None:
    """Adds the characters Azure just spoke for a text to what it has cost so far."""
    with conn:
        conn.execute(
            "UPDATE texts SET audio_chars = audio_chars + ? WHERE id = ?", (characters, text_id)
        )


_AUDIO_CHARS_COUNTED = "audio_chars_counted"


def texts_missing_audio_chars(conn: sqlite3.Connection) -> list[StoredText] | None:
    """The texts with no audio count, for a one-time estimate from the audio already on the volume
    (the characters were not counted before this). None once that has been done."""
    if _get_meta(conn, _AUDIO_CHARS_COUNTED):
        return None
    rows = conn.execute(f"SELECT {_TEXT_COLUMNS} FROM texts WHERE audio_chars = 0").fetchall()
    return [_text(r) for r in rows]


def mark_audio_chars_counted(conn: sqlite3.Connection) -> None:
    with conn:
        _set_meta(conn, _AUDIO_CHARS_COUNTED, "1")


def get_phrase_explanation(
    conn: sqlite3.Connection, text_id: int, line: int, phrase: str, simple: bool
) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT answer FROM phrase_explanations"
        " WHERE text_id = ? AND line = ? AND phrase = ? AND simple = ?",
        (text_id, line, phrase, int(simple)),
    ).fetchone()
    return json.loads(row[0]) if row else None


def save_phrase_explanation(
    conn: sqlite3.Connection,
    text_id: int,
    line: int,
    phrase: str,
    simple: bool,
    answer: dict[str, Any],
    now: datetime,
    cost_usd: float = 0.0,
) -> None:
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO phrase_explanations"
            " (text_id, line, phrase, simple, answer, created_at, cost_usd)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                text_id,
                line,
                phrase,
                int(simple),
                json.dumps(answer, ensure_ascii=False),
                now.isoformat(),
                cost_usd,
            ),
        )


def explanation_spending(
    conn: sqlite3.Connection, since: datetime
) -> dict[Code, tuple[int, float]]:
    """Each language with a line or a phrase explained, or a line checked for sounding natural,
    since `since`: how many answers were asked for (a plainer version counts again, and so does a
    call that failed after Claude answered, from `call_costs`) and what they cost Claude."""
    return {
        language: (count, cost)
        for language, count, cost in conn.execute(
            """SELECT language, COUNT(*), SUM(cost_usd) FROM (
                   SELECT t.language, e.created_at, e.cost_usd FROM (
                       SELECT text_id, created_at, cost_usd FROM explanations
                       UNION ALL SELECT text_id, created_at, cost_usd FROM phrase_explanations
                       UNION ALL SELECT text_id, created_at, cost_usd FROM naturalness
                   ) e JOIN texts t ON t.id = e.text_id
                   UNION ALL SELECT language, created_at, cost_usd FROM call_costs
                       WHERE feature IN ('explain', 'phrase', 'natural')
               ) WHERE created_at >= ? GROUP BY language ORDER BY SUM(cost_usd) DESC""",
            (since.isoformat(),),
        )
    }


# What a row of `call_costs` was for. A failed "explain", "phrase" or "natural" call counts with
# the answers kept for those (`explanation_spending`).
CallFeature = Literal[
    "explain", "phrase", "natural", "mnemonics", "recording", "note_queue", "questions"
]


def save_call_cost(
    conn: sqlite3.Connection,
    feature: CallFeature,
    language: str,
    now: datetime,
    cost_usd: float = 0.0,
    audio_chars: int = 0,
) -> None:
    """What one call cost, when nothing else keeps it (the `call_costs` table). `language` is a
    language code, or empty for a recording."""
    with conn:
        conn.execute(
            "INSERT INTO call_costs (feature, language, created_at, cost_usd, audio_chars)"
            " VALUES (?, ?, ?, ?, ?)",
            (feature, language, now.isoformat(), cost_usd, audio_chars),
        )


def mnemonic_spending(conn: sqlite3.Connection, since: datetime) -> dict[Code, tuple[int, float]]:
    """Each language with memory hints asked for since `since`: how many calls (failed ones
    included) and what they cost Claude."""
    return _feature_spending(conn, "mnemonics", since)


def question_spending(conn: sqlite3.Connection, since: datetime) -> dict[Code, tuple[int, float]]:
    """Each language with questions written for the check after reading since `since`: how many
    calls (failed ones included) and what they cost Claude."""
    return _feature_spending(conn, "questions", since)


def _feature_spending(
    conn: sqlite3.Connection, feature: CallFeature, since: datetime
) -> dict[Code, tuple[int, float]]:
    return {
        language: (count, cost)
        for language, count, cost in conn.execute(
            "SELECT language, COUNT(*), SUM(cost_usd) FROM call_costs"
            " WHERE feature = ? AND created_at >= ?"
            " GROUP BY language ORDER BY SUM(cost_usd) DESC",
            (feature, since.isoformat()),
        )
    }


def recording_spending(conn: sqlite3.Connection, since: datetime) -> tuple[int, int]:
    """Cards recorded by an Azure voice since `since`, and the characters Azure billed for them."""
    count, chars = conn.execute(
        "SELECT COUNT(*), SUM(audio_chars) FROM call_costs"
        " WHERE feature = 'recording' AND created_at >= ?",
        (since.isoformat(),),
    ).fetchone()
    return int(count), int(chars or 0)


def practiced_days(
    conn: sqlite3.Connection,
    before: datetime,
    language: Code = "th",
    rollover: int = DEFAULT_ROLLOVER,
    zone: tzinfo | None = None,
) -> dict[str, int]:
    """For each word that was a stretch word in a text read before `before`, the number of
    different study days it was one (study_day.py: the owner's day, not UTC's)."""
    rows = conn.execute(
        """SELECT r.logged_at, x.stretch FROM readings r
           JOIN texts x ON x.id = r.text_id WHERE r.logged_at < ? AND x.language = ?""",
        (before.isoformat(), language),
    )
    days: dict[str, set[date]] = {}
    for logged_at, stretch in rows:
        day = study_day(datetime.fromisoformat(logged_at), rollover, zone)
        for word in json.loads(stretch):
            days.setdefault(word, set()).add(day)
    return {word: len(d) for word, d in days.items()}


@dataclass(frozen=True)
class PastText:
    id: int
    topic: str
    title: str
    rating: str | None
    read_at: datetime
    coverage: float
    form: Form = "dialogue"
    episode: int = 0  # a story episode's number, else 0


def past_texts(
    conn: sqlite3.Connection, limit: int, language: Code = "th", story_id: int | None = None
) -> list[PastText]:
    """Texts in this language read to the end, most recent first; with `story_id`, that story's
    episodes, first to last. A story episode's topic is the story's name."""
    where, order = "x.language = ?", "r.id DESC"
    args: list[Any] = [language]
    if story_id is not None:
        where, order, args = "x.story_id = ?", "x.episode, r.id", [story_id]
    rows = conn.execute(
        f"""SELECT x.id, COALESCE(NULLIF(s.title, ''), t.name), x.title, r.rating, r.logged_at,
                   x.coverage, x.form, x.episode
            FROM readings r JOIN texts x ON x.id = r.text_id JOIN topics t ON t.id = x.topic_id
            LEFT JOIN stories s ON s.id = x.story_id
            WHERE r.finished = 1 AND {where} ORDER BY {order} LIMIT ?""",
        (*args, limit),
    )
    return [
        PastText(i, topic, title, rating, datetime.fromisoformat(at), coverage, form, episode)
        for i, topic, title, rating, at, coverage, form, episode in rows
    ]


# ==== Marked words ====


@dataclass(frozen=True)
class MarkedWord:
    word: str
    times: int  # readings it was marked in since it was last cleared
    last_marked: datetime
    glosses: dict[str, str]  # the glosses of the last text it was marked in


def marked_words(conn: sqlite3.Connection, language: Code = "th") -> list[MarkedWord]:
    """Every word marked unknown in a reading in this language and not cleared since, most
    recently marked first."""
    cleared = {
        word: datetime.fromisoformat(at)
        for word, at in conn.execute("SELECT word, cleared_at FROM cleared_words")
    }
    rows = conn.execute(
        """SELECT r.logged_at, r.words_flagged, x.glosses FROM readings r
           JOIN texts x ON x.id = r.text_id WHERE x.language = ? ORDER BY r.id""",
        (language,),
    )
    found: dict[str, MarkedWord] = {}
    for logged_at, flagged, glosses in rows:
        at = datetime.fromisoformat(logged_at)
        for word in json.loads(flagged):
            if word in cleared and at <= cleared[word]:
                continue
            times = found[word].times + 1 if word in found else 1
            found[word] = MarkedWord(word, times, at, json.loads(glosses))
    return sorted(found.values(), key=lambda w: w.last_marked, reverse=True)


def clear_word(conn: sqlite3.Connection, word: str, now: datetime) -> None:
    """Takes a word off the marked list until it's marked again."""
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO cleared_words (word, cleared_at) VALUES (?, ?)",
            (word, now.isoformat()),
        )


# ==== Difficulty ====


# v2: the range moved down on 12 November 2026 (95% was the old lowest target), so a floor saved
# before it, which can't go below 95%, starts again at the new default rather than staying there.
_DIFFICULTY_KEY = "difficulty_v2"


def load_difficulty(conn: sqlite3.Connection, language: Code = "th") -> Difficulty:
    """Each language has its own, moved by ratings of texts in that language."""
    raw = _get_meta(conn, _per_language(_DIFFICULTY_KEY, language))
    return Difficulty(**json.loads(raw)) if raw else Difficulty()


def save_difficulty(
    conn: sqlite3.Connection, difficulty: Difficulty, language: Code = "th"
) -> None:
    with conn:
        _set_meta(conn, _per_language(_DIFFICULTY_KEY, language), json.dumps(difficulty.__dict__))


# ==== Grammar ====

GrammarState = Literal["practice", "avoid", "normal"]


def load_grammar(conn: sqlite3.Connection) -> dict[str, GrammarState]:
    """The owner's grammar choices for every language, by point id. A point that isn't listed is
    not set: allowed a little, and never worked in on purpose (docs/read-and-listen/architecture.md,
    Grammar). Before 12 November 2026 normal ("Know it") wasn't stored either, so a point the owner
    set to it then reads as not set. A point the catalog marks `known` reads as Know it until the
    owner chooses otherwise."""
    raw = _get_meta(conn, "grammar")
    chosen: dict[str, GrammarState] = json.loads(raw) if raw else {}
    defaults: dict[str, GrammarState] = {p.id: "normal" for p in grammar.POINTS.values() if p.known}
    return {**defaults, **chosen}


def set_grammar(conn: sqlite3.Connection, point_id: str, state: GrammarState) -> None:
    choices = load_grammar(conn)
    choices[point_id] = state
    with conn:
        _set_meta(conn, "grammar", json.dumps(choices))


def finished_texts(conn: sqlite3.Connection, language: Code) -> list[tuple[StoredText, datetime]]:
    """Every text in this language read to the end, each with when it was last read."""
    rows = conn.execute(
        """SELECT r.text_id, MAX(r.logged_at) FROM readings r JOIN texts x ON x.id = r.text_id
           WHERE r.finished = 1 AND x.language = ? GROUP BY r.text_id""",
        (language,),
    ).fetchall()
    out = []
    for text_id, at in rows:
        text = get_text(conn, text_id)
        if text is not None:
            out.append((text, datetime.fromisoformat(at)))
    return out


def grammar_offered(conn: sqlite3.Connection, language: Code) -> dict[str, datetime]:
    """For each grammar point a text in this language was asked to work in for review, when the
    latest such text was written, read or not."""
    rows = conn.execute(
        "SELECT created_at, grammar FROM texts WHERE language = ?", (language,)
    ).fetchall()
    out: dict[str, datetime] = {}
    for created, raw in rows:
        at = datetime.fromisoformat(created)
        for pid in json.loads(raw).get("review", []):
            if pid not in out or at > out[pid]:
                out[pid] = at
    return out


# ==== Settings ====


def load_settings(conn: sqlite3.Connection) -> Settings:
    raw = _get_meta(conn, "settings")
    saved = json.loads(raw) if raw else {}
    # Only known keys, so a setting removed later doesn't break loading.
    settings = Settings(**{k: v for k, v in saved.items() if k in Settings.__dataclass_fields__})
    # Voices were chosen for speakers A and B before they were chosen by gender; those choices
    # aren't carried over, as nothing says which gender a chosen voice is.
    slots: frozenset[str] = frozenset(VOICE_SLOTS)
    voices: dict[str, dict[str, str]] = {}
    for code, chosen in settings.voices.items():
        kept = {slot: name for slot, name in chosen.items() if slot in slots}
        if kept:
            voices[code] = kept
    # A hidden language chosen before it was hidden is read as Thai, so the app never gets it.
    language = "th" if settings.language in HIDDEN_LANGUAGES else settings.language
    return replace(settings, voices=voices, language=language)


def save_settings(conn: sqlite3.Connection, settings: Settings) -> None:
    with conn:
        _set_meta(conn, "settings", json.dumps(settings.__dict__))


# Set once the texts waiting to be read when word timings came in have been re-recorded with them
# (Engine.time_waiting_texts).
_WAITING_TIMED_KEY = "waiting_texts_timed"


def waiting_texts_timed(conn: sqlite3.Connection) -> bool:
    return _get_meta(conn, _WAITING_TIMED_KEY) is not None


def mark_waiting_texts_timed(conn: sqlite3.Connection) -> None:
    with conn:
        _set_meta(conn, _WAITING_TIMED_KEY, "1")


def _get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None


def _set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", (key, value))


# ==== Grammar drills ====


@dataclass(frozen=True)
class StoredGap:
    id: int
    point_id: str
    before: str
    answer: str
    after: str
    english: str
    wrong: tuple[str, ...]
    hint: str


def save_drill_batch(
    conn: sqlite3.Connection,
    point_id: str,
    language: Code,
    questions: list[Any],
    asked: int,
    now: datetime,
    cost_usd: float,
) -> None:
    """A batch Claude wrote for a point: its cost, and the questions that passed (drills.GapQuestion)."""
    with conn:
        batch = conn.execute(
            "INSERT INTO drill_batches (point_id, language, asked, kept, created_at, cost_usd)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (point_id, language, asked, len(questions), now.isoformat(), cost_usd),
        ).lastrowid
        conn.executemany(
            "INSERT INTO drill_questions"
            " (batch_id, point_id, before, answer, after, english, wrong, hint)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    batch,
                    point_id,
                    q.before,
                    q.answer,
                    q.after,
                    q.english,
                    json.dumps(list(q.wrong), ensure_ascii=False),
                    q.hint,
                )
                for q in questions
            ],
        )


def drill_stock(conn: sqlite3.Connection, point_id: str) -> int:
    return int(
        conn.execute(
            "SELECT COUNT(*) FROM drill_questions WHERE point_id = ?", (point_id,)
        ).fetchone()[0]
    )


def drill_batches_since(conn: sqlite3.Connection, point_id: str, since: datetime) -> int:
    return int(
        conn.execute(
            "SELECT COUNT(*) FROM drill_batches WHERE point_id = ? AND created_at >= ?",
            (point_id, since.isoformat()),
        ).fetchone()[0]
    )


def take_drill_questions(
    conn: sqlite3.Connection, point_id: str, count: int, now: datetime
) -> list[StoredGap]:
    """Up to `count` of a point's questions, never served or served longest ago first, marked
    served now, so a drill after it gets the next ones."""
    rows = conn.execute(
        "SELECT id, point_id, before, answer, after, english, wrong, hint FROM drill_questions"
        " WHERE point_id = ? ORDER BY served_at IS NOT NULL, served_at, id LIMIT ?",
        (point_id, count),
    ).fetchall()
    with conn:
        conn.executemany(
            "UPDATE drill_questions SET served_at = ? WHERE id = ?",
            [(now.isoformat(), r[0]) for r in rows],
        )
    return [
        StoredGap(r[0], r[1], r[2], r[3], r[4], r[5], tuple(json.loads(r[6])), r[7]) for r in rows
    ]


def drill_spending(conn: sqlite3.Connection, since: datetime) -> dict[Code, tuple[int, float]]:
    """Each language with drill questions written since `since`: how many batches, and their cost."""
    return {
        language: (count, cost)
        for language, count, cost in conn.execute(
            "SELECT language, COUNT(*), SUM(cost_usd) FROM drill_batches WHERE created_at >= ?"
            " GROUP BY language ORDER BY SUM(cost_usd) DESC",
            (since.isoformat(),),
        )
    }


# ==== The vocabulary check ====


def save_vocab_batch(
    conn: sqlite3.Connection,
    language: Code,
    items: list[Any],
    asked: int,
    now: datetime,
    cost_usd: float,
) -> None:
    """A batch Claude glossed for a language: its cost, and the words that passed
    (vocab_check.VocabItem)."""
    with conn:
        batch = conn.execute(
            "INSERT INTO vocab_batches (language, asked, kept, created_at, cost_usd)"
            " VALUES (?, ?, ?, ?, ?)",
            (language, asked, len(items), now.isoformat(), cost_usd),
        ).lastrowid
        conn.executemany(
            "INSERT OR REPLACE INTO vocab_items (language, lemma, rank, meaning, wrong, batch_id)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            [
                (
                    language,
                    i.lemma,
                    i.rank,
                    i.meaning,
                    json.dumps(list(i.wrong), ensure_ascii=False),
                    batch,
                )
                for i in items
            ],
        )


def vocab_items(conn: sqlite3.Connection, language: Code) -> list[tuple[str, int, str, list[str]]]:
    """A language's glossed words as (lemma, rank, meaning, wrong choices), most common first."""
    return [
        (lemma, rank, meaning, json.loads(wrong))
        for lemma, rank, meaning, wrong in conn.execute(
            "SELECT lemma, rank, meaning, wrong FROM vocab_items WHERE language = ? ORDER BY rank",
            (language,),
        )
    ]


def save_meaning_batch(
    conn: sqlite3.Connection,
    language: Code,
    meanings: dict[str, str],
    now: datetime,
    cost_usd: float,
) -> None:
    """A batch of words Claude glossed for a language, as {lower-case word: meaning}, with its cost.
    A word it gave no usable meaning for is kept with an empty one, so it isn't asked again."""
    with conn:
        batch = conn.execute(
            "INSERT INTO meaning_batches (language, asked, kept, created_at, cost_usd)"
            " VALUES (?, ?, ?, ?, ?)",
            (
                language,
                len(meanings),
                sum(1 for m in meanings.values() if m),
                now.isoformat(),
                cost_usd,
            ),
        ).lastrowid
        conn.executemany(
            "INSERT OR IGNORE INTO word_meanings (language, word, meaning, batch_id)"
            " VALUES (?, ?, ?, ?)",
            [(language, word, meaning, batch) for word, meaning in meanings.items()],
        )


def word_meanings(conn: sqlite3.Connection, language: Code) -> dict[str, str]:
    """Every word of a language that has been asked about, as {lower-case word: meaning}."""
    return dict(
        conn.execute(
            "SELECT word, meaning FROM word_meanings WHERE language = ?", (language,)
        ).fetchall()
    )


def meaning_spending(conn: sqlite3.Connection, since: datetime) -> dict[Code, tuple[int, float]]:
    """Each language with word meanings written since `since`: batches and their cost."""
    return {
        language: (count, cost)
        for language, count, cost in conn.execute(
            "SELECT language, COUNT(*), SUM(cost_usd) FROM meaning_batches WHERE created_at >= ?"
            " GROUP BY language ORDER BY SUM(cost_usd) DESC",
            (since.isoformat(),),
        )
    }


def vocab_asked(conn: sqlite3.Connection, language: Code) -> int:
    """How many words Claude has been asked to gloss for a language, passed or not, in batches
    that were kept. A first write that left a band short kept nothing (vocab_check.write_bank), so
    its words count as never asked: they're asked again, and a bank that later gains a band is
    still topped up. A batch was kept when it kept a word, or when the bank already had words (a
    top-up keeps what passes, even nothing)."""
    row = conn.execute(
        """SELECT SUM(asked) FROM vocab_batches b WHERE language = ? AND (kept > 0 OR EXISTS
               (SELECT 1 FROM vocab_items i WHERE i.language = b.language AND i.batch_id < b.id))""",
        (language,),
    ).fetchone()
    return int(row[0] or 0)


def vocab_spending(conn: sqlite3.Connection, since: datetime) -> dict[Code, tuple[int, float]]:
    """Each language with vocabulary check words written since `since`: batches and their cost."""
    return {
        language: (count, cost)
        for language, count, cost in conn.execute(
            "SELECT language, COUNT(*), SUM(cost_usd) FROM vocab_batches WHERE created_at >= ?"
            " GROUP BY language ORDER BY SUM(cost_usd) DESC",
            (since.isoformat(),),
        )
    }


# ==== The note queue ====


@dataclass(frozen=True)
class QueuedNote:
    id: int
    language: Code
    deck: str
    entry: str
    meaning: str  # the owner's own, empty when they left it to Claude
    state: str  # "waiting", "ready" or "failed"
    fields: dict[str, str]  # what Claude wrote and passed the checks, by Anki field name
    error: str
    attempts: int
    tried_at: datetime | None


_QUEUE_COLUMNS = "id, language, deck, entry, meaning, state, fields, error, attempts, tried_at"


def _queued(row: tuple[Any, ...]) -> QueuedNote:
    return QueuedNote(
        row[0],
        row[1],
        row[2],
        row[3],
        row[4],
        row[5],
        json.loads(row[6]),
        row[7],
        row[8],
        datetime.fromisoformat(row[9]) if row[9] else None,
    )


def add_queued(
    conn: sqlite3.Connection,
    language: Code,
    deck: str,
    entries: list[tuple[str, str]],
    now: datetime,
) -> list[int]:
    """Words to be filled in, as (entry, the owner's own meaning or ""), in the order given."""
    ids: list[int] = []
    with conn:
        for entry, meaning in entries:
            cursor = conn.execute(
                "INSERT INTO note_queue (language, deck, entry, meaning, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (language, deck, entry, meaning, now.isoformat()),
            )
            assert cursor.lastrowid is not None
            ids.append(cursor.lastrowid)
    return ids


def queued_notes(conn: sqlite3.Connection) -> list[QueuedNote]:
    """Every queued word, oldest first."""
    return [
        _queued(row) for row in conn.execute(f"SELECT {_QUEUE_COLUMNS} FROM note_queue ORDER BY id")
    ]


def queued_note(conn: sqlite3.Connection, note_id: int) -> QueuedNote | None:
    row = conn.execute(
        f"SELECT {_QUEUE_COLUMNS} FROM note_queue WHERE id = ?", (note_id,)
    ).fetchone()
    return _queued(row) if row else None


def delete_queued(conn: sqlite3.Connection, note_id: int) -> bool:
    """Takes a word off the queue (saved or removed). What filling it cost moves to `call_costs`,
    dated when it was last tried, so `queue_spending` still counts it."""
    with conn:
        conn.execute(
            "INSERT INTO call_costs (feature, language, created_at, cost_usd)"
            " SELECT 'note_queue', language, tried_at, cost_usd FROM note_queue"
            " WHERE id = ? AND tried_at IS NOT NULL",
            (note_id,),
        )
        return conn.execute("DELETE FROM note_queue WHERE id = ?", (note_id,)).rowcount > 0


def retry_queued(conn: sqlite3.Connection, note_id: int) -> bool:
    """Puts a failed word back to waiting, with its attempts counted afresh."""
    with conn:
        return (
            conn.execute(
                "UPDATE note_queue SET state = 'waiting', error = '', attempts = 0"
                " WHERE id = ? AND state = 'failed'",
                (note_id,),
            ).rowcount
            > 0
        )


def save_queue_result(
    conn: sqlite3.Connection,
    note_id: int,
    language: Code,
    fields: dict[str, str] | None,
    error: str,
    now: datetime,
    cost_usd: float,
) -> None:
    """What came of one word's turn: its filled fields (ready), or why not (failed). A word still waiting
    or failed only: one the owner removed meanwhile is gone, and a ready one stays as it is. The
    turn's cost is kept either way: in `call_costs` when the word is no longer waiting for it."""
    with conn:
        updated = conn.execute(
            "UPDATE note_queue SET state = ?, fields = ?, error = ?, attempts = attempts + 1,"
            " tried_at = ?, cost_usd = cost_usd + ? WHERE id = ? AND state IN ('waiting', 'failed')",
            (
                "ready" if fields is not None else "failed",
                json.dumps(fields or {}, ensure_ascii=False),
                "" if fields is not None else error,
                now.isoformat(),
                cost_usd,
                note_id,
            ),
        ).rowcount
        if not updated and cost_usd:
            conn.execute(
                "INSERT INTO call_costs (feature, language, created_at, cost_usd)"
                " VALUES ('note_queue', ?, ?, ?)",
                (language, now.isoformat(), cost_usd),
            )


def queue_spending(conn: sqlite3.Connection, since: datetime) -> dict[Code, tuple[int, float]]:
    """Each language with words filled in since `since`: how many were tried and what they cost,
    words since taken off the queue (saved or removed) included, from `call_costs`."""
    return {
        language: (count, cost)
        for language, count, cost in conn.execute(
            """SELECT language, COUNT(*), SUM(cost_usd) FROM (
                   SELECT language, tried_at AS at, cost_usd FROM note_queue WHERE tried_at IS NOT NULL
                   UNION ALL SELECT language, created_at, cost_usd FROM call_costs
                       WHERE feature = 'note_queue'
               ) WHERE at >= ? GROUP BY language ORDER BY SUM(cost_usd) DESC""",
            (since.isoformat(),),
        )
    }
