"""Grammar points and the choices on them, drills, the forms a word can be marked as, and the
text difficulty."""

import random
from dataclasses import replace
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel, Field

from franki_reader import (
    drills,
    exposure,
    form_primers,
    grammar,
    store,
)
from franki_reader.difficulty import EASIER_FLOOR, HARDER_FLOOR, STANDARD_FLOOR
from franki_reader.languages import (
    LANGUAGES,
    Code,
)
from franki_reader.routes.context import AppContext
from franki_reader.routes.views import seen_json


class GrammarChoice(BaseModel):
    state: Literal["practice", "avoid", "normal"]


class GrammarLevelIn(BaseModel):
    through: int = Field(ge=1, le=5)  # 5 is N5 (the easiest) up to 1 for N1


class GrammarStretchIn(BaseModel):
    uses: int = Field(ge=grammar.MIN_UNSET_USES, le=grammar.MAX_UNSET_USES)


class DrillsIn(BaseModel):
    points: list[str]
    count: int = Field(default=10, ge=1, le=drills.MAX_DRILL)


class DifficultyIn(BaseModel):
    level: Literal["harder", "standard", "easier"]


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine
    write_drills = ctx.write_drills
    # Points whose drill questions are being written, shared by every request (drills.top_up).
    drills_writing: set[str] = set()

    def grammar_points() -> dict[str, Any]:
        language = engine.language()
        choices = store.load_grammar(engine.conn)
        seen = engine.grammar_exposure(language)
        return {
            "max_practice": grammar.MAX_PRACTICE,
            # The known points the next texts are asked to work in, least seen first.
            "least": list(engine.review_points(language)),
            "stretch": {
                "uses": store.load_difficulty(engine.conn, language).unset_uses,
                # What to suggest practicing when the dial goes up, null when every point is
                # practiced or known.
                "next": (
                    {"id": nxt.id, "name": nxt.name}
                    if (nxt := grammar.next_to_learn(language, choices))
                    else None
                ),
            },
            "points": [
                {
                    "id": p.id,
                    "name": p.name,
                    "note": p.note,
                    "example": p.example,
                    "state": choices.get(p.id, "unset"),
                    "seen": seen_json(seen[p.id]),
                    # The JLPT level, 5 for N5 up to 1 for N1; left out for a language with none.
                    **({"jlpt": p.jlpt} if p.jlpt else {}),
                }
                for p in grammar.points_for(language)
            ],
        }

    @routes.get("/api/grammar", dependencies=authed)
    async def get_grammar() -> dict[str, Any]:
        return grammar_points()

    @routes.get("/api/grammar/choices", dependencies=authed)
    async def get_grammar_choices() -> dict[str, Any]:
        # Every language's, not just the one being read: Forms practice asks for the deck's.
        choices = store.load_grammar(engine.conn)
        return {"choices": {pid: state for pid, state in choices.items() if pid in grammar.POINTS}}

    async def top_up_drills(point_ids: tuple[str, ...]) -> None:
        if write_drills is not None:
            await drills.top_up(
                engine.conn, engine.snapshot, write_drills, point_ids, engine.clock, drills_writing
            )

    @routes.post("/api/drills", dependencies=authed)
    async def drill(body: DrillsIn, background: BackgroundTasks) -> dict[str, Any]:
        points = tuple(dict.fromkeys(body.points))
        questions = drills.serve(
            engine.conn, engine.snapshot, points, body.count, engine.clock(), engine.rng
        )
        # A word_named point's rivals supply some of its questions, so their stock is written too.
        background.add_task(top_up_drills, drills.with_rivals(points))
        asked = {q.get("for", q["point"]) for q in questions}
        return {
            "questions": questions,
            # Points that got no question: not in this server's catalog, or nothing read and no
            # questions written yet (being written now when Claude is set up).
            "missing": [p for p in points if p not in asked],
            "writing": write_drills is not None,
        }

    @routes.get("/api/forms", dependencies=authed)
    async def get_forms(language: Code) -> dict[str, Any]:
        """The primers for a language's word forms (the chip on a word's popup opens one). Static:
        nothing here asks Claude."""
        return {"forms": list(form_primers.primers(language))}

    @routes.get("/api/grammar/{point_id}", dependencies=authed)
    async def get_grammar_point(
        point_id: str,
        examples: Annotated[int, Query(ge=1, le=6)] = exposure.EXAMPLES,
        shuffle: int | None = None,
    ) -> dict[str, Any]:
        # After /api/grammar/choices, so "choices" isn't taken for a point's id.
        point = grammar.POINTS.get(point_id)
        if point is None:
            raise HTTPException(404, "No such grammar point.")
        choices = store.load_grammar(engine.conn)
        _, lexicon = engine.snapshot(point.language)
        return {
            "id": point.id,
            "state": choices.get(point.id, "unset"),
            "max_practice": grammar.MAX_PRACTICE,
            "seen": seen_json(engine.grammar_exposure(point.language)[point.id]),
            "choices": {
                p.id: choices.get(p.id, "unset") for p in grammar.points_for(point.language)
            },
            "examples": [
                {
                    "text_id": e.text_id,
                    "title": e.title,
                    "line": e.line,
                    "english": e.english,
                    "words": list(e.words),
                }
                for e in exposure.examples(
                    engine.conn,
                    lexicon,
                    point.id,
                    examples,
                    None if shuffle is None else random.Random(shuffle),
                )
            ],
        }

    # Before /api/grammar/{point_id}, which would take "stretch" for a point.
    @routes.put("/api/grammar/stretch", dependencies=authed)
    async def set_grammar_stretch(body: GrammarStretchIn) -> dict[str, Any]:
        language = engine.language()
        current = store.load_difficulty(engine.conn, language)
        store.save_difficulty(engine.conn, replace(current, unset_uses=body.uses), language)
        return grammar_points()

    @routes.put("/api/difficulty", dependencies=authed)
    async def set_difficulty(body: DifficultyIn) -> dict[str, Any]:
        """Text difficulty for the current language (Settings: Harder 93%, Standard 95% or Easier
        97% known words), from the next text written. Answers as `next` in GET /api/progress does."""
        language = engine.language()
        current = store.load_difficulty(engine.conn, language)
        floor = {"harder": HARDER_FLOOR, "standard": STANDARD_FLOOR, "easier": EASIER_FLOOR}[
            body.level
        ]
        changed = replace(current, floor=floor)
        store.save_difficulty(engine.conn, changed, language)
        return {"floor": changed.floor, "stretch": changed.stretch}

    # Before /api/grammar/{point_id}, which would take "level" for a point.
    @routes.put("/api/grammar/level", dependencies=authed)
    async def set_grammar_level(body: GrammarLevelIn) -> dict[str, Any]:
        language = engine.language()
        changes = grammar.level_choices(language, body.through, store.load_grammar(engine.conn))
        if not changes:
            raise HTTPException(422, f"{LANGUAGES[language].name} has no JLPT levels.")
        store.set_grammar_many(engine.conn, changes)
        return grammar_points()

    @routes.put("/api/grammar/{point_id}", dependencies=authed)
    async def choose_grammar(
        point_id: str, body: GrammarChoice, background: BackgroundTasks
    ) -> dict[str, Any]:
        point = grammar.POINTS.get(point_id)
        if point is None:
            raise HTTPException(404, "No such grammar point.")
        choices = store.load_grammar(engine.conn)
        practiced = [
            pid
            for pid, state in choices.items()
            if state == "practice"
            and pid != point_id
            and pid in grammar.POINTS
            and grammar.POINTS[pid].language == point.language
        ]
        if body.state == "practice" and len(practiced) >= grammar.MAX_PRACTICE:
            raise HTTPException(
                422,
                f"Practice at most {grammar.MAX_PRACTICE} at a time. Set one to Know it first.",
            )
        store.set_grammar(engine.conn, point_id, body.state)
        if body.state in ("practice", "normal"):
            # Drilled from now on (docs/grammar.md, step 5): its questions are written ahead.
            background.add_task(top_up_drills, (point_id,))
        return grammar_points()

    return routes
