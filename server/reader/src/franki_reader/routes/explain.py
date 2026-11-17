"""A line explained by Claude: its grammar and vocabulary, a phrase in it, a word's form, and
whether a native speaker would say it."""

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from franki_reader import (
    grammar,
    store,
)
from franki_reader.coverage import parse_line
from franki_reader.explain import (
    CheckRequest,
    ExplainFailed,
    ExplainRequest,
    FormRequest,
    PhraseRequest,
)
from franki_reader.languages import LANGUAGES
from franki_reader.once import Once
from franki_reader.routes.context import AppContext
from franki_reader.store import StoredText


class ExplainIn(BaseModel):
    # A second, plainer explanation of a line already explained.
    simple: bool = False
    # The notes in the line's language, for practice, rather than English.
    in_language: bool = False

    @property
    def version(self) -> int:
        """Which kept answer this asks for (store.py, Explanations)."""
        return int(self.simple) + 2 * int(self.in_language)


class PhraseIn(BaseModel):
    # As it appears in the line: the words the owner selected and what's between them.
    phrase: str = Field(min_length=1, max_length=300)
    simple: bool = False
    in_language: bool = False

    @property
    def version(self) -> int:
        return int(self.simple) + 2 * int(self.in_language)


class FormExplainIn(BaseModel):
    # The word as it appears in the line, and what the app shows of its form (Word in src/reader/api.ts).
    word: str = Field(min_length=1, max_length=100)
    lemma: str = Field(min_length=1, max_length=100)
    form: str = Field(min_length=1, max_length=100)
    helper: str = Field(default="", max_length=100)


