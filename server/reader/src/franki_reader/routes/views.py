"""How a text, a topic and the shelf are sent to the app, shared by the routes that send them."""

from datetime import UTC, datetime
from typing import Any

from franki_reader import (
    exposure,
    store,
    timing,
    xray,
)
from franki_reader.engine import Engine, Job
from franki_reader.generator import (
    SEASON_EPISODES,
    StoryContext,
)
from franki_reader.languages import (
    HIDDEN_LANGUAGES,
    LANGUAGES,
    Code,
)
from franki_reader.reader import (
    render,
    render_line,
)
from franki_reader.store import StoredText, Story


def instant(at: datetime) -> str:
    """A time the app reads, with its UTC offset. The server's clock and its stored times are naive
    UTC (`engine.utc_now`, whatever `TZ` says); without the offset the app read them as the phone's
    local time, hours off, so "today" and a date could land on the wrong day. An aware time keeps
    its own offset. Every time in a response goes through this."""
    return (at if at.tzinfo else at.replace(tzinfo=UTC)).isoformat()


def seen_json(e: exposure.Exposure) -> dict[str, Any]:
    last = instant(e.last_seen) if e.last_seen is not None else None
    return {"texts": e.texts, "uses": e.uses, "last": last}


def rendered_text(text: StoredText, engine: Engine) -> dict[str, Any]:
    entries, lexicon = engine.snapshot(text.language)
    out = render(
        text,
        lexicon,
        engine.meanings(text.language),
        {e.text: e.translit for e in entries if e.translit},
        # Not set as the owner's choices stand now, so a point marked since isn't still explained
        # as unmarked.
        unset=exposure.unset_points(store.load_grammar(engine.conn), text.language),
        ai_ipa=engine.ai_ipa(text.language),
        deck_registers={e.text: e.register for e in entries if e.register},
    )
    speaks = engine.audio is not None and engine.synthesize is not None
    for i, line in enumerate(out["lines"]):
        line["audio"] = speaks or engine.has_audio(text.id, i)
        timing.add_times(line["words"], engine.audio.marks(text.id, i) if engine.audio else None)
    topic = store.get_topic(engine.conn, text.topic_id, text.language, include_removed=True)
    story = store.get_story(engine.conn, text.story_id) if text.story_id else None
    # What the reader shows under the title.
    out["topic"] = (story.title or "Your story") if story else (topic.name if topic else "")
    out["reason"] = text.reason
    out["episode"] = text.episode
    # Which story an episode is from, so the reader can wait for that story's next one.
    out["story_id"] = text.story_id
    if story:
        # X-Ray: the characters as of this episode, with whether each turns up in it; a name in
        # the lines is tagged with its character so a tap can open its card.
        shown = xray.visible(story.characters, text.episode)
        here = xray.tag_names(out["lines"], shown)
        out["xray"] = [{**c, "here": c["name"] in here} for c in shown]
    if story and text.episode > 1:
        # What happened in the episode before, shown above the text so it isn't retold in it.
        before = [t for t in store.episodes(engine.conn, story.id) if t.episode == text.episode - 1]
        if before and (before[-1].recap or before[-1].recap_line):
            out["last_time"] = {"recap": before[-1].recap, "line": recap_json(before[-1], engine)}
    return out


def practice_words(text: StoredText, engine: Engine) -> list[dict[str, Any]]:
    """The text's practice words as the reader draws them (meaning, dictionary form, status), in
    the order of `text.stretch`, so a card can open a word's popover without fetching the whole text.
    A practice word that doesn't turn up as a word of the text is left out."""
    entries, lexicon = engine.snapshot(text.language)
    out = render(
        text,
        lexicon,
        engine.meanings(text.language),
        {e.text: e.translit for e in entries if e.translit},
        ai_ipa=engine.ai_ipa(text.language),
        deck_registers={e.text: e.register for e in entries if e.register},
    )
    first: dict[str, dict[str, Any]] = {}
    for line in out["lines"]:
        for word in line["words"]:
            if word["status"] is not None:
                first.setdefault(word["text"], word)
    return [first[w] for w in text.stretch if w in first]


