import { Stack, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ScrollView } from 'react-native';
import { DECK_OPTIONS_LIST, SETTINGS_PAGES, searchSettings, type SettingsEntry } from '../core/settingsPages';
import type { Repo } from '../db/repo';
import { useFontSettings } from './AppFont';
import { fontOption } from '../core/fonts';
import { Group, Help, NavRow, Screen, SectionTitle } from './kit';
import { space, useTheme, readable } from './theme';

/**
 * Every setting, from one place. The screens that aren't about one page (Anki, Backup, WaniKani),
 * then one row per page (the same page the gear in that tab's header opens), then each deck's
 * options (a list of decks, the same options as a deck's own menu opens), then what applies
 * everywhere (font, voices, speaking). Typing in the search bar lists the settings that match, each
 * opening the screen or page it's on (`src/core/settingsPages.ts`).
 */
export function Settings({ repo, backupText, wanikaniOn, onAnki, onBackup, onWaniKani, onVoices, onSpeaking, onFont, onPage, onOpen }: {
  repo: Repo;
  /** When the last backup was made (`backupStatus`). */
  backupText?: string;
  /** Whether WaniKani has a token. */
  wanikaniOn: boolean;
  onWaniKani: () => void;
  onAnki: () => void;
  onBackup: () => void;
  onVoices: () => void;
  onSpeaking: () => void;
  onFont: () => void;
  /** Opens one page's settings. */
  onPage: (page: string) => void;
  /** Opens a screen by its route. */
  onOpen: (route: string) => void;
}) {
  const c = useTheme();
  const [speaking, setSpeaking] = useState<boolean>();
  const [query, setQuery] = useState('');
  const { settings: fontSettings, font: shownFont } = useFontSettings();
  // Read each time Settings shows: it's changed on the screen over this one.
  useFocusEffect(useCallback(() => {
    repo.answerBySpeaking().then(setSpeaking).catch(() => undefined);
  }, [repo]));

  const found = searchSettings(query);
  const open = (e: SettingsEntry) => (e.route ? onOpen(e.route) : onPage(e.page));
  const pageTitle = (e: SettingsEntry) => (e.page === 'settings' ? 'Settings' : e.page === 'deck' ? 'Deck options' : SETTINGS_PAGES.find((p) => p.id === e.page)?.title);

  return (
    <Screen title="Settings">
      <Stack.SearchBar placeholder="Search settings" autoCapitalize="none" onChangeText={(e) => setQuery(e.nativeEvent.text)} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        {query.trim() ? (
          found.length ? (
            <Group>
              {found.map((e, i) => <NavRow key={e.id} first={i === 0} label={e.label} detail={pageTitle(e)} onPress={() => open(e)} />)}
            </Group>
          ) : <Help>No setting matches "{query.trim()}".</Help>
        ) : (
          <>
            <Group>
              {/* Tile colors are picked so white reads on them in light and dark, and none is a rating color, which would read as a warning. */}
              <NavRow first icon={{ name: 'arrow.triangle.2.circlepath', color: c.easy }} label="Anki" detail="Sync, or send your collection to and from Anki by file" onPress={onAnki} />
              <NavRow icon={{ name: 'externaldrive.fill', color: c.teal }} label="Backup" detail={backupText ?? 'Save or restore everything in Franki'} onPress={onBackup} />
              <NavRow icon={{ name: 'character.ja', color: c.violet }} label="WaniKani" detail={wanikaniOn ? 'On' : 'Off. Study your WaniKani reviews and lessons as a deck'} onPress={onWaniKani} />
            </Group>
            <SectionTitle>By page</SectionTitle>
            <Group>
              {SETTINGS_PAGES.map((p, i) => <NavRow key={p.id} first={i === 0} label={p.title} detail={p.summary} onPress={() => onPage(p.id)} />)}
            </Group>
            <SectionTitle>By deck</SectionTitle>
            <Group>
              <NavRow first label="Deck options" detail="Skill cards, cards in progress, new cards, fonts and more, for each deck" onPress={() => onOpen(DECK_OPTIONS_LIST)} />
            </Group>
            <SectionTitle>Everywhere</SectionTitle>
            <Group>
              <NavRow first label="Font" detail={fontSettings.random ? 'A different one each time the app opens' : fontOption(shownFont).label} onPress={onFont} />
              <NavRow label="Voices" detail="The voices each language is recorded and read aloud with" onPress={onVoices} />
              <NavRow label="Speaking" loading={speaking === undefined} detail={speaking === undefined ? undefined : speaking ? 'On. Answer by speaking' : 'Off. Answer by speaking instead of typing'} onPress={onSpeaking} />
            </Group>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
