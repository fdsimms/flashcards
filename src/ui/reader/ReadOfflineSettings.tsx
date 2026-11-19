import React, { useState } from 'react';
import { Alert, Text } from 'react-native';
import { usageText } from '../../reader/downloads';
import type { OfflineDownloads } from '../../reader/prefs';
import { prefs, savePrefs } from '../../reader/storage';
import { Button, Help, SectionTitle, Segments } from '../kit';
import { downloadNow } from './ShelfDownloads';
import { downloads, useDownloads } from './readerDownloads';
import { type, useTheme } from '../theme';

/**
 * Settings, Read & Listen, Download for offline (src/reader/downloads.ts): when the shelf's texts
 * download by themselves, what's on the phone, and a way to clear it.
 */
export function ReadOfflineSettings() {
  const c = useTheme();
  const kept = useDownloads();
  const [setting, setSetting] = useState(prefs().offlineDownloads);
  const any = kept.texts.length > 0 || kept.lessons.length > 0;

  const choose = (next: OfflineDownloads) => {
    savePrefs({ offlineDownloads: next });
    setSetting(next);
    downloadNow();
  };

  const removeAll = () => Alert.alert('Remove everything from this iPhone?', `${usageText(kept)} Texts and the pinned series' next episode download again as the setting says, and lessons when you tap Download.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => downloads.clear() },
  ]);

  return (
    <>
      <SectionTitle>Download for offline</SectionTitle>
      <Segments<OfflineDownloads>
        options={[{ value: 'wifi', label: 'Wi-Fi only' }, { value: 'any', label: 'Any connection' }, { value: 'off', label: 'Off' }]}
        value={setting}
        onChange={choose}
      />
      <Help>
        {"Your texts and the pinned series' next episode are saved on this iPhone with their audio as soon as they're ready, so you can read and listen with no connection. A text is removed once you've read it. This setting is for those automatic downloads. A text you start playing is saved too, on any connection unless this is Off, so it keeps playing if you lose signal. A lesson you tap Download on asks first when you're on cellular, unless this is set to Any connection."}
      </Help>
      <Text style={{ ...type.subhead, color: c.text }}>{usageText(kept)}</Text>
      {any ? <Button label="Remove all from this iPhone" variant="destructive" onPress={removeAll} /> : null}
    </>
  );
}
