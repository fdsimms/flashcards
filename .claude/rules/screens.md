---
paths:
  - "src/ui/**"
  - "src/app/**"
---

# Screens and styling

Moved out of `CLAUDE.md`, verbatim, so it loads only with the code it governs (see "Rules that
load by path" there). A comment that cites "CLAUDE.md" for one of these sections means this file.

## Screens and styling

- **Build screens from `src/ui/kit.tsx`** (`Screen`, `Group`, `NavRow`, `Button`, `Card`, `Help`,
  `Count`, `MessageList`) before styling a `Pressable` or a box by hand, so a row or a button
  looks the same everywhere. Icons are SF Symbols (`Icon`), never a text glyph or an emoji (`›`, `✓`,
  `🔊`), which draw at the wrong weight and size next to the system's. A button or chip is a
  `Tappable`, not a hand-styled `Pressable`, so it gives under the finger, and a tap gives back a
  haptic (`haptic`).
- **A row or tile a screen builds from a raw `Pressable` is a `HoverPressable`** (`src/ui/hover.tsx`), so it gets the iPad and Mac pointer effect: `highlight` for a row (the default), `hover="lift"` for a tile or a choice button. The `kit.tsx` controls already have it. Leave a plain `Pressable` where an effect would be noise: a backdrop that dismisses, a tap anywhere on a card to reveal it, a word in a sentence, a chart bar.
- **The header is the native stack's, never drawn by a screen.** `Screen` sets the title and
  header buttons; a ScrollView directly inside it takes `contentInsetAdjustmentBehavior="automatic"`
  so the large title collapses. Never pad a screen's top or bottom by a fixed number: the status
  bar and Dynamic Island differ by iPhone, and a hard-coded 56 put headers under them.
- **A header item is a `Stack.Toolbar.Button` or `Menu`, never a component of your own.** `Stack.Toolbar` drops any other child without an error, so `<ReviewMenu />` left Review's whole menu off the header. Build it in a plain function called inside the toolbar (`reviewMenu(props)`), or let a component return its own `<Stack.Toolbar placement>` (`LessonLanguageMenu`). `tests/noCustomToolbarChildren.test.ts` fails the build on one.
- **A sound a screen starts waits for `useOutputWake` first** (`src/ui/useOutputWake.ts`): Bluetooth headphones that have been quiet lose the first half second of it, all of a word. A sound that follows straight on from another doesn't wait. `tests/noUnwokenPlay.test.ts` fails the build on a file that plays without it.
- **Every color, gap, corner and text size comes from `src/ui/theme.ts`** (`useTheme()`, `space`,
  `radius`, `type`). `tests/noRawColors.test.ts` fails the build on a hex color in a screen; add a
  token with a light and a dark value instead. Text grows with the system text size, so a box
  holding text gets padding or a `minHeight`, never a fixed `height`. Words take the ink tokens,
  not the fills: `goodInk`, `danger` or `warningInk` rather than a rating color
  (`tests/noRatingColorText.test.ts`), and `accentInk` for gold text on `accentFill`.
- **A border that marks a state keeps one width in every state**, clear when off, so picking or answering doesn't shift the box's text. A quiz's answer choice spreads `answerLook` (`kit.tsx`), which does this. `tests/noShiftingBorder.test.ts` fails the build on a `borderWidth` chosen by a condition outside its list.
- **A reading drawn as a bar is `Meter`, and a failure is `ErrorNote`** (both `kit.tsx`), never a hand-built bar or a bare red line; a red line is for what to fix in what was typed. `tests/noHandBuiltMeter.test.ts` and `tests/noBareFailureLine.test.ts` fail the build on either.
- **Mock up a proposed UI change before building it, so the owner can see it.** There are no
  screen tests and no renderer, so a description in prose isn't something they can react to. For a
  new screen, a layout change or a change to how a card or row is presented, publish a small HTML
  mock as an Artifact (dark and light, at phone width, with the real strings from the screenshot or
  the code) and ask which direction to take. Use the values from `src/ui/theme.ts` so the mock
  looks like the app, and for a choice between layouts show the options side by side. Build in
  the app only after they've picked. Skip it for a change too small to need one (a label, a
  spacing value, a color token). It covers how a screen moves and responds too (an animation, a
  swipe, a native control): where a mock can't show the change, describe each one in a line and
  ask before building, and keep one change in feel per PR, so a rejected one doesn't take the rest
  with it. The PR body says `Mock: <shown and picked>` or `Mock: skipped, <why>`.

## Settings

- **Every setting is reachable from Settings and from its own page's gear.** `src/core/settingsPages.ts` lists the pages (one per tab) and one entry per setting, which is what Settings' search reads; `src/ui/SettingsPage.tsx` holds a page's rows, `src/app/settings-page.tsx` (`?page=lessons`) opens it, and each tab's header has the same `gearshape` button pushing it. A setting added to a page or to Settings gets an entry there, and a control that belongs to one tab (Lessons' narrator) lives on that tab's settings page, not on the tab.
