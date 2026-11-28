import React from 'react';
import { quietEndsText, startQuiet } from '../core/quietMode';
import { Banner } from './kit';
import { Reveal } from './motion';
import { saveQuiet, useQuiet } from './quietPrefs';
import { chooseQuietLength } from './quietSheet';
import { useTheme } from './theme';
import { useStudyToday } from './vacationPrefs';

/** Today's card while Quiet mode is on (src/core/quietMode.ts). A tap changes its length or turns it off. */
export function QuietCard() {
  const c = useTheme();
  const { prefs, active } = useQuiet();
  const { dayStartsAtHour } = useStudyToday();
  if (!prefs || !active) return null;
  return (
    <Reveal>
      <Banner
        icon="speaker.slash.fill"
        iconColor={c.accent}
        title={`Quiet mode is on ${quietEndsText(prefs, new Date())}`}
        hint="Listening cards are set aside and nothing plays. Tap to change."
        onPress={() => chooseQuietLength({ active, onStart: (choice) => saveQuiet(startQuiet(choice, new Date(), dayStartsAtHour)), onOff: () => saveQuiet(null) })}
        accessibilityHint="Opens the choices for Quiet mode"
      />
    </Reveal>
  );
}
