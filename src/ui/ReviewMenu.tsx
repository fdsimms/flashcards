import { Stack } from 'expo-router';
import React from 'react';
import { FLAG_NAMES } from '../core/cardState';

/**
 * The "…" menu of Review's header: what can be done to the card on screen besides answering it,
 * in four groups (flag, hold back, reschedule, info). Flag is a submenu with the card's current
 * color checked, so choosing one doesn't open a second sheet. Forget is the destructive one: it
 * clears the card's memory (and asks first), where Suspend and Bury can be undone in the note editor.
 */
export function ReviewMenu({ flag, onFlag, onAgentFlag, onBuryCard, onBuryNote, onSuspend, onDueDate, onForget, onCardInfo }: {
  /** The card's flag, 0 for none. */
  flag: number;
  onFlag: (flag: number) => void;
  onAgentFlag: () => void;
  onBuryCard: () => void;
  onBuryNote: () => void;
  onSuspend: () => void;
  onDueDate: () => void;
  onForget: () => void;
  onCardInfo: () => void;
}) {
  return (
    <Stack.Toolbar.Menu icon="ellipsis.circle" accessibilityLabel="More for this card: flag, bury, suspend, reschedule or card info">
      <Stack.Toolbar.Menu inline>
        <Stack.Toolbar.Menu title="Flag" icon="flag">
          {FLAG_NAMES.slice(1).map((name, i) => (
            <Stack.Toolbar.MenuAction key={name} isOn={flag === i + 1} onPress={() => onFlag(i + 1)}>{name}</Stack.Toolbar.MenuAction>
          ))}
          {flag ? <Stack.Toolbar.MenuAction icon="flag.slash" onPress={() => onFlag(0)}>Remove flag</Stack.Toolbar.MenuAction> : null}
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.MenuAction icon="sparkles" onPress={onAgentFlag}>Flag for Claude to check</Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
      {/* Bury holds a card back until the next study day; Bury note does it to every card of the note; Suspend until it's unsuspended. */}
      <Stack.Toolbar.Menu inline>
        <Stack.Toolbar.MenuAction icon="eye.slash" onPress={onBuryCard}>Bury card</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="eye.slash" onPress={onBuryNote}>Bury note</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="pause.circle" onPress={onSuspend}>Suspend card</Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
      <Stack.Toolbar.Menu inline>
        <Stack.Toolbar.MenuAction icon="calendar" onPress={onDueDate}>Set due date</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="arrow.counterclockwise" destructive onPress={onForget}>Forget card</Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
      <Stack.Toolbar.MenuAction icon="info.circle" onPress={onCardInfo}>Card info</Stack.Toolbar.MenuAction>
    </Stack.Toolbar.Menu>
  );
}
