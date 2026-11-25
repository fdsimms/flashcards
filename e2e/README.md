# End-to-end tests

[Maestro](https://maestro.dev) flows that drive the real app in an iOS simulator. Vitest has no
component renderer, so a screen that never opens or a tap that does nothing passes every unit test;
these cover that. Nothing here runs in CI: a simulator needs macOS, and macOS runners use Actions
minutes about ten times as fast as Linux ones.

| Flow | Checks |
|---|---|
| `maestro/make-deck.yaml` | A fresh install opens, the Decks tab offers "Make a deck", and a deck made there is listed |

Selectors are visible text and accessibility labels. Renaming one a flow taps breaks the flow.

Not reachable from a simulator: the Listening Activity, a real microphone, and anything that needs
the sync server or Read & Listen's server (the flows run offline, on a fresh install).

## Setup on the Mac

- Xcode with an iOS simulator runtime installed, and the command line tools selected.
- Node 22, then `npm install` in this repo.
- Java 17+ and [Maestro](https://docs.maestro.dev/getting-started/installing-maestro).

## Running

```bash
e2e/run.sh                     # boot a simulator, build a Release build, run every flow
E2E_SIMULATOR="iPhone 17" e2e/run.sh
```

The first build takes several minutes; later ones reuse `ios/`. Results land in `e2e/out/`
(gitignored): `report.xml` and, for each flow, screenshots under `debug/`. `maestro studio`
opens an inspector for finding a selector.
