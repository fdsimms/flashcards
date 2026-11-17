---
paths:
  - "src/import/**"
  - "src/core/template.ts"
  - "src/core/cards.ts"
  - "src/core/cloze.ts"
  - "src/core/html.ts"
  - "src/ui/CardWebView.tsx"
  - "src/ui/CardSide.tsx"
  - "src/ui/AnkiTransfer.tsx"
  - "src/db/**"
  - "tests/import/**"
---

# Import and card rendering

Moved out of `CLAUDE.md`, verbatim, so it loads only with the code it governs (see "Rules that
load by path" there). A comment that cites "CLAUDE.md" for one of these sections means this file.

## Import

- **Ids are derived, never random.** A note's id comes from its source (Anki's note id, the TSV
  GUID column, or `tsv:<deck>:<entry>`), and a card's id is `<noteId>:<kind>`, so re-importing the
  same file updates rows instead of duplicating them. Any row the app writes unattended follows
  the same rule.
- **A re-import finds a note it already has even when the id differs** (`reconcileIds`): same id
  first, else the one stored note with the same note type and front field (`matchKey`), in any
  deck. Several matches means a homograph: import as new and warn, never guess. Import screens
  always pass results through it before writing.
- **Re-importing never resets a card already studied here.** The upsert only overwrites scheduling
  on a card still in state New, and never suspension, a flag or a bury: its callers (a TSV, the
  note editor) don't carry them, so overwriting them could only undo one set in Franki or Anki. An
  Anki import goes through `applyAnkiCollection`, where Anki's values win. Keep that true in both repos.
- **A card whose kind the note no longer generates is `retired`, not deleted or suspended.**
  Suspension is the user's (set in Franki or Anki) and a TSV re-import doesn't carry it, so the two
  must stay separate; retiring keeps the card's history, and turning the kind back on restores it.
- **An Anki card's `ord` is its template's position in the note type**, fixed whichever cards a
  note generates (`omnilanguageKindByOrd`). Matching it against the list of kinds a note happens to
  generate dropped the audio card's scheduling on notes with no reverse card.
- **`omnilanguageFieldNames` must match the live note type exactly** (check with AnkiMCP's
  `model_field_names`): a TSV without `#columns` is mapped by position, so a field added in Anki
  and missing here shifts every field after it.
- **An unreadable file is refused with the reason and what to export instead**, never parsed as
  something else and left to fail with an unrelated message (`.apkg`, and a backup `.db`, on the
  Import screen).

## Card rendering

- **Omnilanguage renders natively** (`renderCard`), playing the note's recorded `Audio` file
  (`RenderedCard.audioFile`, via `expo-audio`) and falling back to TTS only when there's none or
  the file isn't on the phone; **every other note type renders its
  Anki templates** (`src/core/template.ts`) in `CardWebView`, one `t<ord>` card per Anki card.
  Template rendering follows Anki's rules where they matter: a field holding only whitespace,
  `<br>` or `<div>` is empty but an image isn't (`fieldIsEmpty`), and a cloze card's ordinal is its
  cloze number - 1.
- **The WebView loads a page written to a file, not an HTML string**, with read access to the
  documents folder and `<base href>` at the media folder. iOS's WebView only reads local files for
  a page that came from a file URL; an HTML string with a file:// baseUrl shows no images.
