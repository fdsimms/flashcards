import React, { useState } from 'react';
import { ActionSheetIOS, Linking } from 'react-native';
import type { WaniKaniProblem } from '../wanikani/api';
import { offlineText } from '../wanikani/offline';
import { droppedLine } from '../wanikani/prefs';
import { levelLine, stagesLabel } from '../wanikani/stats';
import { DeckRowView } from './DeckList';
import { Group, SwipeAction, SwipeToReveal } from './kit';
import { StageBar } from './WaniKaniStageBar';
import type { WaniKaniState } from './useWaniKani';

/** The line under the name when the last read failed: short, since Options says the rest. */
const PROBLEM_LINE: Record<WaniKaniProblem, string> = {
  unauthorized: "WaniKani didn't accept the token",
  forbidden: "This token can't send answers",
  rateLimited: 'Too many requests to WaniKani. Try again in a minute.',
  rejected: "WaniKani didn't take an answer",
  unavailable: "Couldn't reach WaniKani",
};

/**
 * WaniKani in the deck list: one more deck, after the Anki ones, with its reviews as due and
 * today's lessons as new, a bar of its items by stage, and its stats from the menu. Swipe for Options, as on any deck; the menu also opens wanikani.com.
 */
export function WaniKaniDeck({ wanikani, onOpen, onOptions, onStats }: { wanikani: WaniKaniState; onOpen: () => void; onOptions: () => void; onStats: () => void }) {
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
    : { text: (wanikani.user ? `${levelLine(wanikani.user.level, wanikani.stats?.progress ?? null)}${wanikani.user.onVacation ? ', on vacation' : ''}` : 'Loading…') + unsent };
  const menu = () => {
    const options = ['Stats', 'Options', 'Open wanikani.com', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'WaniKani', options, cancelButtonIndex: 3 }, (i) => {
      if (i === 0) onStats();
      if (i === 1) onOptions();
      if (i === 2) Linking.openURL('https://www.wanikani.com/dashboard').catch(() => undefined);
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
          // Reserves the room the Anki rows keep for the show/hide button, so the counts line up with theirs.
          toggleSlot
          detail={detail}
          menuHint="Stats, options, or open wanikani.com"
          below={wanikani.stats ? <StageBar stages={wanikani.stats.stages} /> : undefined}
          belowLabel={wanikani.stats ? stagesLabel(wanikani.stats.stages) : undefined}
          onOpen={() => (open ? setOpen(false) : onOpen())}
          onMenu={menu}
        />
      </SwipeToReveal>
    </Group>
  );
}
