# Franki

A small personal spaced-repetition app (React Native + Expo) built for language vocab and trivia, with import from Anki. The repo is still called `flashcards`; the app is Franki.

- **Scheduling:** FSRS via [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs), with each deck's FSRS weights, desired retention and daily limits carried over from Anki
- **Storage:** `expo-sqlite`, on the device only, with backup and restore through Files / iCloud Drive
- **Anki:** works on your real Anki collection, handed back and forth with AnkiMobile as a file, every answer written into it as Anki would
- **Audio:** each note's recorded audio from Anki (`expo-audio`), else `expo-speech` (on-device TTS, language picked from the note's `Language` field or deck name). Plays with the silent switch on.
- **Cards:** Omnilanguage notes render natively, playing the recording in their `Audio` field (or TTS when there's none): a front card (unless `SuppressFrontCard`), plus reverse / audio cards gated on `GenerateReverse` / `GenerateAudioCard`. Every other note type renders its own Anki templates and CSS in a WebView, with its images and sounds, one card per Anki card (cloze included).
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

## Moving between Anki and Franki

Franki works on your real Anki collection, handed back and forth as a file. Everything happens on the phone, with AnkiMobile.

**Bring it in:** in AnkiMobile, tap the button at the bottom left of the deck list, choose **Export**, pick **Collection** with media included, and save it to Files. In Franki, tap **Anki**, then **Choose file**, and pick it. Franki keeps the whole collection: every note and card with its scheduling and FSRS memory state, each deck's limits and FSRS settings, each note type's templates and styling, the images and sounds, and all of Anki's review history.

**Study in Franki.** Every answer is written into that collection the way Anki would write it.

**Send it back:** in Franki's **Anki** screen, tap **Send to Anki** and open the file in AnkiMobile (from the share sheet, or save it to Files and import it in AnkiMobile). AnkiMobile replaces its collection with this one, which now holds every answer you gave in Franki; then sync Anki as usual. The deck list says how many answers aren't in Anki yet.

One app holds the collection at a time: don't study in AnkiMobile between bringing the collection into Franki and sending it back, or those answers are replaced. Importing again into Franki warns you first if Franki has answers that haven't gone back to Anki.

Franki also imports Anki's "Notes in Plain Text" export (.txt or .tsv). Those cards start as new and stay in Franki only. Uses `#columns` / `#tags column` / `#deck` when present, otherwise the Omnilanguage field order in `src/import/models.ts`.

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
src/anki     Anki collection packages: reading, writing answers back, packing
tests/       vitest, mirroring src/; tests/fixtures/anki holds a collection and package Anki wrote
```

The study day starts at 4 AM, as in Anki, so a late-night session counts toward the day before. Rules for working in the repo are in `CLAUDE.md`.

## Not built yet

Typing the answer (`{{type:}}` shows the answer on the back instead), Anki's own TTS tags (`{{tts:}}`), collapsing decks, adding/editing cards in-app, stats, and syncing with Anki automatically through your own sync server (planned: until then, the collection moves by file).
