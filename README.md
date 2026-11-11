# flashcards

A small personal spaced-repetition app (React Native + Expo) built for language vocab and trivia, with import from Anki.

- **Scheduling:** FSRS via [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs)
- **Storage:** `expo-sqlite` (on-device)
- **Audio:** `expo-speech` (on-device TTS, language picked from the note's `Language` field or deck name)
- **Cards:** field-based, plain-text rendering. Omnilanguage notes produce a forward card, plus reverse / audio cards gated on `GenerateReverse` / `GenerateAudioCard`. Any other note type renders Front/Back (or its first two fields).

## Run it

```bash
npm install
npx expo start      # scan the QR code with Expo Go on your iPhone
npm test            # scheduler, card, queue and importer tests
npm run typecheck
```

## Importing from Anki

1. **TSV** — the "Notes in Plain Text" export (with `#` header lines), including your Omnilanguage TSVs. Uses `#columns` / `#tags column` / `#deck` when present, otherwise the Omnilanguage field order in `src/import/models.ts`.
2. **JSON** — AnkiConnect-style `{ notes: notesInfo[], cards: cardsInfo[], collectionCreated }`. Carries over interval, ease → difficulty, due date, lapses and suspension. If `memoryState` (FSRS stability/difficulty) is present on a card it is used instead of the ease-based estimate. `collectionCreated` (unix seconds) is needed to turn Anki's day-offset `due` into a real date.

Re-importing never resets cards that have already been reviewed here.

## Layout

```
src/core     types, FSRS wrapper, queue, card rendering (pure TS, unit-tested)
src/import   TSV + Anki JSON importers
src/db       Repo interface, in-memory repo (tests), SQLite repo (app)
src/ui       deck list, review, import screens
tests/       vitest
```

## Not built yet

Adding/editing cards in-app, stats, media/audio files from Anki (`[sound:]` tags are stripped; TTS is used instead), sync, `.apkg` parsing.
