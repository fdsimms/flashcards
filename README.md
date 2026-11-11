# Franki

A small personal spaced-repetition app (React Native + Expo) built for language vocab and trivia, with import from Anki. The repo is still called `flashcards`; the app is Franki.

- **Scheduling:** FSRS via [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs), with each deck's FSRS weights, desired retention and daily limits carried over from Anki
- **Storage:** `expo-sqlite`, on the device only, with backup and restore through Files / iCloud Drive
- **Audio:** `expo-speech` (on-device TTS, language picked from the note's `Language` field or deck name)
- **Cards:** Omnilanguage notes render natively with TTS: a front card (unless `SuppressFrontCard`), plus reverse / audio cards gated on `GenerateReverse` / `GenerateAudioCard`. Every other note type renders its own Anki templates and CSS in a WebView, with its images and sounds, one card per Anki card (cloze included).
- **Decks:** nested as in Anki. Opening a parent studies its subdecks too, within each deck's limits.

## Run it

```bash
npm install
npm run ios:device  # build and install the development build on a plugged-in iPhone (see below)
npx expo start      # serve the latest code to it
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

**Limit cards in progress** (a deck's **Options**) works like WaniKani's Apprentice limit. A card is in progress from when you first learn it until its next review is a week or more away, which is what Guru means on WaniKani. If you forget it, or its next review comes back under a week, it counts again. With the limit on, a deck shows new cards only while fewer than the cap (100 to start) of its cards, subdecks included, are in progress, and its daily new card limit no longer applies.

## Installing on your iPhone

Everything builds on your Mac; nothing is built on Expo's servers. You need a Mac with **Xcode** (open it once so it installs the iOS components, then add your Apple ID under **Settings > Accounts**), **CocoaPods** and **fastlane** (`brew install cocoapods fastlane`), and a paid Apple Developer account. The app doesn't use Expo Go. The bundle identifier is `com.fdsimms.franki` (`app.json`); once the first build is on App Store Connect it can't change without starting over as a new app.

### For trying changes: a development build

Plug the iPhone into the Mac, turn on **Settings > Privacy & Security > Developer Mode** on it (iOS asks you to restart), then:

```bash
npm run ios:device      # npx expo run:ios --device: builds in Xcode, installs on the phone, starts the dev server
```

The first time, it asks you to pick the iPhone and your developer team for signing. After that, code changes reload on the phone as you save. Run it again only when a native dependency changes (a new `expo-*` package with native code, or `app.json`'s plugins); otherwise `npx expo start` is enough to reconnect.

### For everyday use: TestFlight

Once:

```bash
npx eas-cli@latest login     # a free Expo account: it keeps your signing certificate and build number
npx eas-cli@latest init      # links the project and adds its id to app.json (commit that)
```

Each release:

```bash
npm run build:ios            # eas build --local: the full release build, run on this Mac; writes a .ipa here
```

The first time, it asks to sign in to your Apple account and creates the distribution certificate and provisioning profile. Answer that the app doesn't use non-exempt encryption. The build number goes up by itself on every build.

Then upload the `.ipa`, either way:

- `npx eas-cli@latest submit --platform ios --path <the .ipa>` (uploads through Expo, and the first time creates the app on App Store Connect for you), or
- Apple's **Transporter** app (Mac App Store): drag the `.ipa` in and click **Deliver**. For this route, first create the app in App Store Connect yourself: **Apps > + > New App**, with the bundle id `com.fdsimms.franki`.

If App Store Connect says the name "Franki" is taken, register it as something like "Franki Flashcards"; the home screen still shows "Franki". Apple processes an upload in 10 to 30 minutes. Then add yourself to an internal testing group in App Store Connect's **TestFlight** tab and install from the TestFlight app. TestFlight builds stop working 90 days after upload, so upload a fresh one before then.

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
