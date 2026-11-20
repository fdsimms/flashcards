---
paths:
  - "src/core/**"
  - "src/db/**"
  - "src/anki/writeback.ts"
  - "src/anki/deckStats.ts"
  - "src/ui/Review*.tsx"
  - "src/ui/DeckList.tsx"
  - "src/ui/DeckOptions.tsx"
  - "src/ui/CustomStudy.tsx"
  - "src/ui/Vacation.tsx"
  - "src/wanikani/**"
  - "tests/core/**"
  - "tests/db/**"
---

# Scheduling: FSRS, the queue, limits, undo

Moved out of `CLAUDE.md`, verbatim, so it loads only with the code it governs (see "Rules that
load by path" there). A comment that cites "CLAUDE.md" for one of these sections means this file.

## Scheduling

FSRS via `ts-fsrs`, wrapped in `src/core/scheduler.ts`; a card's whole FSRS state is `Card.sched`,
with dates as ISO strings. **A Review-state card is due for its whole study day** (its due instant
carries the time of day it was last answered); **a Learning/Relearning card is due at its exact
instant** (`isDue` in `src/core/queue.ts`). Once nothing else is left, learning cards come up to
the collection's learn-ahead limit early, and the review screen waits for the next one rather
than declaring the deck done.

**Learning steps are Anki's, applied on top of FSRS** (`stepOutcome` in `scheduler.ts`, from
rslib's states/steps.rs): the ts-fsrs engines run with no steps, for the memory state and
intervals, because ts-fsrs's own steps graduate a card on a step of a day or more and give Hard a
different delay. **FSRS counts the days since the
last answer as Anki does** (`daysSinceLastReview`): to the end of today's study day, never ts-fsrs's
own count between UTC dates, which made a step across UTC midnight a day's wait. Each deck's preset steps apply, else Anki's defaults. A
relearning card keeps the interval its lapse gave it (`relearnDays`), as Anki's does. A step crossing into a
later day is Anki's queue 3 (`isInterdayLearning`); its answers count as reviews and use the
review limit. **Leeches** follow the preset (`becameLeech`): tagged, suspended if it says so. **The
tag comes off once the word has recovered** (`leechRecovered`, `src/core/leechRecovery.ts`): every
studied card of the note is an unsuspended review scheduled `LEECH_RECOVERED_DAYS` (21) or more out.
Anki never removes it; Franki does because its Leeches filter, Trouble and cram read the tag as a
live signal. Undo puts the tag back (`leechClearedNoteId`).

**Fuzz and the load balancer are Anki's, bit for bit** (`src/core/ankiFuzz.ts`, `loadBalance.ts`):
the ts-fsrs engines don't fuzz; intervals get Anki's fuzz from Rust's StdRng (ChaCha12) seeded by
the Anki card id plus reps before the answer, in f32 as Anki computes them, or the load balancer's
day from a snapshot taken when the session is built. `tests/fixtures/anki/fuzz-vectors.json` holds
outputs recorded from the real `anki` package; a change here has to keep matching them.

**Each deck schedules with its Anki preset's FSRS weights and desired retention** (`DeckParams`,
read from the collection's deck options when it's imported). `paramsForDeck` falls back to
the nearest ancestor deck, then to the `ts-fsrs` defaults. Every `review`/`previewIntervals` call
passes the deck's params; one that doesn't silently schedules with the defaults.

**Daily limits are per deck, from its Anki preset** (`DeckParams.newPerDay` / `reviewsPerDay`, or
a today-only limit from Custom Study on its day), with `NEW_PER_DAY` / `REVIEWS_PER_DAY` in
`src/core/config.ts` only for a deck that has none.

**A study session is built as Anki's v3 scheduler builds it** (`treeQueue` in
`src/core/deckTree.ts`, orders in `src/core/order.ts`; each rule's source in rslib is named where
it's implemented). Limits form a tree from the deck opened down: a card in Polski::Odmiana counts
against Odmiana's limit and Polski's when Polski is opened, but Polski's limits don't apply when
Odmiana is opened unless the collection's "apply all parent limits" is on. New cards studied today
also use review room, unless "new cards ignore review limit" is on. Steps within the day are never
limited. The preset's gather, sort, review and mix orders decide the order (Anki's new-card
position for new cards). A card is always scheduled with **its own home** deck's settings
(`cardHomeDeck`), never the parent being studied, and is studied in the deck it's in
(`cardDeck`): an Anki filtered deck takes its cards out of their home decks.

**A session keeps the order its queue started in** (`keepSessionOrder`, `src/core/session.ts`, used by
`Review`). The screen rebuilds the queue after every answer, and the mix spaces new cards by how many
cards are left, so rebuilt from scratch the card on top is a new one only once fewer reviews remain than
new cards (150 reviews came before the first). Anki builds the queue once and pops from it; the rebuild
keeps each queued card's place, drops what left, and puts a card that wasn't queued before after the
card ahead of it in the rebuilt order. Learning steps around the mixed stretch (`Queue.main`) are timed
and always come from the rebuild.

**Today's counts include answers given on every device** (`studiedToday` in `src/core/queue.ts`):
Anki's cards are counted from the kept collection's review log, which holds answers synced from
AnkiMobile and Anki as well as Franki's own, and only Franki-only cards from Franki's table.
Counting Franki's table alone offered new cards already studied in Anki that day. **A card Anki
buried today is held back until the next study day** (`isBuried`, from the card's `mod` when it
was imported); one buried on an earlier day is studied, as Anki unburies at each new day. **Answering
in Franki buries siblings as Anki does** (`siblingsToBury`, by the answered card's own preset's
Burying options), in Franki's tables and in the kept collection in the answer's own transaction
(queue -2), and undo restores them with the answer.

