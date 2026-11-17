import React from 'react';
import { ScrollView } from 'react-native';
import type { Repo } from '../db/repo';
import type { Api } from '../reader/api';
import { TOOLS, type ToolInfo } from '../tools/tools';
import { useConnectionProblem } from './connection';
import { Group, NavRow, Screen } from './kit';
import { Reveal } from './motion';
import { space, useTheme, readable } from './theme';
import { TOOL_SCREENS } from './tools';
import { useGrammarDue } from './useGrammarDue';

/** The Practice tab: small drills outside the decks (src/tools/tools.ts), one row each. */
export function Practice({ onOpen, readerApi, repo }: { onOpen: (tool: ToolInfo) => void; readerApi: Api | null; repo: Repo }) {
  const c = useTheme();
  const grammarDue = useGrammarDue(readerApi, repo);
  const problem = useConnectionProblem();
  return (
    <Screen title="Practice">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        <Group>
          {TOOLS.map((tool, i) => {
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
                detail={!off ? (tool.id === 'grammar' && grammarDue?.total ? `${grammarDue.total} due today. ${tool.summary}` : tool.summary) : !readerApi ? 'Off. Turn on Read & Listen in Settings to use it.' : problem === 'offline' ? "Needs a connection. Back when you're online." : "Can't reach your server right now. Back when it answers."}
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
