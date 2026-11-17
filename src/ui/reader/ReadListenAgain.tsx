import React, { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { Api, PastText } from '../../reader/api';
import { prefs } from '../../reader/storage';
import { listenAgainCard } from '../../reader/relisten';
import { useApp } from '../AppContext';
import { Button, Card, HeaderAction } from '../kit';
import { Reveal } from '../motion';
import { space, type, useTheme } from '../theme';

/**
 * The shelf's card for finished texts due to be heard again (`listenAgainCard`, server relisten.py):
 * one to three, offered once 3 study days after each was read, or three times at 1, 4 and 10 days,
 * or not at all (Settings, Read & Listen, Hear texts again). Play runs them one after
 * another with the words hidden, the first listen of each counted when it's heard through. Not now
 * hides it until the shelf is opened again. Nothing here grades a card or counts as a reading.
 */
export function ReadListenAgain({ api, onPlay }: { api: Api; onPlay: (texts: PastText[]) => void }) {
  const c = useTheme();
  const { reader } = useApp();
  const [texts, setTexts] = useState<PastText[]>([]);
  const [hidden, setHidden] = useState(false);

  // Asked each time the shelf comes into view, so a text just heard through drops off the card. A
  // server that can't be reached, or an older one with no such route, just shows no card.
  useFocusEffect(useCallback(() => {
    let live = true;
    setHidden(false);
    // Read here, each time the shelf shows, so changing the setting takes effect on return.
    const wanted = prefs().listenAgain;
    if (wanted === 0) setTexts([]);
    else api.relisten(wanted).then((due) => { if (live) setTexts(due); }, () => { if (live) setTexts([]); });
    return () => { live = false; };
  }, [api]));

  const card = hidden ? null : listenAgainCard(texts, new Date(), reader.dayStartsAtHour);
  if (!card) return null;
  return (
    <Reveal>
      <Card style={{ gap: space.s }}>
        <Text accessibilityRole="header" style={{ ...type.headline, color: c.text }}>{card.title}</Text>
        <Text style={{ ...type.footnote, color: c.textSecondary }}>{card.detail}</Text>
        <Button label={card.play} onPress={() => onPlay(texts)} />
        <HeaderAction label="Not now" onPress={() => setHidden(true)} />
      </Card>
    </Reveal>
  );
}