**Counts shown in two places come from one function.** The deck list (`deckRows`) and the review
screen both call `treeQueue`, with input from `queueInput`, so a deck never says "20 new" and then
opens with none. (Anki's own deck list counts a sibling its queue then buries, so with sibling
burying on Franki's list can show fewer than Anki's; the queues match.) A check that
predicts what another code path will do calls that code path's function; don't write a lookalike.
Anything that leaves cards out goes in through `queueInput` too, for both: lookalikes of a word just
seen (`heldCards`, `src/core/lookalikes.ts`) are loaded by `loadHeld` for the deck list and by
`useReviewForms` in Review, and a card held in one but not the other shows a count the deck can't open with.

**A progress gate limits a deck's new cards by what's in progress** (`DeckSettings.gateCap`, set on
Deck options): new cards come in only while fewer than the cap are in progress in that deck and its
subdecks, and never more in a day than the gated deck's own daily new limit (`gateBudget`, so
turning a gate on doesn't release the whole cap at once); the daily new limits of decks under it
don't apply, and Custom Study's extra new cards are refused there. **In progress is read from the card's
current FSRS schedule every time, never stored** (`isInProgress`, `src/core/progress.ts`): started,
and not yet a Review scheduled `GURU_INTERVAL_DAYS` (7, WaniKani's Guru interval) or more out. So a
card that drops back under a week (a lapse, a shorter interval) counts again at once. Counting
correct answers instead was tried and dropped: FSRS spaces reviews too fast for "four right in a
row" to track how well a card is known. A gate on a deck above the one
opened still applies, so the review screen loads every card, not just the opened subtree.
`DeckSettings` is the app's own and an import never writes it; `DeckParams` is Anki's and every
import replaces it. A setting the user makes here goes in the first, with two exceptions. **The gate
itself**: for a deck the kept collection has, `gateCap` is kept in the collection (one config value,
`frankiProgressGates`, deck id to cap; `src/anki/progressGates.ts`), so a sync carries it and the
MCP's `set_progress_gate` can set it. Anki keeps the value but never applies it, as Franki's queue
does. `listDeckSettings` applies it over the phone's row without the lock, and `saveDeckSettings`
writes it there under the lock; a deck Anki doesn't have, and a gate saved before this moved, stay
in the phone's row until the next read moves them. **The new card order** (Deck options) is the Anki
preset's own option: `setNewCardOrder` writes it into the kept collection first, as every deck on that
preset and every device must agree, and sync sends it (`deckConfigJson`).

**Vacation mode changes what's offered, never a schedule** (`src/core/vacation.ts`, Settings, Vacation mode): Light scales
each deck's daily limits (new cards to a count, reviews to a share) and puts reviews weakest first
(`relativeOverdueness`); Paused offers nothing. It enters through `queueInput`, so the deck list and
the review screen agree, and the setting is the phone's own (Keychain), never written to Anki. Nothing
shifts a due date or adds a review: FSRS must see the real time since each review. After it ends the
weakest-first order stays while a review that came due before the end still waits (`CATCH_UP_DAYS`).

**A cram moves due dates by itself, and only ever earlier** (`src/core/cram.ts`, Practice,
Cram): until a running cram's day, a review of one of its words (or a day-long learning step) isn't
put off past that day. Review
passes `capDays` to `review`, which shortens the interval after fuzz and balancing (so the buttons,
the stored interval and the revlog agree), and `capCramCards` moves reviews already scheduled later
with Set Due Date (memory state kept, a Manual revlog entry, as Anki writes; one at a time, and
never a review with no last answer, whose memory state Set Due Date would make up). FSRS still sees the
real time between reviews; it just gets one sooner. A cram's rounds are practice: their Missed it /
Got it stay in the cram (`cramRound.ts` imports nothing that schedules, `tests/core/cramRound.test.ts`).

**Undo restores the card as it was and deletes the review row** (`AnswerRecord` in
`src/core/session.ts`), and today's counts go back down by the same rule they went up
(`bumpStudied`). The undone card is shown next. As in Anki, undo stops at the last sync: a synced
answer is already in the server's history (`undoAnkiAnswer` refuses it, under `lockAnki`).

**Producing an answer is practice, never a rating.** Type it on a reverse card and the hook asked
on a new word's first answer (`src/core/activeRecall.ts`), Similar words (`src/tools/mixups.ts`)
Read & Listen's Say it back and Write what you hear, and what Claude checks (Use today's words,
Sentences, Retell it, Situations: `server/reader/.../production.py`, `situations.py`) compare what was typed
(`src/core/typedCompare.ts`) or correct it, but leave the rating to the learner: nothing feeds FSRS
but the answer button pressed. A spoken answer is compared as typing is, the recognizer's guess closest
to the answer taken (`bestHeard`), since telling homophones apart is the recognizer's job; the phone
hears what was said, not how.

**A miss reason is a reminder, never an input to scheduling.** Again's menu (`src/core/misses.ts`)
saves what went wrong in the answer's own review row (`ReviewLogEntry.miss`), which is why undo
takes it back with the answer. The "Last time" line is read from those rows each time, never
stored. Nothing in `src/core/scheduler.ts` or the queue may read it, and it isn't written into the
Anki collection.

**A confused-word link is practice, never an input to scheduling.** Words linked as mixed up
(`src/core/confusedPairs.ts`, the `confused_pairs` table) are shown on the answer side and asked in
Similar words. Nothing in `src/core/scheduler.ts`, the queue or the lookalike hold may read them, and
they aren't written into the Anki collection.
