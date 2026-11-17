// Generated from server/reader/openapi.json by `npm run api:types`. Don't edit it by hand:
// change the route's response model on the server and run that again.

export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Health */
        get: operations["health_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Check */
        get: operations["check_api_check_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Status */
        get: operations["status_api_status_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/franki-counts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Franki Counts */
        put: operations["franki_counts_api_franki_counts_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/topics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Topics */
        get: operations["topics_api_topics_get"];
        put?: never;
        /** Add Topic */
        post: operations["add_topic_api_topics_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/topics/{topic_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove Topic */
        delete: operations["remove_topic_api_topics__topic_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/suggestions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Suggestions */
        get: operations["suggestions_api_suggestions_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/topics/{topic_id}/next": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Next Text */
        post: operations["next_text_api_topics__topic_id__next_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/shelf": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Shelf */
        get: operations["shelf_api_shelf_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/shelf/write": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Write */
        post: operations["write_api_shelf_write_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/story": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start Story */
        post: operations["start_story_api_story_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/texts/{text_id}/skip": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Skip */
        post: operations["skip_api_texts__text_id__skip_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/texts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Past Texts */
        get: operations["past_texts_api_texts_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/audit/texts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Audit Texts
         * @description Every language's shown texts, for review (audit.py); `/api/texts` is the app's.
         */
        get: operations["audit_texts_api_audit_texts_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/audit/texts/{text_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Audit Text */
        get: operations["audit_text_api_audit_texts__text_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/relisten": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Relisten Texts
         * @description Finished texts due to be heard again, as `/api/texts` lists them (relisten.py), with
         *     `listens` wanted per text: 3 (1, 4 and 10 days), 1 (3 days) or 0 (none).
         */
        get: operations["relisten_texts_api_relisten_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/texts/{text_id}/listen": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Listened
         * @description A finished text heard again with its words hidden. Only counted: no reading, no
         *     difficulty change. 404 for a text that wasn't read to the end.
         */
        post: operations["listened_api_texts__text_id__listen_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/texts/{text_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Text */
        get: operations["get_text_api_texts__text_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/texts/{text_id}/lines/{line}/audio": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Line Audio */
        get: operations["line_audio_api_texts__text_id__lines__line__audio_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/texts/{text_id}/lines/{line}/slow": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Slow Line
         * @description Records the line slowly if it isn't yet, and says when each of its words is spoken in
         *     that recording (`times`, one [start, end] in milliseconds or null per word of the line, as
         *     `words` has them), so the reader can follow along: the normal recording's times don't fit.
         */
        get: operations["slow_line_api_texts__text_id__lines__line__slow_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/texts/{text_id}/choice": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Choose */
        post: operations["choose_api_texts__text_id__choice_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/texts/{text_id}/reading": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reading */
        post: operations["reading_api_texts__text_id__reading_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/words": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Words */
        get: operations["words_api_words_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ranks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Ranks
         * @description Each word's place in its language's list of most common words (1 is the most common),
         *     None past the list's end or for something that isn't a word. Reads only: it never touches
         *     the deck or a card.
         */
        post: operations["ranks_api_ranks_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/words/clear": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Clear Word */
        post: operations["clear_word_api_words_clear_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/texts/{text_id}/lines/{line}/explain": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Explain Line */
        post: operations["explain_line_api_texts__text_id__lines__line__explain_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/texts/{text_id}/lines/{line}/phrase": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Explain Phrase In Line */
        post: operations["explain_phrase_in_line_api_texts__text_id__lines__line__phrase_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/texts/{text_id}/lines/{line}/form": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Explain Form In Line */
        post: operations["explain_form_in_line_api_texts__text_id__lines__line__form_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/texts/{text_id}/lines/{line}/natural": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Check Line */
        post: operations["check_line_api_texts__text_id__lines__line__natural_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Settings */
        get: operations["settings_api_settings_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update Settings */
        patch: operations["update_settings_api_settings_patch"];
        trace?: never;
    };
    "/api/voices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Voices */
        get: operations["voices_api_voices_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/speech": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Speak */
        post: operations["speak_api_speech_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/cast/sample": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cast Sample */
        post: operations["cast_sample_api_cast_sample_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/cast/scene": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cast Scene */
        post: operations["cast_scene_api_cast_scene_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/production/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Check Attempt Route
         * @description Never writes to Anki or grades a card: it only answers.
         */
        post: operations["check_attempt_route_api_production_check_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/texts/{text_id}/retell": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Retell */
        post: operations["retell_api_texts__text_id__retell_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sentences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sentences Route
         * @description Never writes to Anki or grades a card: it only reads the snapshot of the deck.
         */
        post: operations["sentences_route_api_sentences_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/grammar-topics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Grammar Topics */
        get: operations["list_grammar_topics_api_grammar_topics_get"];
        put?: never;
        /** Add Grammar Topic */
        post: operations["add_grammar_topic_api_grammar_topics_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/grammar-topics/read-image": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Read Grammar Topic Image
         * @description The grammar point an image (a photo of a book's page, a screenshot) is about, as a title
         *     to put in the New topic screen. Nothing is stored: the topic is made by a separate call
         *     once the owner has looked at the title.
         */
        post: operations["read_grammar_topic_image_api_grammar_topics_read_image_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/grammar-topics/{topic_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Grammar Topic */
        get: operations["get_grammar_topic_api_grammar_topics__topic_id__get"];
        put?: never;
        post?: never;
        /** Delete Grammar Topic */
        delete: operations["delete_grammar_topic_api_grammar_topics__topic_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/grammar-topics/{topic_id}/examples": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** New Grammar Examples */
        post: operations["new_grammar_examples_api_grammar_topics__topic_id__examples_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/grammar-topics/{topic_id}/rewrite": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Rewrite Grammar Topic */
        post: operations["rewrite_grammar_topic_api_grammar_topics__topic_id__rewrite_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/situations/scenes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Situation Scenes */
        get: operations["situation_scenes_api_situations_scenes_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/situations/turn": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Situation Turn
         * @description Never writes to Anki or grades a card: it only reads the snapshot of the deck.
         */
        post: operations["situation_turn_api_situations_turn_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/situations/feedback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Situation Feedback */
        post: operations["situation_feedback_api_situations_feedback_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/situations/slow": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Situation Slow
         * @description One of their lines again, spoken slowly by Azure: the clip's key for
         *     `/api/situations/audio/{key}`, or None when it couldn't be recorded. Made the first time it's
         *     asked for and kept like any clip.
         */
        post: operations["situation_slow_api_situations_slow_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/situations/audio/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Situation Audio */
        get: operations["situation_audio_api_situations_audio__key__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/lessons": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lessons Route */
        get: operations["lessons_route_api_lessons_get"];
        put?: never;
        /**
         * Make Lesson
         * @description Reads the deck's snapshot to keep the dialogue to words the learner knows; never writes to
         *     Anki or grades a card.
         */
        post: operations["make_lesson_api_lessons_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/lessons/{lesson_id}/audio": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lesson Audio Route */
        get: operations["lesson_audio_route_api_lessons__lesson_id__audio_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/lessons/{lesson_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete Lesson Route */
        delete: operations["delete_lesson_route_api_lessons__lesson_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/mnemonics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Make Mnemonics */
        post: operations["make_mnemonics_api_mnemonics_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/aspect-pair": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Aspect Pair */
        post: operations["aspect_pair_api_aspect_pair_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/glosses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Glosses
         * @description Never writes to Anki or grades a card: it only reads the snapshot of the deck.
         */
        post: operations["glosses_api_glosses_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Progress */
        get: operations["progress_api_progress_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/exposure-effect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Stretch Exposure Effect
         * @description Whether stretch words were remembered better at their next review than similar words
         *     that weren't (exposure_effect.py): an association from the log, not a controlled test.
         */
        get: operations["stretch_exposure_effect_api_exposure_effect_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/costs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Costs */
        get: operations["costs_api_costs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/grammar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Grammar */
        get: operations["get_grammar_api_grammar_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/grammar/choices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Grammar Choices */
        get: operations["get_grammar_choices_api_grammar_choices_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/drills": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Drill */
        post: operations["drill_api_drills_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/forms": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Forms
         * @description The primers for a language's word forms (the chip on a word's popup opens one). Static:
         *     nothing here asks Claude.
         */
        get: operations["get_forms_api_forms_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/grammar/{point_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Grammar Point */
        get: operations["get_grammar_point_api_grammar__point_id__get"];
        /** Choose Grammar */
        put: operations["choose_grammar_api_grammar__point_id__put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/grammar/stretch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Set Grammar Stretch */
        put: operations["set_grammar_stretch_api_grammar_stretch_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/difficulty": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set Difficulty
         * @description Text difficulty for the current language (Settings: Harder 93%, Standard 95% or Easier
         *     97% known words), from the next text written. Answers as `next` in GET /api/progress does.
         */
        put: operations["set_difficulty_api_difficulty_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/grammar/level": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Set Grammar Level */
        put: operations["set_grammar_level_api_grammar_level_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/vocab-check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Vocab Check
         * @description The vocabulary check's questions for a language (vocab_check.py). `state` is "ready" with
         *     the `items`, "preparing" while Claude writes them (ask again in a few seconds), "failed"
         *     when it couldn't (not asked again for `VOCAB_RETRY`), or "unavailable" with no Claude key.
         */
        get: operations["get_vocab_check_api_vocab_check_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/note-queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Note Queue
         * @description The queued words (note_queue.py). Also the way a pass starts again after the server
         *     restarted, or a failed word's wait is over.
         */
        get: operations["get_note_queue_api_note_queue_get"];
        put?: never;
        /** Add To Note Queue */
        post: operations["add_to_note_queue_api_note_queue_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/note-queue/{note_id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Retry Queued Note */
        post: operations["retry_queued_note_api_note_queue__note_id__retry_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/note-queue/{note_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove Queued Note */
        delete: operations["remove_queued_note_api_note_queue__note_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** AspectIn */
        AspectIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en";
            /** Word */
            word: string;
            /**
             * Line
             * @default
             */
            line: string;
        };
        /** AttemptIn */
        AttemptIn: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "sentence" | "translate";
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en";
            /** Attempt */
            attempt: string;
            /**
             * Word
             * @default
             */
            word: string;
            /**
             * Meaning
             * @default
             */
            meaning: string;
            /**
             * English
             * @default
             */
            english: string;
            /**
             * Reference
             * @default
             */
            reference: string;
        };
        /**
         * CastChoice
         * @description The voice and pitch (a percent change) for one kind of story character.
         */
        CastChoice: {
            /** Voice */
            voice: string;
            /** Pitch */
            pitch: number;
        };
        /** CastSampleIn */
        CastSampleIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en";
            /** Voice */
            voice: string;
            /**
             * Pitch
             * @default 0
             */
            pitch: number;
            /**
             * Gender
             * @default female
             * @enum {string}
             */
            gender: "male" | "female";
        };
        /** CastSceneIn */
        CastSceneIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en";
        };
        /** ChoiceIn */
        ChoiceIn: {
            /** Choice */
            choice: number;
        };
        /** ClearWord */
        ClearWord: {
            /** Word */
            word: string;
        };
        /** DifficultyIn */
        DifficultyIn: {
            /**
             * Level
             * @enum {string}
             */
            level: "harder" | "standard" | "easier";
        };
        /** DrillsIn */
        DrillsIn: {
            /** Points */
            points: string[];
            /**
             * Count
             * @default 10
             */
            count: number;
        };
        /** ExplainIn */
        ExplainIn: {
            /**
             * Simple
             * @default false
             */
            simple: boolean;
            /**
             * In Language
             * @default false
             */
            in_language: boolean;
        };
        /** FormExplainIn */
        FormExplainIn: {
            /** Word */
            word: string;
            /** Lemma */
            lemma: string;
            /** Form */
            form: string;
            /**
             * Helper
             * @default
             */
            helper: string;
        };
        /** FrankiCountsIn */
        FrankiCountsIn: {
            /** Due */
            due: number;
            /** New */
            new: number;
        };
        /** GlossSentence */
        GlossSentence: {
            /** Text */
            text: string;
            /**
             * English
             * @default
             */
            english: string;
        };
        /** GlossesIn */
        GlossesIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en";
            /** Sentences */
            sentences: components["schemas"]["GlossSentence"][];
        };
        /** GrammarChoice */
        GrammarChoice: {
            /**
             * State
             * @enum {string}
             */
            state: "practice" | "avoid" | "normal";
        };
        /** GrammarLevelIn */
        GrammarLevelIn: {
            /** Through */
            through: number;
        };
        /** GrammarStretchIn */
        GrammarStretchIn: {
            /** Uses */
            uses: number;
        };
        /** GrammarTopicIn */
        GrammarTopicIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en";
            /** Title */
            title: string;
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** LessonIn */
        LessonIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en";
            /** Scene */
            scene: string;
            /** Narrator */
            narrator?: string | null;
            /** Particle */
            particle?: ("khrap" | "kha") | null;
        };
        /** MnemonicIn */
        MnemonicIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en";
            /** Entry */
            entry: string;
            /** Meaning */
            meaning: string;
            /**
             * Transliteration
             * @default
             */
            transliteration: string;
            /**
             * Context
             * @default
             */
            context: string;
        };
        /** NewTopic */
        NewTopic: {
            /** Name */
            name: string;
        };
        /** NextIn */
        NextIn: {
            /** Words */
            words?: string[];
        };
        /** NoteQueueIn */
        NoteQueueIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en";
            /** Deck */
            deck: string;
            /** Entries */
            entries: components["schemas"]["QueuedEntry"][];
        };
        /** PhraseIn */
        PhraseIn: {
            /** Phrase */
            phrase: string;
            /**
             * Simple
             * @default false
             */
            simple: boolean;
            /**
             * In Language
             * @default false
             */
            in_language: boolean;
        };
        /** QueuedEntry */
        QueuedEntry: {
            /** Entry */
            entry: string;
            /**
             * Meaning
             * @default
             */
            meaning: string;
        };
        /** RanksIn */
        RanksIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en";
            /** Words */
            words: string[];
        };
        /** ReadingIn */
        ReadingIn: {
            /** Rating */
            rating?: ("too_easy" | "about_right" | "too_hard") | null;
            /**
             * Finished
             * @default false
             */
            finished: boolean;
            /**
             * Words Glossed
             * @default []
             */
            words_glossed: string[];
            /**
             * Words Flagged
             * @default []
             */
            words_flagged: string[];
            /** Audio Speed */
            audio_speed?: number | null;
            /**
             * Listen Only
             * @default false
             */
            listen_only: boolean;
            /**
             * Seconds
             * @default 0
             */
            seconds: number;
            /** Check Right */
            check_right?: number | null;
            /** Check Asked */
            check_asked?: number | null;
            /**
             * Quiz Right
             * @default []
             */
            quiz_right: string[];
            /**
             * Quiz Wrong
             * @default []
             */
            quiz_wrong: string[];
        };
        /** RetellIn */
        RetellIn: {
            /** Attempt */
            attempt: string;
        };
        /** SentencesIn */
        SentencesIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en";
            /**
             * Count
             * @default 10
             */
            count: number;
        };
        /** SettingsUpdate */
        SettingsUpdate: {
            /** Stretch Words */
            stretch_words?: ("topic" | "any") | null;
            /** Lines */
            lines?: (6 | 8 | 12) | null;
            /** Form */
            form?: ("dialogue" | "story") | null;
            /** Language */
            language?: ("th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en") | null;
            /** Decks */
            decks?: {
                [key: string]: string;
            } | null;
            /** Common */
            common?: {
                [key: string]: 0 | 250 | 500 | 1000 | 2000 | 3000 | 5000 | 10000;
            } | null;
            /** Voices */
            voices?: {
                [key: string]: {
                    [key: string]: string;
                };
            } | null;
            /** Cast */
            cast?: {
                [key: string]: {
                    [key: string]: components["schemas"]["CastChoice"] | null;
                };
            } | null;
        };
        /** SituationFocus */
        SituationFocus: {
            /** Title */
            title: string;
            /**
             * Lead
             * @default
             */
            lead: string;
        };
        /** SituationIn */
        SituationIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en";
            /** Scene */
            scene: string;
            focus?: components["schemas"]["SituationFocus"] | null;
            roles?: components["schemas"]["SituationRoles"] | null;
            /** Lines */
            lines?: components["schemas"]["SituationLine"][];
            /**
             * Speak
             * @default true
             */
            speak: boolean;
        };
        /** SituationLine */
        SituationLine: {
            /**
             * Speaker
             * @enum {string}
             */
            speaker: "them" | "you";
            /** Text */
            text: string;
        };
        /** SituationRoles */
        SituationRoles: {
            /** You */
            you: string;
            /** Them */
            them: string;
            /** Name */
            name: string;
            /**
             * Gender
             * @enum {string}
             */
            gender: "male" | "female";
        };
        /** SlowClipIn */
        SlowClipIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en";
            /**
             * Gender
             * @enum {string}
             */
            gender: "male" | "female";
            /** Line */
            line: string;
        };
        /** SpeechIn */
        SpeechIn: {
            /** Text */
            text: string;
            /** Voice */
            voice: string;
            /**
             * Rate
             * @default 1
             */
            rate: number;
            /** Language */
            language?: string | null;
        };
        /** StoryIn */
        StoryIn: {
            /**
             * About
             * @default
             */
            about: string;
        };
        /** SuggestionOut */
        SuggestionOut: {
            /** Name */
            name: string;
            /** Fit */
            fit: number;
        };
        /** TopicImageIn */
        TopicImageIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en";
            /** Image */
            image: string;
            /**
             * Media Type
             * @enum {string}
             */
            media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
        };
        /**
         * TopicOut
         * @description A reading topic as the app lists it, its count and state in the language being shown.
         */
        TopicOut: {
            /** Id */
            id: number;
            /** Name */
            name: string;
            /** Ready */
            ready: number;
            /**
             * State
             * @enum {string}
             */
            state: "ready" | "writing" | "failed" | "idle";
        };
        /** ValidationError */
        ValidationError: {
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
            /** Input */
            input?: unknown;
            /** Context */
            ctx?: Record<string, never>;
        };
        /** WriteIn */
        WriteIn: {
            /** Name */
            name: string;
            /**
             * Form
             * @default dialogue
             * @enum {string}
             */
            form: "dialogue" | "story";
            /**
             * Model
             * @default claude-sonnet-5-5
             * @enum {string}
             */
            model: "claude-sonnet-5-5" | "claude-haiku-5-5";
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    health_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
        };
    };
    check_api_check_get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    status_api_status_get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    franki_counts_api_franki_counts_put: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FrankiCountsIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    topics_api_topics_get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TopicOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    add_topic_api_topics_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewTopic"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TopicOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    remove_topic_api_topics__topic_id__delete: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                topic_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    suggestions_api_suggestions_get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SuggestionOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    next_text_api_topics__topic_id__next_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                topic_id: number;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["NextIn"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    shelf_api_shelf_get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    write_api_shelf_write_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WriteIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    start_story_api_story_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StoryIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    skip_api_texts__text_id__skip_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                text_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    past_texts_api_texts_get: {
        parameters: {
            query?: {
                story?: number | null;
            };
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    }[];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    audit_texts_api_audit_texts_get: {
        parameters: {
            query?: {
                language?: string | null;
                story?: number | null;
                days?: number | null;
                limit?: number;
            };
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    }[];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    audit_text_api_audit_texts__text_id__get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                text_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    relisten_texts_api_relisten_get: {
        parameters: {
            query?: {
                listens?: number;
            };
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    }[];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    listened_api_texts__text_id__listen_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                text_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_text_api_texts__text_id__get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                text_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    line_audio_api_texts__text_id__lines__line__audio_get: {
        parameters: {
            query?: {
                speed?: "normal" | "slow";
            };
            header?: {
                authorization?: string | null;
            };
            path: {
                text_id: number;
                line: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    slow_line_api_texts__text_id__lines__line__slow_get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                text_id: number;
                line: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    choose_api_texts__text_id__choice_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                text_id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChoiceIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    reading_api_texts__text_id__reading_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                text_id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReadingIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    words_api_words_get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    }[];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    ranks_api_ranks_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RanksIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: {
                            [key: string]: number | null;
                        };
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    clear_word_api_words_clear_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ClearWord"];
            };
        };
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    explain_line_api_texts__text_id__lines__line__explain_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                text_id: number;
                line: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExplainIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    explain_phrase_in_line_api_texts__text_id__lines__line__phrase_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                text_id: number;
                line: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PhraseIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    explain_form_in_line_api_texts__text_id__lines__line__form_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                text_id: number;
                line: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FormExplainIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    check_line_api_texts__text_id__lines__line__natural_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                text_id: number;
                line: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    settings_api_settings_get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_settings_api_settings_patch: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SettingsUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    voices_api_voices_get: {
        parameters: {
            query: {
                language: string;
            };
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    speak_api_speech_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SpeechIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    cast_sample_api_cast_sample_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CastSampleIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    cast_scene_api_cast_scene_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CastSceneIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    check_attempt_route_api_production_check_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AttemptIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    retell_api_texts__text_id__retell_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                text_id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RetellIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    sentences_route_api_sentences_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SentencesIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_grammar_topics_api_grammar_topics_get: {
        parameters: {
            query: {
                language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en";
            };
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    add_grammar_topic_api_grammar_topics_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GrammarTopicIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    read_grammar_topic_image_api_grammar_topics_read_image_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TopicImageIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_grammar_topic_api_grammar_topics__topic_id__get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                topic_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_grammar_topic_api_grammar_topics__topic_id__delete: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                topic_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    new_grammar_examples_api_grammar_topics__topic_id__examples_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                topic_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    rewrite_grammar_topic_api_grammar_topics__topic_id__rewrite_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                topic_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    situation_scenes_api_situations_scenes_get: {
        parameters: {
            query: {
                language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en";
            };
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": string[];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    situation_turn_api_situations_turn_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SituationIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    situation_feedback_api_situations_feedback_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SituationIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    situation_slow_api_situations_slow_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SlowClipIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string | null;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    situation_audio_api_situations_audio__key__get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                key: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    lessons_route_api_lessons_get: {
        parameters: {
            query?: {
                language?: ("th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en") | null;
            };
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    make_lesson_api_lessons_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LessonIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    lesson_audio_route_api_lessons__lesson_id__audio_get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                lesson_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_lesson_route_api_lessons__lesson_id__delete: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                lesson_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    make_mnemonics_api_mnemonics_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MnemonicIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string[];
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    aspect_pair_api_aspect_pair_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AspectIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    glosses_api_glosses_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GlossesIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    progress_api_progress_get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    stretch_exposure_effect_api_exposure_effect_get: {
        parameters: {
            query?: {
                days?: number;
            };
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    costs_api_costs_get: {
        parameters: {
            query?: {
                days?: number;
            };
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_grammar_api_grammar_get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_grammar_choices_api_grammar_choices_get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    drill_api_drills_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DrillsIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_forms_api_forms_get: {
        parameters: {
            query: {
                language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en";
            };
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_grammar_point_api_grammar__point_id__get: {
        parameters: {
            query?: {
                examples?: number;
                shuffle?: number | null;
            };
            header?: {
                authorization?: string | null;
            };
            path: {
                point_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    choose_grammar_api_grammar__point_id__put: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                point_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GrammarChoice"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_grammar_stretch_api_grammar_stretch_put: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GrammarStretchIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_difficulty_api_difficulty_put: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DifficultyIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_grammar_level_api_grammar_level_put: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GrammarLevelIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_vocab_check_api_vocab_check_get: {
        parameters: {
            query: {
                language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en";
            };
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_note_queue_api_note_queue_get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    add_to_note_queue_api_note_queue_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NoteQueueIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    retry_queued_note_api_note_queue__note_id__retry_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                note_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    remove_queued_note_api_note_queue__note_id__delete: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                note_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
}
