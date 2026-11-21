import React from 'react';
import { Stack } from 'expo-router';
import { ScrollView } from 'react-native';
import type { Repo } from '../db/repo';
import type { Api } from '../reader/api';
import { LANGUAGES, flaggedName } from '../reader/languages';
import { TOOLS, TOOL_LANGUAGES, type ToolInfo } from '../tools/tools';
import { FLAG_IMAGES } from './flagImages';
import { useConnectionProblem } from './connection';
import { Group, NavRow, Screen } from './kit';
import { Reveal } from './motion';
import { space, useTheme, readable } from './theme';
import { TOOL_SCREENS } from './tools';
import { useGrammarDue } from './useGrammarDue';
import { usePracticeLanguage } from './usePracticeLanguage';

/** The Practice tab: small drills outside the decks (src/tools/tools.ts), one row each. */
export function Practice({ onOpen, onCram, onSettings, readerApi, repo }: { onOpen: (tool: ToolInfo) => void; onCram: () => void; onSettings: () => void; readerApi: Api | null; repo: Repo }) {
  const c = useTheme();
  const grammarDue = useGrammarDue(readerApi, repo);
  const problem = useConnectionProblem();
  const [language, setLanguage] = usePracticeLanguage();
  const name = LANGUAGES[language].name;
  // The list is in one language, so its Grammar row counts that language's due points only.
  const grammarDueHere = grammarDue?.languages.find((d) => d.language === language)?.count ?? 0;
  return (
    <Screen
      title="Practice"
      toolbar={(
        <>
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Menu icon={FLAG_IMAGES[language]} iconRenderingMode="original" accessibilityLabel={`Language: ${name}. Change the language`}>
            {TOOL_LANGUAGES.map((l) => (
              <Stack.Toolbar.MenuAction key={l} isOn={l === language} onPress={() => setLanguage(l)}>{flaggedName(l)}</Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="gearshape" accessibilityLabel="Practice settings" onPress={onSettings} />
        </Stack.Toolbar>
        </>
      )}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        {/* Crams are about the decks' own words, in any language, so they sit apart from the tools. */}
        <Group>
          <NavRow first icon={{ name: 'calendar', color: c.accent }} label="Cram" detail="Plan and practice for a day coming up, like a lesson with a tutor." onPress={onCram} />
        </Group>
        <Group>
          {/* A tool that doesn't come in the chosen language isn't listed. */}
          {TOOLS.filter((tool) => tool.languages.includes(language)).map((tool, i) => {
            // Grammar, Sentences and Situations need Read & Listen's server, so they're off while it can't be reached.
            const needsServer = tool.id === 'sentences' || tool.id === 'situations' || tool.id === 'grammar';
            const off = needsServer && (!readerApi || !!problem);
            // The rows settle in one after another the first time the tab opens.
            return (
              <Reveal key={tool.id} delay={i * 30}>
              <NavRow
                first={i === 0}
                icon={{ name: TOOL_SCREENS[tool.id].icon, color: TOOL_SCREENS[tool.id].color(c) }}
                label={tool.title}
                detail={!off ?(tool.id === 'grammar' && grammarDueHere ? `${grammarDueHere} due today. ${tool.summary}` : tool.summary) : !readerApi ? 'Uses Read & Listen. Turn it on in Settings, Read & Listen.' : problem === 'offline' ? "Available when you're back online." : 'Available when your server answers.'}
                disabled={off}
                onPress={() => onOpen(tool)}
              />
              </Reveal>
            );
          })}
        </Group>
      </ScrollView>
    </Screen>
  );
}
