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
export function Practice({ onOpen, onCram, readerApi, repo }: { onOpen: (tool: ToolInfo) => void; onCram: () => void; readerApi: Api | null; repo: Repo }) {
  const c = useTheme();
  const grammarDue = useGrammarDue(readerApi, repo);
  const problem = useConnectionProblem();
  const [language, setLanguage] = usePracticeLanguage();
  const name = LANGUAGES[language].name;
  return (
    <Screen
      title="Practice"
      toolbar={(
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Menu icon={FLAG_IMAGES[language]} iconRenderingMode="original" accessibilityLabel={`Language: ${name}. Change the language`}>
            {TOOL_LANGUAGES.map((l) => (
              <Stack.Toolbar.MenuAction key={l} isOn={l === language} onPress={() => setLanguage(l)}>{flaggedName(l)}</Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      )}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        {/* Crams are about the decks' own words, in any language, so they sit apart from the tools. */}
        <Group>
          <NavRow first icon={{ name: 'calendar', color: c.accent }} label="Cram" detail="Practice words for a day coming up, like a lesson with a tutor." onPress={onCram} />
        </Group>
        <Group>
          {TOOLS.map((tool, i) => {
            // Grammar, Sentences and Situations need Read & Listen's server, so they're off while it can't be reached.
            const needsServer = tool.id === 'sentences' || tool.id === 'situations' || tool.id === 'grammar';
            const notOffered = !tool.languages.includes(language);
            const off = notOffered || (needsServer && (!readerApi || !!problem));
            // The rows settle in one after another the first time the tab opens.
            return (
              <Reveal key={tool.id} delay={i * 30}>
              <NavRow
                first={i === 0}
                icon={{ name: TOOL_SCREENS[tool.id].icon, color: TOOL_SCREENS[tool.id].color(c) }}
                label={tool.title}
                detail={notOffered ? `Not in ${name}.` : !off ? (tool.id === 'grammar' && grammarDue?.total ? `${grammarDue.total} due today. ${tool.summary}` : tool.summary) : !readerApi ? 'Off. Turn on Read & Listen in Settings to use it.' : problem === 'offline' ? "Needs a connection. Back when you're online." : "Can't reach your server right now. Back when it answers."}
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
