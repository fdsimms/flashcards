import React, { useCallback, useState } from 'react';
import { ActionSheetIOS } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { Api, PastText } from '../../reader/api';
import { pastMeta } from '../../reader/browse';
import { prefs } from '../../reader/storage';
import { listenAgainPlay } from '../../reader/relisten';
import { useApp } from '../AppContext';
import { Reveal } from '../motion';
import { Cover, CoverRow, useCoverTint } from './Cover';

/**
 * The home's Hear again row: finished texts due to be heard again (server relisten.py), one to
 * three, offered once 3 study days after each was read, or three times at 1, 4 and 10 days, or not
 * at all (Settings, Read & Listen, Hear texts again). A cover plays that text with the words
 * hidden; Play plays them all one after another, the first listen of each counted when it's heard
 * through. Pressing and holding a cover offers Not now, which hides the row until the screen is opened again. Nothing
 * here grades a card or counts as a reading.
 */
export function ReadListenAgain({ api, onPlay }: { api: Api; onPlay: (texts: PastText[]) => void }) {
  const { reader } = useApp();
  const [texts, setTexts] = useState<PastText[]>([]);
  const [hidden, setHidden] = useState(false);

  // Asked each time the home comes into view, so a text just heard through drops off the row. A
  // server that can't be reached, or an older one with no such route, just shows no row.
  useFocusEffect(useCallback(() => {
    let live = true;
    setHidden(false);
    // Read here, each time the home shows, so changing the setting takes effect on return.
    const wanted = prefs().listenAgain;
    if (wanted === 0) setTexts([]);
    else api.relisten(wanted).then((due) => { if (live) setTexts(due); }, () => { if (live) setTexts([]); });
    return () => { live = false; };
  }, [api]));

  if (hidden || texts.length === 0) return null;
  const now = new Date();
  return (
    <Reveal>
      <CoverRow title="Hear again" action={{ label: listenAgainPlay(texts.length), accessibilityLabel: `${listenAgainPlay(texts.length)}, with the words hidden`, onPress: () => onPlay(texts) }}>
        {texts.map((t) => <HearAgainCover key={t.id} text={t} meta={pastMeta({ read_at: t.read_at, rating: null }, now, reader.dayStartsAtHour)} onPlay={() => onPlay([t])} onHide={() => ActionSheetIOS.showActionSheetWithOptions(
          { title: 'Hear again', message: 'Not now hides these until you come back to this screen.', options: ['Not now', 'Cancel'], cancelButtonIndex: 1 },
          (i) => { if (i === 0) setHidden(true); },
        )} />)}
      </CoverRow>
    </Reveal>
  );
}

function HearAgainCover({ text, meta, onPlay, onHide }: { text: PastText; meta: string; onPlay: () => void; onHide: () => void }) {
  return (
    <Cover
      tint={useCoverTint(text.id)}
      kind="Words hidden"
      title={text.title}
      meta={meta}
      onPress={onPlay}
      onLongPress={onHide}
      accessibilityLabel={`${text.title}. ${meta}. Plays with the words hidden. Press and hold for Not now.`}
    />
  );
}
