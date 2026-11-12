# Grammar points

One catalog of grammar points that every part of Franki refers to by id, so grammar can show up
wherever it helps: Read & Listen's texts, Forms practice, Explain, a page for each point. Decided on
12 November 2026 at the owner's request, after weighing an Anki note type for it (below, "Not Anki
notes").

## The catalog

`server/reader/src/franki_reader/grammar_points.json`. Read & Listen's server reads it at startup
(`grammar.py`) and the app bundles it (`src/core/grammar.ts`), so the phone can name a point with
Read & Listen off. It sits in the reader's package so the server's image carries it with no step of
its own; the app imports it from there.

Each point has:

- **`id`**: `<language>.<name>`, like `es.preterite`. **Ids are permanent**: the owner's choices
  are stored by id and every text records the ids it was written with (`texts.grammar`), so a
  renamed id orphans both. Change the name instead. A removed point's id is skipped where texts
  still name it (`grammar.marks`).
- **`language`**: Read & Listen's language code. `tests/core/grammar.test.ts` fails the build if
  the app's list and the reader's `Language` drift apart, and the server refuses a language it
  doesn't have.
- **`name`** and **`note`**: as the Grammar screen and the reader show them. User-facing copy, so
  American English and no em dashes (the test checks the dashes).
- **`forms`** (optional): the Forms field's groups this point is, as Forms practice reads them
  (`present subjunctive` in `present subjunctive · yo: espere`). Matched ignoring case and spacing
  (`grammarPointForForms`). A group links to one point at most in a language. Groups the MCP's
  Forms fill writes are checked against it (`server/mcp/tests/test_forms.py`); a hand-written group
  in another language just needs the same spelling.
- **`explanation`**: the point's page text: when to use it, how it's formed and what it's confused
  with, with examples and their English. Paragraphs are split by a blank line, and `**...**` marks
  words in the language (`explanationParagraphs`). User-facing, so the same copy rules; the test
  checks every point has one, with marked words, closed `**` and no em dashes. Written for the
  owner to check, each a few short paragraphs; keep a new one in the same style.
- **`related`**: points worth comparing it with, by id, in the same language (the test checks).

Each point's **finder** stays code, in `grammar.py` and `grammar_europe.py`, keyed by id. The server
won't start if a point has no finder or a finder has no point (`_load`), so a point can't be offered
for texts and then never found.

**The owner's choices** (Practice, Don't know it, Know it, not set) are stored on the server, as
before (docs/read-and-listen/architecture.md, Grammar). The catalog is what a point is; the server
holds what the owner has decided about it.

## Not Anki notes

A note type for grammar was considered and set aside: a point is mostly its finder, which a note
can't hold, so a point added in Anki would be offered and then do nothing; a fixed card tests
remembering the rule rather than using it; and Read & Listen never grades FSRS from exposure. The
collection had no grammar notes to bring over.

## The plan

Step 1 (this file's first version) is the catalog itself, with nothing on screen changed. Each later
step is its own PR, and each that changes a screen is mocked up for the owner first (CLAUDE.md,
"Mock up a proposed UI change").

2. **Forms practice** (built 12 November 2026; the owner chose from a mock). Each prompt carries its
   form's point (`formGrammar`, by the note's language and the form's group), and the drill's result
   card names it under a rule once the answer is shown, never before: a point's examples can give a
   common verb's form away (fueron is ser's and ir's). Points set to Practice in any language
   (`GET /api/grammar/choices`, read by `practicingPoints`) steer it: a drill asks their forms after
   the ones still owed right answers and before the rest (`askRank`), and Practice forms starts with
   their kinds of form selected, saying why (`practicedGroups`, `practicedGroupsLine`) while that is
   still the selection. With Read & Listen off, unreachable, or slower than `CHOICES_WAIT_MS`
   (3 seconds), practice goes on as before; the grammar line still shows, from the bundled catalog.
3. **Explain** (built 12 November 2026; the owner chose from a mock). Under a line's explanation,
   "Grammar in this line" has a chip for each point the finders find in it (`points_in`), with its
   choice ("Preterite · Practicing"). Tapping one shows the point's note and the three choices, as on
   the Grammar screen. The points come with each explain answer (`grammar`), found when it's asked
   and read with the choices as they stand, so explanations kept from before show them too, and
   Claude is asked nothing new. Only points a finder can spot get a chip: a form shared with another
   tense (compramos) gets none. Tagging each of Claude's notes with its point, checked by the
   finder, was the other option and was set aside.
4. **A page for each point** (built 12 November 2026; the owner chose from a mock and checked three
   sample explanations first). `read-grammar-point` (`ReadGrammarPoint.tsx`) shows the point's
   choice, its explanation and related points from the catalog, how often it came up in texts read
   with up to `EXAMPLES` (3) lines using it, the latest read first and one per text (`exposure.examples`,
   `GET /api/grammar/{id}`, the matched words underlined by `markedParts`), and Forms practice on
   its forms over the last 30 study days with the forms missed most (`pointPractice`) and a button
   to practice them (Practice forms opened on the language's deck with the point's groups and every
   pattern). It opens from the Grammar screen (a point's name), an Explain chip and the Forms drill's
   grammar line ("More about ..."; the drill's link shows only while Read & Listen is on, as the
   page needs its server). **Know it is suggested, never set**: at least `KNOW_IT_ANSWERS` (20)
   answers at `KNOW_IT_SHARE` (90%) or more, for a point not already Know it (`suggestKnowIt`).
   "Not yet" is kept on the phone (`grammarHintsDismissed`, beside Forms practice's own results),
   and from then only answers given since count, so it comes back once 20 new ones clear the bar.
5. **Spaced grammar drills**, if wanted, designed on their own: no Anki cards, results kept like
   Forms practice's, never graded from reading.

**Points no finder can find** (case, verb aspect) join the catalog with `findable: false` in the
step that first gives them a use. The server leaves them out of text requests, exposure and marks,
and the Grammar screen shows them without the choices that only apply to texts, saying why.

**Making them findable later** needs a morphological analyzer rather than word lists. A full
parser (spaCy) was measured at about 100 MB more for a process already near 334 MB
(architecture.md, Grammar, "Finding points"); lighter, single-language analyzers (Russian's
pymorphy3, Polish's Morfeusz) may be enough for case. Russian aspect may need none: the deck tags
verbs perfective and lists aspect partners. A finder under Don't know it that finds what isn't
there sends good drafts back, so each new one needs the tests `test_grammar_europe.py` has: texts
that must find nothing.