def shelf_text(text: StoredText, engine: Engine, practice: bool = False) -> dict[str, Any]:
    """A text on the shelf as a card shows it, without its words (they come with /api/texts/{id}).
    `practice` adds its practice words' meanings, for the card that lists them."""
    topic = store.get_topic(engine.conn, text.topic_id, text.language, include_removed=True)
    return {
        **({"practice": practice_words(text, engine)} if practice else {}),
        "id": text.id,
        "title": text.title,
        "title_english": text.title_english,
        "topic": topic.name if topic else "",
        "topic_id": text.topic_id,
        "form": text.form,
        "lines": len(text.lines),
        "stretch": list(text.stretch),
        "reason": text.reason,
        "coverage": text.coverage,
        "episode": text.episode,
        "model": text.model,
        "created_at": instant(text.created_at) if text.created_at else None,
    }


def recap_json(text: StoredText, engine: Engine) -> dict[str, Any] | None:
    """An episode's recap in its own language, split and glossed as a choice is, or None when it
    has none (written before the recap was asked for in the story's language)."""
    if not text.recap_line:
        return None
    entries, lexicon = engine.snapshot(text.language)
    deck_translits = {e.text: e.translit for e in entries if e.translit}
    words = render_line(
        text.recap_line,
        text,
        lexicon,
        engine.meanings(text.language),
        deck_translits,
        ai_ipa=engine.ai_ipa(text.language),
    )
    return {"english": text.recap_english, "words": words}


def story_json(
    engine: Engine, story: Story, writing: list[Job], card: bool = True
) -> dict[str, Any]:
    """A story as the shelf's card shows it, or with `card` False as the Stories list does (no
    recap or practice words, which only the card shows)."""
    told = store.episodes(engine.conn, story.id)
    read = [t for t in told if store.text_status(engine.conn, t.id) == "read"]
    waiting = store.waiting_episode(engine.conn, story.id)
    # Where the episode the card shows (the waiting one, else the next to be written) falls
    # in its season, so the app doesn't repeat how long a season is.
    place = StoryContext(episode=waiting.episode if waiting else len(read) + 1)
    return {
        "id": story.id,
        "title": story.title,
        "about": story.about,
        "read": len(read),
        "season": place.season,
        "season_episode": place.season_episode,
        "season_length": SEASON_EPISODES,
        # X-Ray, as of the last episode read, so the card shows nothing the reader hasn't reached.
        "xray": xray.visible(story.characters, max(t.episode for t in read)) if read else [],
        "last_recap": read[-1].recap if read and card else "",
        # The same in the story's language, as the reader's words, with that line's English;
        # null for an episode written before it was asked for.
        "last_recap_line": recap_json(read[-1], engine) if read and card else None,
        "next": shelf_text(waiting, engine, practice=card) if waiting else None,
        "writing": any(j.story_id == story.id for j in writing),
        "stage": next((engine.stage_of(j) for j in writing if j.story_id == story.id), None),
        "failed": engine.failure(story.topic_id, story.language),
    }


def listed_story_json(engine: Engine, story: Story, card: bool = False) -> dict[str, Any]:
    """A story with whether it's running and whether it's the one on the shelf's card."""
    pinned = store.pinned_story(engine.conn, story.language)
    return {
        **story_json(engine, story, engine.writing(story.language), card=card),
        "running": story.active,
        "pinned": pinned is not None and story.id == pinned.id,
    }


def stories_json(engine: Engine) -> dict[str, Any]:
    """The reader's language's stories for the Stories list: running first, then ended."""
    language = engine.language()
    return {
        "language": language,
        "stories": [listed_story_json(engine, s) for s in store.stories(engine.conn, language)],
    }


def shelf_json(engine: Engine, language: Code | None = None) -> dict[str, Any]:
    """The shelf of `language`, the reader's own language when none is given."""
    language = language or engine.language()
    writing = engine.writing(language)
    story = store.pinned_story(engine.conn, language)
    story_out = story_json(engine, story, writing) if story is not None else None
    counts = store.ready_counts(engine.conn)
    return {
        "language": language,
        "languages": [
            {"code": code, "name": info.name, "ready": counts.get(code, 0)}
            for code, info in LANGUAGES.items()
            if code not in HIDDEN_LANGUAGES
        ],
        "texts": [shelf_text(t, engine) for t in store.shelf_texts(engine.conn, language)],
        "writing": [
            {
                "topic": store.topic_name(engine.conn, j.topic_id),
                "reason": j.reason,
                "form": j.form or "dialogue",
                "stage": engine.stage_of(j),
            }
            for j in writing
            if j.story_id is None
        ],
        "story": story_out,
    }
