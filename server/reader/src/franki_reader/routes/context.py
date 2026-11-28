"""What every router is built from: the engine, the calls create_app was given (each None when
its key isn't set), and the passphrase checks a route depends on."""

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from franki_speech.commons import Commons

from franki_reader import (
    ask_card,
    aspect,
    cram_phrases,
    cram_say,
    cram_words,
    drills,
    fix_card,
    grammar_lessons,
    grammar_topics,
    journal,
    lesson_words,
    note_queue,
    production,
    rare_words,
    sentences,
    situations,
    store,
    topic_image,
    video,
    vocab_check,
    wanikani_senses,
    word_lookup,
)
from franki_reader.ask_phrase import AskPhrase
from franki_reader.cram_themes import WriteThemes
from franki_reader.engine import Engine
from franki_reader.explain import CheckNatural, Explain, ExplainForm, ExplainPhrase
from franki_reader.gateway import ReadDue, ReadReviews
from franki_reader.generator import Usage
from franki_reader.lesson_topics import WriteTopics
from franki_reader.lesson_writer import WriteGiven, WritePlan
from franki_reader.mnemonics import MakeMnemonics
from franki_reader.tts import ClipCache, Speech

NO_CLAUDE = (
    "Claude isn't set up on the server, so it can't check your writing"
    " (ANTHROPIC_API_KEY in server/.env turns this on)."
)


@dataclass(frozen=True)
class AppContext:
    engine: Engine
    speech: Speech | None
    mnemonics: MakeMnemonics | None
    explain: Explain | None
    explain_phrase: ExplainPhrase | None
    ask_about_phrase: AskPhrase | None
    explain_form: ExplainForm | None
    read_due: ReadDue | None
    read_reviews: ReadReviews | None
    write_drills: drills.WriteDrills | None
    write_vocab: vocab_check.WriteVocab | None
    write_notes: note_queue.WriteNotes | None
    check_natural: CheckNatural | None
    check_attempt: production.CheckAttempt | None
    check_journal: journal.CheckEntry | None
    check_retell: production.CheckRetell | None
    write_sentences: sentences.WriteSentences | None
    play: situations.Play | None
    give_feedback: situations.GiveFeedback | None
    write_topic: grammar_topics.WriteTopic | None
    write_grammar_lesson: grammar_lessons.WriteLesson | None
    read_topic_image: topic_image.ReadTopic | None
    clips: ClipCache | None
    write_lesson: WritePlan | None
    write_given_lesson: WriteGiven | None
    write_lesson_topics: WriteTopics | None
    lessons_dir: Path | None
    commons: Commons | None
    fetch_captions: video.FetchCaptions | None
    native_dir: Path | None
    write_aspect: aspect.WriteAspect | None
    ask_about_card: ask_card.AskCard | None
    fix_flagged_card: fix_card.FixCard | None
    sort_senses: wanikani_senses.SortSenses | None
    find_lesson_words: lesson_words.FindWords | None
    write_cram_themes: WriteThemes | None
    suggest_cram_words: cram_words.SuggestWords | None
    write_cram_phrases: cram_phrases.WritePhrases | None
    write_cram_say: cram_say.WriteSay | None
    write_rare_words: rare_words.WriteRareWords | None
    look_up_words: word_lookup.LookUpWords | None
    # `dependencies=` for a route behind the passphrase, and for /api/status, which also opens
    # with STATUS_TOKEN.
    authed: Sequence[Any]
    status_auth: Sequence[Any]

    def keep_failed_cost(self, feature: store.CallFeature, language: str, used: Usage) -> None:
        """What a call that failed after Claude answered cost: no answer is kept to carry it, so
        it goes in `call_costs`. A call Claude never answered cost nothing."""
        if used != Usage():
            store.save_call_cost(
                self.engine.conn, feature, language, self.engine.clock(), used.cost_usd()
            )