def whole_text_lines(text: StoredText, plain: list[str]) -> tuple[str, ...]:
    """Every line of the text as "Speaker: text (English)", for an explanation to read a line
    against what it refers to. The speaker is shown for a dialogue only."""
    return tuple(
        f"{f'{ln.speaker}: ' if text.form == 'dialogue' else ''}{p} ({ln.english})"
        for ln, p in zip(text.lines, plain, strict=True)
    )


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine
    explain = ctx.explain
    explain_phrase = ctx.explain_phrase
    explain_form = ctx.explain_form
    check_natural = ctx.check_natural
    keep_failed_cost = ctx.keep_failed_cost
    # An explanation being written: a second request for it (a double tap) waits for that answer
    # rather than paying Claude for another.
    explaining: Once[dict[str, Any]] = Once()

    def line_grammar(text: StoredText, line: int) -> list[dict[str, str]]:
        # Found by the finders, not asked of Claude, and read with the choices as they stand now,
        # so every explanation, kept or new, shows them (docs/grammar.md, step 3).
        _, lexicon = engine.snapshot(text.language)
        choices = store.load_grammar(engine.conn)
        return [
            {
                "id": p.id,
                "name": p.name,
                "note": p.note,
                "example": p.example,
                "state": choices.get(p.id, "unset"),
            }
            for p in grammar.points_in(text.lines[line].text, lexicon, text.language)
        ]

    @routes.post("/api/texts/{text_id}/lines/{line}/explain", dependencies=authed)
    async def explain_line(text_id: int, line: int, body: ExplainIn) -> dict[str, Any]:
        text = store.get_text(engine.conn, text_id)
        if text is None or not 0 <= line < len(text.lines):
            raise HTTPException(404, "No such line.")
        if (kept := store.get_explanation(engine.conn, text_id, line, body.version)) is not None:
            return {"points": kept, "grammar": line_grammar(text, line)}
        if explain is None:
            raise HTTPException(
                503,
                "Claude isn't set up on the server, so it can't explain lines"
                " (ANTHROPIC_API_KEY in server/.env turns explanations on).",
            )
        spaced = LANGUAGES[text.language].spaced
        plain = [parse_line(ln.text, spaced)[0] for ln in text.lines]
        explain_ = explain

        async def ask() -> dict[str, Any]:
            try:
                points, used = await explain_(
                    ExplainRequest(
                        text.language,
                        plain[line],
                        text.lines[line].english,
                        whole_text_lines(text, plain),
                        body.simple,
                        text.title,
                        line,
                        body.in_language,
                    )
                )
            except ExplainFailed as e:
                keep_failed_cost("explain", text.language, e.usage)
                # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
                raise HTTPException(503, str(e)) from e
            store.save_explanation(
                engine.conn, text_id, line, body.version, points, engine.clock(), used.cost_usd()
            )
            return {"points": points, "grammar": line_grammar(text, line)}

        return await explaining.run(("line", text_id, line, body.version), ask)

    @routes.post("/api/texts/{text_id}/lines/{line}/phrase", dependencies=authed)
    async def explain_phrase_in_line(text_id: int, line: int, body: PhraseIn) -> dict[str, Any]:
        text = store.get_text(engine.conn, text_id)
        if text is None or not 0 <= line < len(text.lines):
            raise HTTPException(404, "No such line.")
        spaced = LANGUAGES[text.language].spaced
        plain = [parse_line(ln.text, spaced)[0] for ln in text.lines]
        phrase = body.phrase.strip()
        # The app joins the pieces the server split the line into, so the phrase is part of the
        # line as written; spaces are ignored in case the split and the line disagree on them.
        if not phrase or "".join(phrase.split()) not in "".join(plain[line].split()):
            raise HTTPException(400, "That phrase isn't in this line. Select it again.")
        kept = store.get_phrase_explanation(engine.conn, text_id, line, phrase, body.version)
        if kept is not None:
            return kept
        if explain_phrase is None:
            raise HTTPException(
                503,
                "Claude isn't set up on the server, so it can't explain phrases"
                " (ANTHROPIC_API_KEY in server/.env turns explanations on).",
            )
        explain_phrase_ = explain_phrase

        async def ask() -> dict[str, Any]:
            try:
                answer, used = await explain_phrase_(
                    PhraseRequest(
                        text.language,
                        phrase,
                        plain[line],
                        text.lines[line].english,
                        whole_text_lines(text, plain),
                        body.simple,
                        text.title,
                        line,
                        body.in_language,
                    )
                )
            except ExplainFailed as e:
                keep_failed_cost("phrase", text.language, e.usage)
                # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
                raise HTTPException(503, str(e)) from e
            store.save_phrase_explanation(
                engine.conn,
                text_id,
                line,
                phrase,
                body.version,
                answer,
                engine.clock(),
                used.cost_usd(),
            )
            return answer

        return await explaining.run(("phrase", text_id, line, phrase, body.version), ask)

    @routes.post("/api/texts/{text_id}/lines/{line}/form", dependencies=authed)
    async def explain_form_in_line(text_id: int, line: int, body: FormExplainIn) -> dict[str, Any]:
        text = store.get_text(engine.conn, text_id)
        if text is None or not 0 <= line < len(text.lines):
            raise HTTPException(404, "No such line.")
        spaced = LANGUAGES[text.language].spaced
        plain = [parse_line(ln.text, spaced)[0] for ln in text.lines]
        word = body.word.strip()
        if not word or word not in plain[line]:
            raise HTTPException(400, "That word isn't in this line.")
        kept = store.get_form_explanation(engine.conn, text_id, line, word)
        if kept is not None:
            return {"explanation": kept}
        if explain_form is None:
            raise HTTPException(
                503,
                "Claude isn't set up on the server, so it can't explain forms"
                " (ANTHROPIC_API_KEY in server/.env turns explanations on).",
            )
        explain_form_ = explain_form

        async def ask() -> dict[str, Any]:
            try:
                paragraphs, used = await explain_form_(
                    FormRequest(
                        text.language,
                        word,
                        body.lemma.strip(),
                        body.form.strip(),
                        body.helper.strip(),
                        plain[line],
                        text.lines[line].english,
                        whole_text_lines(text, plain),
                        text.title,
                        line,
                    )
                )
            except ExplainFailed as e:
                keep_failed_cost("form_explain", text.language, e.usage)
                raise HTTPException(503, str(e)) from e
            store.save_form_explanation(
                engine.conn, text_id, line, word, paragraphs, engine.clock(), used.cost_usd()
            )
            return {"explanation": paragraphs}

        return await explaining.run(("form", text_id, line, word), ask)

    @routes.post("/api/texts/{text_id}/lines/{line}/natural", dependencies=authed)
    async def check_line(text_id: int, line: int) -> dict[str, str]:
        text = store.get_text(engine.conn, text_id)
        if text is None or not 0 <= line < len(text.lines):
            raise HTTPException(404, "No such line.")
        if (kept := store.get_naturalness(engine.conn, text_id, line)) is not None:
            return kept
        if check_natural is None:
            raise HTTPException(
                503,
                "Claude isn't set up on the server, so it can't check lines"
                " (ANTHROPIC_API_KEY in server/.env turns this on).",
            )
        spaced = LANGUAGES[text.language].spaced
        plain = [parse_line(ln.text, spaced)[0] for ln in text.lines]
        speaker = text.lines[line].speaker
        role = text.roles.get(speaker, "")
        try:
            answer, used = await check_natural(
                CheckRequest(
                    text.language,
                    plain[line],
                    text.lines[line].english,
                    f"{speaker} ({role})" if role else "",
                    text.lines[line].register,
                    whole_text_lines(text, plain),
                    text.title,
                    line,
                )
            )
        except ExplainFailed as e:
            keep_failed_cost("natural", text.language, e.usage)
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        store.save_naturalness(engine.conn, text_id, line, answer, engine.clock(), used.cost_usd())
        return answer

    return routes
