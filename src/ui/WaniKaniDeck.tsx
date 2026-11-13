import React, { useState } from 'react';
import { ActionSheetIOS, Linking } from 'react-native';
import type { WaniKaniProblem } from '../wanikani/api';
import { offlineText } from '../wanikani/offline';
import { droppedLine } from '../wanikani/prefs';
import { DeckRowView } from './DeckList';
import { Group, SwipeAction, SwipeToReveal } from './kit';
import type { WaniKaniState } from './useWaniKani';

/** The line under the name when the last read failed: short, since Options says the rest. */
const PROBLEM_LINE: Record<WaniKaniProblem, string> = {
  unauthorized: "WaniKani didn't accept the token",
  forbidden: "This token can't send answers",
  rateLimited: 'WaniKani asked to slow down',
  rejected: "WaniKani didn't take an answer",
  unavailable: "Couldn't reach WaniKani",
};

/**
 * WaniKani in the deck list: one more deck, after the Anki ones, with its reviews as due and
 * today's lessons as new. Swipe for Options, as on any deck; the menu also opens wanikani.com.
 */
export function WaniKaniDeck({ wanikani, onOpen, onOptions }: { wanikani: WaniKaniState; onOpen: () => void; onOptions: () => void }) {
  const [open, setOpen] = useState(false);
  const due = wanikani.counts?.reviews ?? 0;
  const fresh = wanikani.counts?.lessons ?? 0;
  const unsent = wanikani.unsent ? `, ${wanikani.unsent} ${wanikani.unsent === 1 ? "answer isn't" : "answers aren't"} sent yet` : '';
  const saved = wanikani.offlineSavedAt;
  const detail = wanikani.offline
    ? { text: wanikani.unsent ? `Offline. ${wanikani.unsent} ${wanikani.unsent === 1 ? 'answer' : 'answers'} will be sent when WaniKani can be reached` : saved ? offlineText(saved, new Date(), wanikani.dayStartsAtHour) : 'Offline. Studying from the last copy' }
    : wanikani.problem
    ? { text: PROBLEM_LINE[wanikani.problem] + unsent, warning: true }
    // Shown until the review screen has said it in full (it marks them seen there).
    : wanikani.dropped
    ? { text: droppedLine(wanikani.dropped), warning: true }
    : { text: (wanikani.user ? `Level ${wanikani.user.level}${wanikani.user.onVacation ? ', on vacation' : ''}` : 'Loading…') + unsent };
  const menu = () => {
    const options = ['Options', 'Open wanikani.com', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'WaniKani', options, cancelButtonIndex: 2 }, (i) => {
      if (i === 0) onOptions();
      if (i === 1) Linking.openURL('https://www.wanikani.com/dashboard').catch(() => undefined);
    });
  };
  return (
    <Group>
      <SwipeToReveal
        open={open}
        onOpenChange={setOpen}
        action={<SwipeAction icon="gearshape" label="Options" accessibilityLabel="Options for WaniKani" onPress={() => { setOpen(false); onOptions(); }} />}
      >
        <DeckRowView
          row={{ deck: 'WaniKani', name: 'WaniKani', depth: 0, due, fresh, total: 0, unstudied: 0, hasSubdecks: false, collapsed: false }}
          first
          detail={detail}
          menuHint="Options, or open wanikani.com"
          onOpen={() => (open ? setOpen(false) : onOpen())}
          onMenu={menu}
        />
      </SwipeToReveal>
    </Group>
  );
}
