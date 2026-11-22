"""Figures over time: progress, the stretch words' exposure effect, and what Claude and Azure cost."""

from dataclasses import asdict
from datetime import UTC, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query

from franki_reader import (
    exposure_effect,
    store,
)
from franki_reader.gateway import AnkiUnavailable
from franki_reader.languages import LANGUAGES
from franki_reader.routes.context import AppContext
from franki_reader.routes.views import instant
from franki_reader.tts import azure_usd

# The window the progress summary covers: the Milestone 1 exit check's two weeks.
PROGRESS_DAYS = 14
# The window the time in each language covers (GET /api/input-time).
INPUT_DAYS = 7


def _spent(s: store.Spending) -> dict[str, Any]:
    """/api/costs's figures for one language or the total. Per read text divides everything spent
    (dropped and unread texts too) by the texts actually read: what each one really cost."""
    total = s.cost_usd + azure_usd(s.audio_chars)
    return {
        "texts": s.texts,
        "read": s.read,
        "waiting": s.waiting,
        "dropped": s.dropped,
        "skipped": s.skipped,
        "attempts_per_text": round(s.attempts / s.texts, 2) if s.texts else None,
        "cost_usd": round(s.cost_usd, 4),
        "per_text_usd": round(s.cost_usd / s.texts, 4) if s.texts else None,
        "per_read_text_usd": round(s.cost_usd / s.read, 4) if s.read else None,
        # Azure's audio, estimated from the characters it spoke (tts.AZURE_USD_PER_MILLION_CHARS),
        # and Claude and Azure together. The three above stay Claude's alone.
        "audio_chars": s.audio_chars,
        "azure_usd": round(azure_usd(s.audio_chars), 4),
        "total_usd": round(total, 4),
        "total_per_text_usd": round(total / s.texts, 4) if s.texts else None,
        "total_per_read_text_usd": round(total / s.read, 4) if s.read else None,
    }


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine
    read_reviews = ctx.read_reviews

    @routes.get("/api/progress", dependencies=authed)
    async def progress() -> dict[str, Any]:
        language = engine.language()
        since = engine.clock() - timedelta(days=PROGRESS_DAYS)
        done = store.progress(engine.conn, since, language)
        difficulty = store.load_difficulty(engine.conn, language)
        return {
            "days": PROGRESS_DAYS,
            "finished": done.finished,
            "median_coverage": done.median_coverage,
            "ratings": done.ratings,
            # The check after reading, over the finished texts it was taken with.
            "check": {"texts": done.checked, "right": done.check_right, "asked": done.check_asked},
            # How well the words counted as known were recognized (recognition.py), over the
            # finished texts that kept it; null when none did.
            "recognition": None
            if done.recognition is None
            else {
                "texts": done.recognition_texts,
                "verified": done.recognition.verified,
                "effective": done.recognition.effective,
                "known_types": done.recognition.known_types,
                "looked_up_types": done.recognition.looked_up_types,
            },
            "next": {"floor": difficulty.floor, "stretch": difficulty.stretch},
        }

    @routes.get("/api/input-time", dependencies=authed)
    async def input_time() -> dict[str, Any]:
        """Time spent reading and listening in each language over the last week, most first, for
        the home's This week card. It reports only: it sets no goal and nothing reads it."""
        since = engine.clock() - timedelta(days=INPUT_DAYS)
        rows = sorted(
            store.input_time(engine.conn, since),
            key=lambda t: (
                (-(t.reading_seconds + t.listening_seconds), LANGUAGES[t.language].name)
                if t.language in LANGUAGES
                else (0, t.language)
            ),
        )
        return {
            "days": INPUT_DAYS,
            "languages": [
                {
                    "language": t.language,
                    "reading_seconds": t.reading_seconds,
                    "listening_seconds": t.listening_seconds,
                    "last_read_at": instant(t.last_read_at) if t.last_read_at else None,
                }
                for t in rows
                if t.language in LANGUAGES
            ],
        }

    @routes.get("/api/exposure-effect", dependencies=authed)
    async def stretch_exposure_effect(
        days: Annotated[int, Query(ge=7, le=3650)] = 90,
    ) -> dict[str, Any]:
        """Whether stretch words were remembered better at their next review than similar words
        that weren't (exposure_effect.py): an association from the log, not a controlled test."""
        if read_reviews is None:
            raise HTTPException(
                503,
                "The server can't read Anki: ANKI_SYNC_ENDPOINT, ANKI_USER and ANKI_PASSWORD "
                "aren't all set.",
            )
        code = engine.language()
        try:
            reviews = await read_reviews(LANGUAGES[code])
        except AnkiUnavailable as e:
            raise HTTPException(503, f"Couldn't read Anki. {e}") from e
        since = engine.clock() - timedelta(days=days)
        by_text: dict[str, set[int]] = {}
        for entry in engine.entries(code):
            by_text.setdefault(entry.text, set()).add(entry.note_id)
        note_ids = {text: next(iter(ids)) for text, ids in by_text.items() if len(ids) == 1}
        readings = store.stretch_readings(engine.conn, since, code)
        exposures = exposure_effect.exposures_of(
            [(int(at.replace(tzinfo=UTC).timestamp() * 1000), words) for at, words in readings],
            note_ids,
        )
        effect = exposure_effect.compare(
            reviews, exposures, int(since.replace(tzinfo=UTC).timestamp() * 1000)
        )
        return {"days": days, "texts": len(readings), **asdict(effect)}

    @routes.get("/api/costs", dependencies=authed)
    async def costs(days: Annotated[int, Query(ge=1, le=3650)] = 30) -> dict[str, Any]:
        since = engine.clock() - timedelta(days=days)
        by_language = store.spending(engine.conn, since)
        explained = store.explanation_spending(engine.conn, since)
        drilled = store.drill_spending(engine.conn, since)
        topic_writes = store.grammar_topic_spending(engine.conn, since)
        topic_images = store.topic_image_spending(engine.conn, since)
        vocab = store.vocab_spending(engine.conn, since)
        queued = store.queue_spending(engine.conn, since)
        glossed = store.meaning_spending(engine.conn, since)
        hinted = store.mnemonic_spending(engine.conn, since)
        questioned = store.question_spending(engine.conn, since)
        formed = store.form_spending(engine.conn, since)
        produced = store.production_spending(engine.conn, since)
        sentenced = store.sentence_spending(engine.conn, since)
        situated, situated_chars = store.situation_spending(engine.conn, since)
        lessoned, lessoned_chars = store.lesson_spending(engine.conn, since)
        lesson_topics = store.lesson_topic_spending(engine.conn, since)
        cram_themes = store.cram_theme_spending(engine.conn, since)
        ipa_written = store.ipa_spending(engine.conn, since)
        recorded, recorded_chars = store.recording_spending(engine.conn, since)
        others = store.other_call_spending(engine.conn, since)
        rows = by_language.values()
        total = store.Spending(
            sum(r.read for r in rows),
            sum(r.waiting for r in rows),
            sum(r.dropped for r in rows),
            sum(r.attempts for r in rows),
            sum(r.cost_usd for r in rows),
            sum(r.skipped for r in rows),
            sum(r.audio_chars for r in rows),
        )
        return {
            "days": days,
            "since": instant(since),
            "languages": [
                {"language": code, "name": LANGUAGES[code].name, **_spent(r)}
                for code, r in by_language.items()
            ],
            "total": _spent(total),
            # Explain's calls (lines and phrases) and the naturalness check, failed calls included,
            # apart from the texts above (they aren't in per_text_usd).
            "explanations": {
                "asked": sum(n for n, _ in explained.values()),
                "cost_usd": round(sum(c for _, c in explained.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "asked": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in explained.items()
                ],
            },
            # Grammar drills' questions, written a batch at a time (drills.py).
            # Your topics (grammar_topics.py): a page, new examples or a rewrite is one write,
            # failed ones included.
            "topics": {
                "writes": sum(n for n, _ in topic_writes.values()),
                "cost_usd": round(sum(c for _, c in topic_writes.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "writes": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in topic_writes.items()
                ],
            },
            # Images read for a topic's title (topic_image.py), failed calls included.
            "topic_images": {
                "read": sum(n for n, _ in topic_images.values()),
                "cost_usd": round(sum(c for _, c in topic_images.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "read": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in topic_images.items()
                ],
            },
            "drills": {
                "batches": sum(n for n, _ in drilled.values()),
                "cost_usd": round(sum(c for _, c in drilled.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "batches": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in drilled.items()
                ],
            },
            # Meanings for words in texts that nothing else glosses, a batch at a time (meanings.py).
            "meanings": {
                "batches": sum(n for n, _ in glossed.values()),
                "cost_usd": round(sum(c for _, c in glossed.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "batches": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in glossed.items()
                ],
            },
            # IPA written for words Wiktionary's tables have none for, a batch at a time (ai_ipa.py).
            "ipa": {
                "batches": sum(n for n, _ in ipa_written.values()),
                "cost_usd": round(sum(c for _, c in ipa_written.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "batches": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in ipa_written.items()
                ],
            },
            # The vocabulary check's words, glossed once a language (vocab_check.py).
            "vocab_checks": {
                "batches": sum(n for n, _ in vocab.values()),
                "cost_usd": round(sum(c for _, c in vocab.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "batches": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in vocab.items()
                ],
            },
            # Words the owner queued in the app, filled in by Claude (note_queue.py).
            "note_queue": {
                "notes": sum(n for n, _ in queued.values()),
                "cost_usd": round(sum(c for _, c in queued.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "notes": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in queued.items()
                ],
            },
            # Memory hints for a word the owner keeps forgetting (mnemonics.py), failed calls included.
            "mnemonics": {
                "asked": sum(n for n, _ in hinted.values()),
                "cost_usd": round(sum(c for _, c in hinted.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "asked": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in hinted.items()
                ],
            },
            # Questions for the check after reading, one call per text (comprehension.py), failed
            # calls included.
            "questions": {
                "asked": sum(n for n, _ in questioned.values()),
                "cost_usd": round(sum(c for _, c in questioned.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "asked": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in questioned.items()
                ],
            },
            # The grammatical form picked for a text's inflected words, one call per text (forms.py),
            # failed calls included.
            "forms": {
                "asked": sum(n for n, _ in formed.values()),
                "cost_usd": round(sum(c for _, c in formed.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "asked": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in formed.items()
                ],
            },
            # The owner's own writing checked (production.py): Use today's words, Check mine and
            # Retell it, one call each, failed calls included.
            "production": {
                "asked": sum(n for n, _ in produced.values()),
                "cost_usd": round(sum(c for _, c in produced.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "asked": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in produced.items()
                ],
            },
            # Sentences to say, written a batch at a time (sentences.py).
            "sentences": {
                "batches": sum(n for n, _ in sentenced.values()),
                "cost_usd": round(sum(c for _, c in sentenced.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "batches": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in sentenced.items()
                ],
            },
            # Situations (situations.py): a call a turn, and one for the feedback at the end, failed
            # calls included, plus Azure's estimate for the other person's lines.
            "situations": {
                "asked": sum(n for n, _ in situated.values()),
                "cost_usd": round(sum(c for _, c in situated.values()), 4),
                "audio_chars": situated_chars,
                "azure_usd": round(azure_usd(situated_chars), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "asked": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in situated.items()
                ],
            },
            # Audio lessons (lesson.py): Claude writes one, Azure speaks it; failed ones included.
            "lessons": {
                "made": sum(n for n, _ in lessoned.values()),
                "cost_usd": round(sum(c for _, c in lessoned.values()), 4),
                "audio_chars": lessoned_chars,
                "azure_usd": round(azure_usd(lessoned_chars), 4),
            },
            # Scene ideas suggested for a lesson (lesson_topics.py), failed calls included. Kept apart
            # from `lessons`, whose count is lessons made.
            "lesson_topics": {
                "asked": sum(n for n, _ in lesson_topics.values()),
                "cost_usd": round(sum(c for _, c in lesson_topics.values()), 4),
            },
            # Themes suggested for a cram (cram_themes.py), failed calls included.
            "cram_themes": {
                "asked": sum(n for n, _ in cram_themes.values()),
                "cost_usd": round(sum(c for _, c in cram_themes.values()), 4),
            },
            # Every other Claude call (asking about a card, fixing one, verb aspect, a lesson's
            # words, rare words, looking a word up...), failed ones included, by feature
            # (`store.REPORTED_FEATURES`), so a call with no section above is still counted.
            "other_calls": {
                "asked": sum(n for n, _ in others.values()),
                "cost_usd": round(sum(c for _, c in others.values()), 4),
                "features": [
                    {"feature": feature, "asked": n, "cost_usd": round(c, 4)}
                    for feature, (n, c) in others.items()
                ],
            },
            # Cards recorded by an Azure voice in the app (POST /api/speech): Azure's alone, an
            # estimate like the texts' audio. Not per language: the app doesn't say which.
            "recordings": {
                "recordings": recorded,
                "audio_chars": recorded_chars,
                "azure_usd": round(azure_usd(recorded_chars), 4),
            },
        }

    return routes
