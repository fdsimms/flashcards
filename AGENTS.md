This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npm run verify              # typecheck + tests + git status (the loop to run before committing)
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

There is no lint config. Run `npm run verify` before declaring any task done.

## Navigation & Routing

- There is no router yet: `App.tsx` switches between its screens (decks, review, Anki, sync, stats, settings, backup, deck options) with a `Screen` union. Don't assume `src/app/` routes exist.
- If navigation outgrows that (stack history, deep links, tabs), **Expo Router** is the one to adopt, with routes in `src/app/` and non-route code outside it. Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- `modules/anki-unicase` is a local Expo module (C and Swift, iOS only) that autolinking picks up; changing it needs a rebuild like any native code.
- This app doesn't use Expo Go: it runs in a development build (`expo-dev-client`) built on the owner's Mac with `npm run ios:device` (`npx expo run:ios --device`). After adding a library with native code, that build has to be rerun before the new code can load; say so in the PR.
- **Builds run locally, never on Expo's servers.** Release builds are `npm run build:ios` (`eas build --local`); don't suggest cloud `eas build` or `npx testflight`, which builds in the cloud.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
