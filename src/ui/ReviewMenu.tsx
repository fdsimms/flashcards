import { Stack } from 'expo-router';
import React from 'react';
import { FLAG_NAMES } from '../core/cardState';

/**
 * The "…" menu of Review's header: what can be done to the card on screen besides answering it,
 * in groups (hold back, ask Claude and cram, mnemonic and a confusing word to link, flag, reschedule, info). Flag is a submenu with the card's current
 * color checked, so choosing one doesn't open a second sheet. Forget is the destructive one: it
 * clears the card's memory (and asks first). Each of them, and a flag, can be taken back with Undo
 * (Review's `actions`), as an answer can.
 * Show answer timing, last, times each answer on this phone (useAnswerTiming.ts).
 *
 * A plain function called inside `<Stack.Toolbar>`, not a component to render there: the toolbar keeps only
 * its own Button, Menu, Spacer and View children and silently drops any other element, so `<ReviewMenu />`
 * left the whole menu off the header.
 */
export function reviewMenu({ flag, cramOn, onCram, onAskClaude, onMnemonic, onLinkConfused, onFlag, onAgentFlag, onBuryCard, onBuryNote, onSuspend, onSuspendNote, onDueDate, onForget, onCardInfo, timingOn, onTiming, onSettings }: {
  /** The card's flag, 0 for none. */
  flag: number;
  /** Whether the card is marked to come back a few more times this session (src/core/miniCram.ts). */
  cramOn: boolean;
  /** Marks or unmarks the card for a mini cram; missing for a card that can't (a skill card, which has its own drill). */
  onCram?: () => void;
  /** Opens Ask Claude for the card on screen. */
  onAskClaude: () => void;
  /** Write a mnemonic for the word; missing when the card's note can't take one (`canAddMnemonic`). */
  onMnemonic?: () => void;
  /** Link the word to one it's mixed up with (src/core/confusedPairs.ts); missing when the note can't be linked (`canLinkConfused`). */
  onLinkConfused?: () => void;
  onFlag: (flag: number) => void;
  onAgentFlag: () => void;
  onBuryCard: () => void;
  onBuryNote: () => void;
  onSuspend: () => void;
  /** Suspends every card of the note still studied (Anki's Suspend note). */
  onSuspendNote: () => void;
  onDueDate: () => void;
  onForget: () => void;
  onCardInfo: () => void;
  /** Whether Review shows how long each answer took to bring up the next card. */
  timingOn: boolean;
  onTiming: () => void;
  /** Opens Settings, Decks and cards: answer buttons, swiping, Thai text size, furigana. */
  onSettings: () => void;
}) {
  return (
    <Stack.Toolbar.Menu icon="ellipsis.circle" accessibilityLabel="More for this card: bury, suspend, ask Claude, cram, mnemonic, a confusing word to link, flag, reschedule, card info or card settings">
      {/* Bury holds a card back until the next study day; Bury note does it to every card of the note; Suspend until it's unsuspended, and Suspend note every card of the note. First, since they're the most used. */}
      <Stack.Toolbar.Menu inline>
        <Stack.Toolbar.MenuAction icon="eye.slash" onPress={onBuryCard}>Bury card</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="eye.slash" onPress={onBuryNote}>Bury note</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="pause.circle" onPress={onSuspend}>Suspend card</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="pause.circle" onPress={onSuspendNote}>Suspend note</Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
      <Stack.Toolbar.Menu inline>
        <Stack.Toolbar.MenuAction icon="sparkles" onPress={onAskClaude}>Ask Claude</Stack.Toolbar.MenuAction>
        {onCram ? <Stack.Toolbar.MenuAction icon="repeat" isOn={cramOn} onPress={onCram}>Cram this card</Stack.Toolbar.MenuAction> : null}
      </Stack.Toolbar.Menu>
      {/* Offered for the hard words, not every card, so it lives here and not in the header, which stays at four buttons. */}
      {onMnemonic || onLinkConfused ? (
        <Stack.Toolbar.Menu inline>
          {onMnemonic ? <Stack.Toolbar.MenuAction icon="lightbulb" onPress={onMnemonic}>Write a mnemonic</Stack.Toolbar.MenuAction> : null}
          {onLinkConfused ? <Stack.Toolbar.MenuAction icon="arrow.left.arrow.right" onPress={onLinkConfused}>Link a confusing word</Stack.Toolbar.MenuAction> : null}
        </Stack.Toolbar.Menu>
      ) : null}
      <Stack.Toolbar.Menu inline>
        <Stack.Toolbar.Menu title="Flag" icon="flag">
          {FLAG_NAMES.slice(1).map((name, i) => (
            <Stack.Toolbar.MenuAction key={name} isOn={flag === i + 1} onPress={() => onFlag(i + 1)}>{name}</Stack.Toolbar.MenuAction>
          ))}
          {flag ? <Stack.Toolbar.MenuAction icon="flag.slash" onPress={() => onFlag(0)}>Remove flag</Stack.Toolbar.MenuAction> : null}
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.MenuAction icon="sparkles" onPress={onAgentFlag}>Flag for Claude to check</Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
      <Stack.Toolbar.Menu inline>
        <Stack.Toolbar.MenuAction icon="calendar" onPress={onDueDate}>Set due date</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="arrow.counterclockwise" destructive onPress={onForget}>Forget card</Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
      <Stack.Toolbar.Menu inline>
        <Stack.Toolbar.MenuAction icon="info.circle" onPress={onCardInfo}>Card info</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="stopwatch" isOn={timingOn} onPress={onTiming}>Show answer timing</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="gearshape" onPress={onSettings}>Card settings</Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar.Menu>
  );
}
