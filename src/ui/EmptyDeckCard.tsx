import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Alert, Text } from 'react-native';
import { failureText } from '../core/failure';
import { useApp } from './AppContext';
import { haptic } from './haptics';
import { Button, Card, Help, Icon } from './kit';
import { space, type, useTheme } from './theme';
import { importWordList } from './wordListImport';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * A deck with no cards yet (just made in Franki): what to do next, in place of "All caught up" on
 * Today and "All done for now" in the deck. Add words opens Quick add on the deck; Import a word list
 * reads a .csv or .txt file into it (`importWordList`), in the deck's language.
 */
export function EmptyDeckCard({ deck }: { deck: string }) {
  const c = useTheme();
  const router = useRouter();
  const { repo, refresh } = useApp();
  const [busy, setBusy] = useState(false);
  // A second tap while a file is being read would import it twice.
  const running = useRef(false);

  const importList = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    let name = 'the file';
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (res.canceled) return;
      name = res.assets[0].name;
      if (!/\.(csv|tsv|txt)$/i.test(name)) {
        Alert.alert(`Couldn't import ${name}`, 'A word list is a .csv or .txt file. To bring in an Anki deck or collection, use Settings, Anki.');
        return;
      }
      const own = (await repo.listDeckSettings()).get(deck);
      const result = await importWordList(repo, await new File(res.assets[0].uri).text(), name, { name: deck, noteLanguage: own?.noteLanguage, askBothWays: own?.askBothWays });
      haptic.success();
      await refresh();
      const shown = result.warnings.slice(0, 5);
      const more = result.warnings.length - shown.length;
      Alert.alert(`Imported ${plural(result.notes.length, 'word', 'words')}`, [...shown, ...(more > 0 ? [`and ${plural(more, 'more warning', 'more warnings')}`] : [])].join('\n\n') || undefined);
    } catch (e) {
      Alert.alert(`Couldn't import ${name}`, failureText(e, { next: 'Try again.' }));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <Card style={{ alignItems: 'center', paddingVertical: space.xl, gap: space.s }}>
      <Icon name="plus.rectangle.on.rectangle" size={40} color={c.textTertiary} weight="regular" />
      <Text style={{ ...type.title, color: c.text, marginTop: space.s, textAlign: 'center' }}>Add your first words</Text>
      <Text style={{ ...type.subhead, color: c.textSecondary, lineHeight: 21, textAlign: 'center', marginBottom: space.m }}>
        {`${deck} has no cards yet. Type a few words with their meanings, e.g. hola - hello. Each one becomes a card to study today.`}
      </Text>
      <Button label="Add words" onPress={() => router.push({ pathname: '/quick-add', params: { deck } })} style={{ alignSelf: 'stretch' }} />
      <Button variant="secondary" label="Import a word list" onPress={() => void importList()} busy={busy} style={{ alignSelf: 'stretch' }} />
      <Help>A word list is a .csv or .txt file with a word and its meaning on each line.</Help>
    </Card>
  );
}
