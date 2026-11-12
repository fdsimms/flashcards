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

2. **Forms practice.** A drill on a form whose group links to a point names the point and opens its
   note. A point set to Practice in that language gets its forms asked more often. The choices come
   from Read & Listen's server, so with it off the link still shows and the weighting doesn't apply.
3. **Explain.** The request for a line's explanation (`explain.py`) carries the language's points by
   id and name, and the answer says which it used; the reader shows those as chips that open the
   point.
4. **A page for each point.** Adds `explanation` (a longer note with examples, written per point and
   checked by the owner) and `related` (ids to compare, like the preterite and the imperfect) to the
   catalog. The page shows those, examples from texts already read (the finders find them, as
   `exposure.py` does), Forms practice results for the point's groups, and its choice. Those results
   may suggest Know it; the owner still sets it.
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
