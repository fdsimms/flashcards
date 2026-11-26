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
    "/api/franki-crams": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Franki Crams */
        put: operations["franki_crams_api_franki_crams_put"];
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
    "/api/stories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Stories */
        get: operations["stories_api_stories_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/stories/{story_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Story */
        get: operations["story_api_stories__story_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/stories/{story_id}/pin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Pin Story */
        post: operations["pin_story_api_stories__story_id__pin_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/stories/{story_id}/end": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** End Story */
        post: operations["end_story_api_stories__story_id__end_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/stories/{story_id}/continue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Continue Story */
        post: operations["continue_story_api_stories__story_id__continue_post"];
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
    "/api/own-texts/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview */
        post: operations["preview_api_own_texts_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/own-texts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Add */
        post: operations["add_api_own_texts_post"];
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
         *     difficulty change. 404 for a text that wasn't read to the end. With a `key`, a listen
         *     already counted under it isn't counted twice.
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
         * @description Where each deck entry stands among its language's most common words (frequency.entry_place):
         *     its place (1 is the most common), None past the list's end, and the entries that are phrases,
         *     which no list of single words ranks. Reads only: it never touches the deck or a card.
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
    "/api/texts/{text_id}/lines/{line}/ask": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Phrase Chat */
        get: operations["phrase_chat_api_texts__text_id__lines__line__ask_get"];
        put?: never;
        /** Ask About Phrase In Line */
        post: operations["ask_about_phrase_in_line_api_texts__text_id__lines__line__ask_post"];
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
    "/api/readings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Readings
         * @description For each Japanese word and its KanaReading, the reading to record it from, or None to
         *     record the kanji as written (japanese.spoken_reading): the MCP's add_tts_audio asks here,
         *     as it has no Sudachi of its own.
         */
        post: operations["readings_api_readings_post"];
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
    "/api/lessons/topics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Lesson Topics Route
         * @description Ideas for a lesson's scene. Never makes a lesson, and only reads which scenes exist.
         */
        post: operations["lesson_topics_route_api_lessons_topics_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/lessons/words": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Lesson Words Route
         * @description The words in the language what was typed could mean, for the learner to pick from; writes
         *     nothing.
         */
        post: operations["lesson_words_route_api_lessons_words_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/lessons/{lesson_id}/marks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mark Route
         * @description Notes a phrase for a review. Never grades a card: a review is a lesson, nothing more.
         */
        post: operations["mark_route_api_lessons__lesson_id__marks_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/lessons/{lesson_id}/heard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Heard Route
         * @description Notes that the lesson was played to the end, so a later lesson may ask for its phrases.
         *     Never grades a card.
         */
        post: operations["heard_route_api_lessons__lesson_id__heard_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/lessons/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Make Review Route */
        post: operations["make_review_route_api_lessons_review_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/lessons/{lesson_id}/phrases/{index}/audio": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Phrase Audio Route
         * @description A phrase of the lesson as it's said at normal speed, cut from the lesson's MP3, for a
         *     card's Audio field.
         */
        get: operations["phrase_audio_route_api_lessons__lesson_id__phrases__index__audio_get"];
        put?: never;
        post?: never;
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
    "/api/cram/say/ask": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cram Say Ask
         * @description The next question of a talk in English about a lesson's topic, written by Claude. Reads
         *     nothing of the deck, writes no card and grades nothing.
         */
        post: operations["cram_say_ask_api_cram_say_ask_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/cram/say/lines": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cram Say Lines
         * @description What the learner would want to say, from what they said in English: a line in the
         *     language for each, built from their words, with the words they lack marked.
         */
        post: operations["cram_say_lines_api_cram_say_lines_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/cram/themes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cram Themes Route
         * @description Themes for a lesson, written by Claude from the learner's words. Reads the snapshot of
         *     the deck for the common words it lacks; adds no note, writes no card and grades nothing.
         */
        post: operations["cram_themes_route_api_cram_themes_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/cram/words": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cram Words Route
         * @description Words Claude suggests for a cram's topic, for the learner to pick from. Writes nothing:
         *     the app tags the ones the deck has and queues the rest, each behind the learner's tap.
         */
        post: operations["cram_words_route_api_cram_words_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/cram/phrases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cram Phrases Route
         * @description Phrases Claude writes for a cram's topic from its words, for the learner to pick from.
         *     Writes nothing: the app keeps the checked ones on the cram, and none is a note.
         */
        post: operations["cram_phrases_route_api_cram_phrases_post"];
        delete?: never;
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
    "/api/word-meaning": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Word Meaning
         * @description The meaning of a tapped word nothing glosses (Engine.define_word): the kept one, else
         *     Claude's, asked now. Never writes to Anki or grades a card.
         */
        post: operations["word_meaning_api_word_meaning_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ask-card": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Ask Card Route */
        post: operations["ask_card_route_api_ask_card_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/fix-card": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Fix Card Route */
        post: operations["fix_card_route_api_fix_card_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/wanikani-senses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Wanikani Senses Route */
        post: operations["wanikani_senses_route_api_wanikani_senses_post"];
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
    "/api/conjugations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Conjugations
         * @description Each Japanese verb's lines for its Forms field (conjugation.form_lines), or None for an
         *     Entry that isn't a verb in its dictionary form: the MCP's fill_forms asks here.
         */
        post: operations["conjugations_api_conjugations_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/pronunciations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Pronunciations
         * @description Each entry's IPA and where it's from (ipa.SOURCE_*), or None when there is none to show (a
         *     phrase, a word the table lacks): the MCP's fill_pronunciation asks here. Reads only: it never
         *     asks Claude for a word's IPA, so it costs nothing, and uses the IPA Claude already wrote for texts.
         */
        post: operations["pronunciations_api_pronunciations_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/reading-lines": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reading Lines Route
         * @description Lines from texts read that use each word, for a card's answer side. Never writes to Anki
         *     or grades a card: it only reads the snapshot of the deck and the texts read.
         */
        post: operations["reading_lines_route_api_reading_lines_post"];
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
    "/api/input-time": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Input Time
         * @description Time spent reading and listening in each language over the last week, most first, for
         *     the home's This week card. It reports only: it sets no goal and nothing reads it.
         */
        get: operations["input_time_api_input_time_get"];
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
    "/api/grammar/answers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Grammar Answers
         * @description Practice answers from the phone, so rotation can tell when a point is learned. Sent again
         *     after a failure, so one already kept is skipped; a point this server doesn't know is too.
         */
        post: operations["grammar_answers_api_grammar_answers_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/grammar/written": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Grammar Written
         * @description The grammar points Claude wrote (written_points.py), every language's, in the catalog's
         *     own fields, for the app to put beside the catalog it bundles.
         */
        get: operations["grammar_written_api_grammar_written_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/grammar/rotations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Grammar Rotations
         * @description The language's automatic grammar swaps not closed or undone yet, for the shelf.
         */
        get: operations["grammar_rotations_api_grammar_rotations_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/grammar/rotations/{rotation_id}/dismiss": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Dismiss Rotation */
        post: operations["dismiss_rotation_api_grammar_rotations__rotation_id__dismiss_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/grammar/rotations/{rotation_id}/undo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Undo Rotation */
        post: operations["undo_rotation_api_grammar_rotations__rotation_id__undo_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/grammar/{point_id}/lesson": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Grammar Lesson */
        get: operations["get_grammar_lesson_api_grammar__point_id__lesson_get"];
        put?: never;
        /**
         * Rewrite Grammar Lesson
         * @description Writes the lesson's examples again (after a failure, or for fresh ones).
         */
        post: operations["rewrite_grammar_lesson_api_grammar__point_id__lesson_post"];
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
    "/api/word-lookup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Look Up
         * @description Words for a meaning typed in English (Quick add's "Don't know the word?"). Only returns
         *     words: a picked one is queued like any other.
         */
        post: operations["look_up_api_word_lookup_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/word-suggestions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Word Suggestions
         * @description Reads the snapshot of the deck only, and for English may ask Claude for rare words (a
         *     call only when the kept ones run short): nothing here adds a note or grades a card. A word
         *     saved since the snapshot was read can still be listed; the app leaves out what its own
         *     copy of the deck already has.
         */
        get: operations["get_word_suggestions_api_word_suggestions_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/word-suggestions/dismiss": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Dismiss Word
         * @description Not interested: the word isn't suggested for the language again.
         */
        post: operations["dismiss_word_api_word_suggestions_dismiss_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** AskCardIn */
        AskCardIn: {
            /** Language */
            language?: ("th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok") | null;
            /** Front */
            front: string;
            /** Back */
            back: string;
            /**
             * Details
             * @default
             */
            details: string;
            /** Turns */
            turns: components["schemas"]["CardTurnIn"][];
        };
        /** AskPhraseIn */
        AskPhraseIn: {
            /** Phrase */
            phrase: string;
            /** Turns */
            turns: components["schemas"]["PhraseTurnIn"][];
            /**
             * In Language
             * @default false
             */
            in_language: boolean;
            /** To Line */
            to_line?: number | null;
        };
        /** AspectIn */
        AspectIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
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
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
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
        /** CardTurnIn */
        CardTurnIn: {
            /**
             * Role
             * @enum {string}
             */
            role: "user" | "assistant";
            /** Content */
            content: string;
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
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
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
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
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
        /** ConjugationsIn */
        ConjugationsIn: {
            /** Verbs */
            verbs: components["schemas"]["VerbIn"][];
        };
        /** DifficultyIn */
        DifficultyIn: {
            /**
             * Level
             * @enum {string}
             */
            level: "harder" | "standard" | "easier";
        };
        /** DismissWordIn */
        DismissWordIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
            /** Word */
            word: string;
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
        /** ExpectOut */
        ExpectOut: {
            question: components["schemas"]["LineOut"];
            answer: components["schemas"]["LineOut"];
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
        /** FixCardIn */
        FixCardIn: {
            /** Language */
            language?: ("th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok") | null;
            /** Fields */
            fields: {
                [key: string]: string;
            };
            /** Reason */
            reason: string;
            /**
             * Note
             * @default
             */
            note: string;
            /** Chat */
            chat?: components["schemas"]["CardTurnIn"][];
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
        /** FoundWordOut */
        FoundWordOut: {
            /** Entry */
            entry: string;
            /** Meaning */
            meaning: string;
            /** Note */
            note: string;
        };
        /** FrankiCountsIn */
        FrankiCountsIn: {
            /** Due */
            due: number;
            /** New */
            new: number;
        };
        /** FrankiCramIn */
        FrankiCramIn: {
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Date */
            date: string;
            /**
             * Ends At
             * Format: date-time
             */
            ends_at: string;
            /** Practiced At */
            practiced_at?: string | null;
            /** Finished At */
            finished_at?: string | null;
        };
        /** FrankiCramsIn */
        FrankiCramsIn: {
            /** Crams */
            crams: components["schemas"]["FrankiCramIn"][];
        };
        /** GivenIn */
        GivenIn: {
            /** Text */
            text: string;
            /** English */
            english: string;
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
            /**
             * Parts
             * @default false
             */
            parts: boolean;
        };
        /** GlossesIn */
        GlossesIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
            /** Sentences */
            sentences: components["schemas"]["GlossSentence"][];
        };
        /** GrammarAnswerIn */
        GrammarAnswerIn: {
            /** Point */
            point: string;
            /** Drill */
            drill: string;
            /** Kind */
            kind: string;
            /** Correct */
            correct: boolean;
            /** Answered At */
            answered_at: string;
        };
        /** GrammarAnswersIn */
        GrammarAnswersIn: {
            /** Answers */
            answers: components["schemas"]["GrammarAnswerIn"][];
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
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
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
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
            /** Scene */
            scene: string;
            /** Narrator */
            narrator?: string | null;
            /** Particle */
            particle?: ("khrap" | "kha") | null;
            /** Register */
            register?: ("casual" | "everyday" | "formal") | null;
            /** Phrases */
            phrases?: components["schemas"]["GivenIn"][] | null;
        };
        /** LineOut */
        LineOut: {
            /** Text */
            text: string;
            /** English */
            english: string;
        };
        /** LinesIn */
        LinesIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
            /**
             * Topic
             * @default
             */
            topic: string;
            /** Said */
            said: string;
            /** Words */
            words?: components["schemas"]["PoolIn"][];
            /** Register */
            register?: ("casual" | "everyday" | "formal") | null;
            /** Particle */
            particle?: ("khrap" | "kha") | null;
        };
        /** LinesOut */
        LinesOut: {
            /** Summary */
            summary: string;
            /** Lines */
            lines: components["schemas"]["SaidOut"][];
        };
        /** ListenIn */
        ListenIn: {
            /** Key */
            key?: string | null;
        };
        /** MarkIn */
        MarkIn: {
            /** Text */
            text: string;
            /** English */
            english: string;
            /**
             * Reason
             * @enum {string}
             */
            reason: "again" | "slow";
        };
        /** MnemonicIn */
        MnemonicIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
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
            /**
             * About
             * @default
             */
            about: string;
        };
        /** NoteQueueIn */
        NoteQueueIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
            /** Deck */
            deck: string;
            /** Entries */
            entries: components["schemas"]["QueuedEntry"][];
            /** Particle */
            particle?: ("khrap" | "kha") | null;
        };
        /** OwnAddedOut */
        OwnAddedOut: {
            /** Ids */
            ids: number[];
        };
        /**
         * OwnPreviewOut
         * @description What adding a text would give, before it's added.
         */
        OwnPreviewOut: {
            /** Title */
            title: string;
            /** Coverage */
            coverage: number;
            /** Words */
            words: number;
            /** New Words */
            new_words: string[];
            /** New Count */
            new_count: number;
            /** Lines */
            lines: number;
            /** Parts */
            parts: number;
            /** Characters */
            characters: number;
            /** Seconds */
            seconds: number;
            /** Cost Usd */
            cost_usd: number;
        };
        /** OwnTextIn */
        OwnTextIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
            /** Text */
            text: string;
            /**
             * Title
             * @default
             */
            title: string;
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
            /** To Line */
            to_line?: number | null;
        };
        /** PhraseOut */
        PhraseOut: {
            /** Text */
            text: string;
            /** Reading */
            reading: string;
            /** English */
            english: string;
        };
        /** PhraseTurnIn */
        PhraseTurnIn: {
            /**
             * Role
             * @enum {string}
             */
            role: "user" | "assistant";
            /** Content */
            content: string;
        };
        /** PhraseWordIn */
        PhraseWordIn: {
            /** Text */
            text: string;
            /** English */
            english: string;
        };
        /** PhrasesIn */
        PhrasesIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
            /**
             * Topic
             * @default
             */
            topic: string;
            /**
             * Facts
             * @default
             */
            facts: string;
            /**
             * Focus
             * @default
             */
            focus: string;
            /** Words */
            words?: components["schemas"]["PhraseWordIn"][];
            /** Exclude */
            exclude?: string[];
            /** Register */
            register?: ("casual" | "everyday" | "formal") | null;
            /** Particle */
            particle?: ("khrap" | "kha") | null;
        };
        /** PhrasesOut */
        PhrasesOut: {
            /** Phrases */
            phrases: components["schemas"]["PhraseOut"][];
        };
        /** PoolIn */
        PoolIn: {
            /** Id */
            id: string;
            /** Text */
            text: string;
            /** English */
            english: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "cram" | "carried" | "missed" | "fresh" | "deck";
        };
        /** PronunciationIn */
        PronunciationIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
            /** Entry */
            entry: string;
            /**
             * Reading
             * @default
             */
            reading: string;
        };
        /** PronunciationsIn */
        PronunciationsIn: {
            /** Entries */
            entries: components["schemas"]["PronunciationIn"][];
        };
        /** QuestionIn */
        QuestionIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
            /**
             * Topic
             * @default
             */
            topic: string;
            /** Turns */
            turns?: components["schemas"]["TurnIn"][];
        };
        /** QuestionOut */
        QuestionOut: {
            /** Question */
            question: string;
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
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
            /** Words */
            words: string[];
        };
        /** RanksOut */
        RanksOut: {
            /** Ranks */
            ranks: {
                [key: string]: number | null;
            };
            /** Phrases */
            phrases: string[];
        };
        /** ReadingLinesIn */
        ReadingLinesIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
            /** Words */
            words: string[];
        };
        /** ReadingsIn */
        ReadingsIn: {
            /** Words */
            words: components["schemas"]["franki_reader__routes__voices__ReadingIn"][];
        };
        /** RetellIn */
        RetellIn: {
            /** Attempt */
            attempt: string;
        };
        /** ReviewIn */
        ReviewIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
            /** Narrator */
            narrator?: string | null;
            /** Particle */
            particle?: ("khrap" | "kha") | null;
        };
        /** SaidOut */
        SaidOut: {
            /** English */
            english: string;
            /** Text */
            text: string;
            /** Known */
            known: number;
            /** Missing */
            missing: components["schemas"]["WordOut"][];
        };
        /** SenseSentenceIn */
        SenseSentenceIn: {
            /** Ja */
            ja: string;
            /**
             * En
             * @default
             */
            en: string;
        };
        /** SenseWordIn */
        SenseWordIn: {
            /** Id */
            id: number;
            /** Characters */
            characters: string;
            /** Glosses */
            glosses: string[];
            /** Sentences */
            sentences: components["schemas"]["SenseSentenceIn"][];
        };
        /** SensesIn */
        SensesIn: {
            /** Words */
            words: components["schemas"]["SenseWordIn"][];
        };
        /** SensesOut */
        SensesOut: {
            /** Words */
            words: components["schemas"]["SensesWordOut"][];
        };
        /** SensesWordOut */
        SensesWordOut: {
            /** Id */
            id: number;
            /** Glosses */
            glosses: number[][];
            /** Sentences */
            sentences: number[];
            /** Labels */
            labels: string[];
        };
        /** SentencesIn */
        SentencesIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
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
            language?: ("th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok") | null;
            /** Decks */
            decks?: {
                [key: string]: string;
            } | null;
            /** Common */
            common?: {
                [key: string]: 0 | 250 | 500 | 1000 | 2000 | 3000 | 5000 | 10000;
            } | null;
            /** Daily Tasks */
            daily_tasks?: {
                [key: string]: "daily" | "rotate" | "off";
            } | null;
            /** Daily Rotate Count */
            daily_rotate_count?: number | null;
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
            /** Register */
            register?: ("casual" | "everyday" | "formal") | null;
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
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
            /** Scene */
            scene: string;
            focus?: components["schemas"]["SituationFocus"] | null;
            /** Words */
            words?: string[];
            /** Prepared */
            prepared?: string[];
            roles?: components["schemas"]["SituationRoles"] | null;
            /** Lines */
            lines?: components["schemas"]["SituationLine"][];
            /**
             * Speak
             * @default true
             */
            speak: boolean;
            /** Register */
            register?: ("casual" | "everyday" | "formal") | null;
            /** Partner */
            partner?: "tutor" | null;
            /** Particle */
            particle?: ("khrap" | "kha") | null;
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
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
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
            /** Reading */
            reading?: string | null;
            /** Ipa */
            ipa?: string | null;
        };
        /** StoryIn */
        StoryIn: {
            /**
             * About
             * @default
             */
            about: string;
        };
        /** SuggestedWordOut */
        SuggestedWordOut: {
            /** Text */
            text: string;
            /** Reading */
            reading: string;
            /** English */
            english: string;
            /** Commonness */
            commonness: string;
            /** Register */
            register: string;
        };
        /** SuggestionOut */
        SuggestionOut: {
            /** Name */
            name: string;
            /** Fit */
            fit: number;
        };
        /** ThemeOut */
        ThemeOut: {
            /** Title */
            title: string;
            /** Why */
            why: string;
            /** Word Ids */
            word_ids: string[];
            /** Deck Words */
            deck_words: components["schemas"]["WordOut"][];
            /** New Words */
            new_words: components["schemas"]["WordOut"][];
            /** Questions */
            questions: components["schemas"]["LineOut"][];
            /** Expects */
            expects: components["schemas"]["ExpectOut"][];
            story: components["schemas"]["LineOut"] | null;
            /** Unknown */
            unknown: components["schemas"]["WordOut"][];
        };
        /** ThemesIn */
        ThemesIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
            /** Words */
            words: components["schemas"]["PoolIn"][];
            /** Weak Spots */
            weak_spots?: string[];
            /** Avoid */
            avoid?: string[];
            /**
             * Stretch
             * @default false
             */
            stretch: boolean;
            /**
             * Topic
             * @default
             */
            topic: string;
            /** Register */
            register?: ("casual" | "everyday" | "formal") | null;
            /** Particle */
            particle?: ("khrap" | "kha") | null;
            /**
             * Facts
             * @default
             */
            facts: string;
        };
        /** ThemesOut */
        ThemesOut: {
            /** Themes */
            themes: components["schemas"]["ThemeOut"][];
        };
        /** TopicImageIn */
        TopicImageIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
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
        /** TopicsIn */
        TopicsIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
            /** Phrases */
            phrases?: components["schemas"]["GivenIn"][] | null;
            /** Shown */
            shown?: string[];
        };
        /** TurnIn */
        TurnIn: {
            /**
             * Asker
             * @enum {string}
             */
            asker: "claude" | "you";
            /** Text */
            text: string;
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
        /** VerbIn */
        VerbIn: {
            /** Entry */
            entry: string;
            /**
             * Reading
             * @default
             */
            reading: string;
        };
        /** WordIn */
        WordIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
            /** Text */
            text: string;
            /** Particle */
            particle?: ("khrap" | "kha") | null;
        };
        /** WordLookupIn */
        WordLookupIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
            /** Meaning */
            meaning: string;
        };
        /** WordLookupOut */
        WordLookupOut: {
            /** Words */
            words: components["schemas"]["FoundWordOut"][];
        };
        /** WordMeaningIn */
        WordMeaningIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
            /** Word */
            word: string;
            /**
             * English
             * @default
             */
            english: string;
        };
        /** WordOut */
        WordOut: {
            /** Word */
            word: string;
            /** English */
            english: string;
        };
        /** WordSuggestionOut */
        WordSuggestionOut: {
            /** Word */
            word: string;
            /** Meaning */
            meaning: string;
            /** Rank */
            rank: number | null;
            /** Texts */
            texts: number;
        };
        /**
         * WordSuggestionsOut
         * @description The words from texts read, the common words the deck lacks and, for English, the rare words
         *     Claude wrote, each source best first. `written_error` says why Claude's words are missing.
         */
        WordSuggestionsOut: {
            /** Texts */
            texts: components["schemas"]["WordSuggestionOut"][];
            /** Common */
            common: components["schemas"]["WordSuggestionOut"][];
            /** Written */
            written: components["schemas"]["WordSuggestionOut"][];
            /** Written Error */
            written_error: string;
        };
        /** WordsIn */
        WordsIn: {
            /**
             * Language
             * @enum {string}
             */
            language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
            /**
             * Topic
             * @default
             */
            topic: string;
            /**
             * Facts
             * @default
             */
            facts: string;
            /**
             * Focus
             * @default
             */
            focus: string;
            /** Exclude */
            exclude?: string[];
        };
        /** WordsOut */
        WordsOut: {
            /** Words */
            words: components["schemas"]["SuggestedWordOut"][];
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
        /** ReadingIn */
        franki_reader__routes__texts__ReadingIn: {
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
        /** ReadingIn */
        franki_reader__routes__voices__ReadingIn: {
            /** Text */
            text: string;
            /** Reading */
            reading: string;
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
    franki_crams_api_franki_crams_put: {
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
                "application/json": components["schemas"]["FrankiCramsIn"];
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
            query?: {
                language?: ("th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok") | null;
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
    stories_api_stories_get: {
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
    story_api_stories__story_id__get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                story_id: number;
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
    pin_story_api_stories__story_id__pin_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                story_id: number;
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
    end_story_api_stories__story_id__end_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                story_id: number;
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
    continue_story_api_stories__story_id__continue_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                story_id: number;
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
    preview_api_own_texts_preview_post: {
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
                "application/json": components["schemas"]["OwnTextIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OwnPreviewOut"];
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
    add_api_own_texts_post: {
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
                "application/json": components["schemas"]["OwnTextIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OwnAddedOut"];
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
        requestBody?: {
            content: {
                "application/json": components["schemas"]["ListenIn"] | null;
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
                "application/json": components["schemas"]["franki_reader__routes__texts__ReadingIn"];
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
                    "application/json": components["schemas"]["RanksOut"];
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
    phrase_chat_api_texts__text_id__lines__line__ask_get: {
        parameters: {
            query: {
                phrase: string;
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
                    "application/json": {
                        [key: string]: {
                            [key: string]: string;
                        }[];
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
    ask_about_phrase_in_line_api_texts__text_id__lines__line__ask_post: {
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
                "application/json": components["schemas"]["AskPhraseIn"];
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
    readings_api_readings_post: {
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
                "application/json": components["schemas"]["ReadingsIn"];
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
                        [key: string]: (string | null)[];
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
                language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
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
                language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
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
                language?: ("th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok") | null;
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
    lesson_topics_route_api_lessons_topics_post: {
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
                "application/json": components["schemas"]["TopicsIn"];
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
    lesson_words_route_api_lessons_words_post: {
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
                "application/json": components["schemas"]["WordIn"];
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
    mark_route_api_lessons__lesson_id__marks_post: {
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
        requestBody: {
            content: {
                "application/json": components["schemas"]["MarkIn"];
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
    heard_route_api_lessons__lesson_id__heard_post: {
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
    make_review_route_api_lessons_review_post: {
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
                "application/json": components["schemas"]["ReviewIn"];
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
    phrase_audio_route_api_lessons__lesson_id__phrases__index__audio_get: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                lesson_id: number;
                index: number;
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
    cram_say_ask_api_cram_say_ask_post: {
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
                "application/json": components["schemas"]["QuestionIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QuestionOut"];
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
    cram_say_lines_api_cram_say_lines_post: {
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
                "application/json": components["schemas"]["LinesIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LinesOut"];
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
    cram_themes_route_api_cram_themes_post: {
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
                "application/json": components["schemas"]["ThemesIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ThemesOut"];
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
    cram_words_route_api_cram_words_post: {
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
                "application/json": components["schemas"]["WordsIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WordsOut"];
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
    cram_phrases_route_api_cram_phrases_post: {
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
                "application/json": components["schemas"]["PhrasesIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PhrasesOut"];
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
    word_meaning_api_word_meaning_post: {
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
                "application/json": components["schemas"]["WordMeaningIn"];
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
    ask_card_route_api_ask_card_post: {
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
                "application/json": components["schemas"]["AskCardIn"];
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
    fix_card_route_api_fix_card_post: {
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
                "application/json": components["schemas"]["FixCardIn"];
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
    wanikani_senses_route_api_wanikani_senses_post: {
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
                "application/json": components["schemas"]["SensesIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SensesOut"];
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
    conjugations_api_conjugations_post: {
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
                "application/json": components["schemas"]["ConjugationsIn"];
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
                        [key: string]: (string[] | null)[];
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
    pronunciations_api_pronunciations_post: {
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
                "application/json": components["schemas"]["PronunciationsIn"];
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
                        [key: string]: ({
                            [key: string]: string;
                        } | null)[];
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
    reading_lines_route_api_reading_lines_post: {
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
                "application/json": components["schemas"]["ReadingLinesIn"];
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
    input_time_api_input_time_get: {
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
                language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
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
    grammar_answers_api_grammar_answers_post: {
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
                "application/json": components["schemas"]["GrammarAnswersIn"];
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
    grammar_written_api_grammar_written_get: {
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
    grammar_rotations_api_grammar_rotations_get: {
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
    dismiss_rotation_api_grammar_rotations__rotation_id__dismiss_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                rotation_id: number;
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
    undo_rotation_api_grammar_rotations__rotation_id__undo_post: {
        parameters: {
            query?: never;
            header?: {
                authorization?: string | null;
            };
            path: {
                rotation_id: number;
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
    get_grammar_lesson_api_grammar__point_id__lesson_get: {
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
    rewrite_grammar_lesson_api_grammar__point_id__lesson_post: {
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
                language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
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
    look_up_api_word_lookup_post: {
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
                "application/json": components["schemas"]["WordLookupIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WordLookupOut"];
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
    get_word_suggestions_api_word_suggestions_get: {
        parameters: {
            query: {
                language: "th" | "es" | "de" | "fr" | "ru" | "el" | "pl" | "nb" | "ja" | "en" | "tok";
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
                    "application/json": components["schemas"]["WordSuggestionsOut"];
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
    dismiss_word_api_word_suggestions_dismiss_post: {
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
                "application/json": components["schemas"]["DismissWordIn"];
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
}
