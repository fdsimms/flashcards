import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { noteLanguageOfDeck } from '../core/cards';
import { failureText } from '../core/failure';
import type { Language } from '../reader/api';
import { LANGUAGES, languageNamed } from '../reader/languages';
import { useApp } from './AppContext';
import { openFirstWords, startFromZero } from './fromZeroActions';
import { setFromZeroNewPerDay } from './fromZeroDeck';
import { useFromZero } from './fromZeroStorage';
import { haptic } from './haptics';
import { Button, EmptyState, Help } from './kit';
import { importWordList, wordListCount, wordListSummary } from '../anki/wordListService';
import { refreshFromKeptCollection } from '../anki/transfer';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * A deck with no cards yet (just made in Franki): what to do next, in place of "All caught up" on
 * Today and "All done for now" in the deck. Add words opens Quick add on the deck; Import a word list
 * reads a .csv or .txt file into it (`importWordList`), in the deck's language. In a language Read & Listen
 * has, Start from zero comes first (src/core/fromZero.ts): the most common words, a few a day, how the
 * language sounds, and lessons until there are enough words for texts.
 */
export function EmptyDeckCard({ deck }: { deck: string }) {
  const router = useRouter();
  const { repo, refresh, reader } = useApp();
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  // The deck's language as Read & Listen names it: its own setting, else read from its name.
  const [language, setLanguage] = useState<Language | undefined>();
  const started = useFromZero().some((z) => z.deck === deck);
  useEffect(() => {
    let live = true;
    repo.listDeckSettings().then((all) => {
      const named = all.get(deck)?.noteLanguage ?? noteLanguageOfDeck(deck);
      const code = named ? languageNamed(named) : undefined;
      if (live) setLanguage(code && code !== 'en' ? code : undefined);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [repo, deck]);
  const api = reader.api;

  const start = async () => {
    if (!api || !language || starting) return;
    setStarting(true);
    try {
      reader.setSettings(await startFromZero(api, () => setFromZeroNewPerDay(repo, deck), deck, language));
      await refresh();
      openFirstWords(router, deck, language);
    } catch (e) {
      Alert.alert("Couldn't start from zero", failureText(e, { next: 'Try again in a moment.' }));
    } finally {
      setStarting(false);
    }
  };
  const confirmStart = () => {
    if (!language) return;
    const current = reader.settings?.decks[language];
    if (!current || current === deck) return void start();
    const name = LANGUAGES[language].name;
    Alert.alert(`Use ${deck} for ${name}?`, `Read & Listen uses ${current} for ${name} now. Starting from zero makes it ${deck}, so its suggested words, lessons and texts come from this deck.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Start', onPress: () => void start() },
    ]);
  };
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
      const result = await importWordList(repo, await new File(res.assets[0].uri).text(), name, {
        deck: { name: deck, noteLanguage: own?.noteLanguage, askBothWays: own?.askBothWays },
        refresh: () => refreshFromKeptCollection(repo),
      });
      haptic.success();
      await refresh();
      const shown = result.warnings.slice(0, 5);
      const more = result.warnings.length - shown.length;
      Alert.alert(`Imported ${plural(wordListCount(result), 'word', 'words')}`, [wordListSummary(name, result), ...shown, ...(more > 0 ? [`and ${plural(more, 'more warning', 'more warnings')}`] : [])].join('\n\n'));
    } catch (e) {
      Alert.alert(`Couldn't import ${name}`, failureText(e, { next: 'Try again.' }));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <EmptyState icon="plus.rectangle.on.rectangle" title="Add your first words" body={`${deck} has no cards yet. Type a few words with their meanings, e.g. hola - hello. Each one becomes a card to study today.`}>
      {api && language ? (
        <>
          {started
            ? <Button label="Pick your first words" onPress={() => openFirstWords(router, deck, language)} />
            : <Button label="Start from zero" onPress={confirmStart} busy={starting} />}
          <Help>{started
            ? "They're added once you've checked them in Words to add."
            : `Franki picks the most common ${LANGUAGES[language].name} words, starts you on how it sounds, and makes your first lessons.`}</Help>
        </>
      ) : null}
      <Button variant={api && language ? 'secondary' : 'primary'} label="Add words" onPress={() => router.push({ pathname: '/quick-add', params: { deck } })} />
      <Button variant="secondary" label="Import a word list" onPress={() => void importList()} busy={busy} />
      <Help>A word list is a .csv or .txt file with a word and its meaning on each line.</Help>
    </EmptyState>
  );
}
