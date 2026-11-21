import React, { useState } from 'react';
import { ActionSheetIOS, Alert, ScrollView, Text } from 'react-native';
import { failureText } from '../core/failure';
import { LANGUAGES } from '../reader/languages';
import { LANGUAGE_MODES, modeOf, TURNS_PER_DAY, FOCUS_EXTRAS, type ExtraPrefs, type LanguageMode } from '../tools/extras';
import { useApp } from './AppContext';
import { haptic } from './haptics';
import { Group, Help, Loading, NavRow, Screen, SectionTitle, Segments, SwitchRow } from './kit';
import { space, type, useTheme, readable } from './theme';
import { useDailyExtras } from './useDailyExtras';

const MODE_LABEL: Record<LanguageMode, string> = { always: 'Always', turns: 'Takes turns', off: 'Off' };
const MODE_HELP: Record<LanguageMode, string> = {
  always: `${FOCUS_EXTRAS} extras every day`,
  turns: 'One extra on its turn',
  off: 'No extras',
};

/**
 * Settings, Daily extras: whether Today suggests drills and texts each day, which
 * languages always get them (focus languages) and which take turns (src/tools/extras.ts), and
 * what today's list is. This phone's own settings; nothing here changes when a card is due.
 */
export function DailyExtrasSettings() {
  const c = useTheme();
  const { reader } = useApp();
  const extras = useDailyExtras();
  const { prefs, languages, turns, items } = extras;
  // Why an extra tapped below couldn't open, as Today's strip says it.
  const [problem, setProblem] = useState<string>();

  const save = async (next: ExtraPrefs) => {
    try {
      await extras.savePrefs(next);
    } catch (e) {
      Alert.alert("Couldn't save this setting", failureText(e, { next: 'Try again.' }));
    }
  };

  const chooseMode = (prefs: ExtraPrefs, language: keyof typeof LANGUAGES) => {
    haptic.tap();
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: LANGUAGES[language].name,
        options: [...LANGUAGE_MODES.map((m) => `${MODE_LABEL[m]}: ${MODE_HELP[m]}`), 'Cancel'],
        cancelButtonIndex: LANGUAGE_MODES.length,
      },
      (i) => {
        const mode = LANGUAGE_MODES[i];
        if (mode) save({ ...prefs, modes: { ...prefs.modes, [language]: mode } });
      },
    );
  };

  return (
    <Screen title="Daily extras" largeTitle={false}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l, gap: space.m }}>
        {!prefs ? <Loading /> : (
          <>
            <Group>
              <SwitchRow
                first
                label="Suggest extras each day"
                hint="Short drills from the Practice tab and a text to read, picked from what you've missed lately. They don't change when your cards are due."
                value={prefs.on}
                onValueChange={(on) => save({ ...prefs, on })}
              />
            </Group>
            {prefs.on ? (
              <>
                <SectionTitle>Languages that take a turn each day</SectionTitle>
                <Segments
                  options={TURNS_PER_DAY.map((n) => ({ value: n, label: String(n) }))}
                  value={prefs.turnsPerDay}
                  onChange={(turnsPerDay) => { haptic.select(); save({ ...prefs, turnsPerDay }); }}
                />
                <Help>
                  {`A language set to Always gets ${FOCUS_EXTRAS} extras every day. The rest take turns: the one practiced longest ago goes first, and if you skip a day it's offered again.`}
                </Help>

                <SectionTitle>Languages</SectionTitle>
                {languages.length ? (
                  <Group>
                    {languages.map((l, i) => (
                      <NavRow key={l} first={i === 0} label={LANGUAGES[l].name} detail={MODE_LABEL[modeOf(prefs, l)]} onPress={() => chooseMode(prefs, l)} />
                    ))}
                  </Group>
                ) : (
                  <Help>Turn on Read & Listen (Settings, Read & Listen) and the languages you study appear here.</Help>
                )}
                {turns.length > 0 ? (
                  <Help>{`Next in line for a turn: ${turns.map((l) => LANGUAGES[l].name).join(', ')}.`}</Help>
                ) : null}

                <SectionTitle>What's suggested</SectionTitle>
                <Group>
                  <SwitchRow first label="Drills from the Practice tab" hint="Counting things and reading the script, whichever you've missed most." value={prefs.drills} onValueChange={(drills) => save({ ...prefs, drills })} />
                  <SwitchRow
                    label="A text to read"
                    hint={reader.api ? 'Opens Read & Listen in that language.' : 'Needs Read & Listen, which is off.'}
                    value={prefs.read}
                    onValueChange={(read) => save({ ...prefs, read })}
                  />
                </Group>

                <SectionTitle>Today</SectionTitle>
                {items.length ? (
                  <Group>
                    {items.map((item, i) => (
                      <NavRow
                        key={`${item.extra.language}|${item.extra.kind}`}
                        first={i === 0}
                        icon={item.done ? { name: 'checkmark.circle.fill', color: c.countDue } : undefined}
                        label={item.title}
                        detail={item.detail}
                        onPress={async () => { setProblem(await extras.open(item.extra)); }}
                      />
                    ))}
                  </Group>
                ) : (
                  <Text style={{ ...type.subhead, color: c.textSecondary }}>Nothing is planned for today.</Text>
                )}
                {problem ? <Text style={{ ...type.footnote, color: c.danger }}>{problem}</Text> : null}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
