import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { answerTimer, clockText } from '../core/session';
import type { DeckParams } from '../core/types';
import { type, useTheme } from './theme';

/**
 * The answer timer beside Review's counts, for a deck whose preset has Anki's "Show answer timer"
 * on: how long this card has been up, stopping at the preset's maximum answer seconds in the danger
 * color, and at Show answer when the preset says so (`answerTimer`). Key it to the showing, so each
 * card, and a card shown again, starts from 0:00.
 */
export function AnswerTimer({ revealed, params }: { revealed: boolean; params: Pick<DeckParams, 'maxAnswerSecs' | 'stopTimerOnAnswer'> | undefined }) {
  const c = useTheme();
  const shownAt = useRef(Date.now());
  const revealedAt = useRef<number | undefined>(undefined);
  if (revealed && revealedAt.current === undefined) revealedAt.current = Date.now();
  const [now, setNow] = useState(() => Date.now());
  const reading = answerTimer(shownAt.current, now, revealedAt.current, params);
  const stopped = reading.capped || (!!params?.stopTimerOnAnswer && revealed);
  useEffect(() => {
    if (stopped) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [stopped]);
  return (
    <Text
      accessibilityLabel={`${reading.secs} seconds on this card`}
      style={{ ...type.footnote, fontVariant: ['tabular-nums'], color: reading.capped ? c.danger : c.textSecondary, alignSelf: 'center' }}
    >
      {clockText(reading.secs)}
    </Text>
  );
}
