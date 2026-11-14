import React from 'react';
import { ScrollView } from 'react-native';
import type { Api } from '../reader/api';
import { TOOLS, type ToolInfo } from '../tools/tools';
import { Group, NavRow, Screen } from './kit';
import { space, useTheme } from './theme';
import { TOOL_SCREENS } from './tools';
import { useGrammarAvailable } from './tools/useGrammarAvailable';

/** The Practice tab: small drills outside the decks (src/tools/tools.ts), one row each. */
export function Practice({ onOpen, readerApi }: { onOpen: (tool: ToolInfo) => void; readerApi: Api | null }) {
  const c = useTheme();
  const grammar = useGrammarAvailable(readerApi);
  return (
    <Screen title="Practice">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        <Group>
          {TOOLS.map((tool, i) => {
            // Grammar, Sentences and Situations need Read & Listen's server.
            const needsServer = tool.id === 'sentences' || tool.id === 'situations';
            const off = (tool.id === 'grammar' && grammar.available === false) || (needsServer && !readerApi);
            return (
              <NavRow
                key={tool.id}
                first={i === 0}
                icon={{ name: TOOL_SCREENS[tool.id].icon, color: TOOL_SCREENS[tool.id].color(c) }}
                label={tool.title}
                detail={!off ? tool.summary : needsServer ? 'Off. Turn on Read & Listen in Settings to use it.' : grammar.reason ?? tool.summary}
                disabled={off}
                onPress={() => onOpen(tool)}
              />
            );
          })}
        </Group>
      </ScrollView>
    </Screen>
  );
}
