# flashcards

A small personal spaced-repetition app (React Native + Expo) built for language vocab and trivia, with import from Anki.

- **Scheduling:** FSRS via [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs), with each deck's FSRS weights, desired retention and daily limits carried over from Anki
- **Storage:** `expo-sqlite`, on the device only, with backup and restore through Files / iCloud Drive
- **Audio:** `expo-speech` (on-device TTS, language picked from the note's `Language` field or deck name)
- **Cards:** Omnilanguage notes render natively with TTS: a front card (unless `SuppressFrontCard`), plus reverse / audio cards gated on `GenerateReverse` / `GenerateAudioCard`. Every other note type renders its own Anki templates and CSS in a WebView, with its images and sounds, one card per Anki card (cloze included).
- **Decks:** nested as in Anki. Opening a parent studies its subdecks too, within each deck's limits.

## Run it

```bash
npm install
npx expo start      # scan the QR code with Expo Go on your iPhone
npm test            # scheduler, queue, study-day, importer, exporter and backup tests
npm run typecheck
npm run verify      # typecheck + tests, the loop to run before committing
```

## Moving your Anki collection over

On your computer, with Anki closed and Node 22.13 or later:

```bash
node scripts/export-anki.mjs                      # the only profile; lists them if there are several
node scripts/export-anki.mjs --profile "User 1" --out ~/Desktop/anki-export.json
```

It reads a copy of `collection.anki2` (the original is never opened) and writes `anki-export.sqlite`: every note, each card's scheduling and FSRS memory state, each deck's new/review limits, desired retention and FSRS weights, each note type's templates and CSS, and the images and sounds the notes use. Save it to iCloud Drive, then on the phone tap **Import** and pick it. `--out something.json` writes the JSON alone, without media.

Other formats the Import screen reads:

1. **TSV**: Anki's "Notes in Plain Text" export, including your Omnilanguage TSVs. Every card starts as new. Uses `#columns` / `#tags column` / `#deck` when present, otherwise the Omnilanguage field order in `src/import/models.ts`.
2. **AnkiConnect-style JSON**: `{ notes: notesInfo[], cards: cardsInfo[], collectionCreated }`, optionally with AnkiMCP's `get_fsrs_params` output as `fsrsParams`. The exporter above writes this same shape, plus `deckConfigs` and `noteTypes`. Without `noteTypes`, other note types get one plain front/back card.

Re-importing never resets cards that have already been reviewed here, and finds notes you already have even if the export format or deck changed. Cards a note stops generating (`GenerateReverse` turned off) are set aside with their history, not deleted.

## Backing up

Everything lives on the phone. **Backup** on the deck list makes one file with the database and the imported images and sounds, and opens the share sheet: choose **Save to Files** to keep it in iCloud Drive. **Restore from a backup** on the same screen replaces everything with a backup's contents (it asks first). The deck list says when you last backed up, and turns red after a week.

## Studying

Tap a deck to study it with its subdecks. **Undo** in the top right takes back the last answer (and the one before, and so on) and shows that card again.

## Installing on your iPhone

Expo Go only runs the app while `npx expo start` is running on your computer. To have it on your phone for good, build it with EAS. This needs an [Expo account](https://expo.dev) and a paid Apple Developer account.

```bash
npx eas-cli@latest login
npx eas-cli@latest init                                          # links the project, adds its id to app.json
npx eas-cli@latest build --platform ios --profile production     # signs and builds in the cloud
npx eas-cli@latest submit --platform ios --latest                # uploads to TestFlight
```

Then install it from TestFlight. The bundle identifier is `com.fdsimms.flashcards` (`app.json`); change it before the first build if you want a different one. The `preview` profile in `eas.json` makes an ad hoc build instead, for devices registered with `eas device:create`.

## Layout

```
src/core     types, FSRS wrapper, queue, deck tree, study day, card rendering, Anki templates,
             session bookkeeping, config (pure TS, unit-tested)
src/import   TSV + Anki JSON importers, re-import matching
src/db       Repo interface, in-memory repo (tests), SQLite repo (app), backup planning
src/media    the images and sounds folder
src/ui       deck list, review, import, backup screens, the card WebView
scripts/     export-anki.mjs (desktop exporter) and its library
tests/       vitest, mirroring src/ and scripts/; tests/fixtures/anki holds a real Anki collection
```

The study day starts at 4 AM, as in Anki, so a late-night session counts toward the day before. Rules for working in the repo are in `CLAUDE.md`.

## Not built yet

Typing the answer (`{{type:}}` shows the answer on the back instead), Anki's own TTS tags (`{{tts:}}`), recorded audio on Omnilanguage cards (TTS is used), collapsing decks, adding/editing cards in-app, stats, sync back to Anki, and reading `.apkg` files directly.
