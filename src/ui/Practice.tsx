import React from 'react';
import { ScrollView } from 'react-native';
import { TOOLS, type ToolInfo } from '../tools/tools';
import { Group, NavRow, Screen } from './kit';
import { space, useTheme } from './theme';
import { TOOL_SCREENS } from './tools';

/** The Practice tab: small drills outside the decks (src/tools/tools.ts), one row each. */
export function Practice({ onOpen }: { onOpen: (tool: ToolInfo) => void }) {
  const c = useTheme();
  return (
    <Screen title="Practice">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        <Group>
          {TOOLS.map((tool, i) => (
            <NavRow
              key={tool.id}
              first={i === 0}
              icon={{ name: TOOL_SCREENS[tool.id].icon, color: TOOL_SCREENS[tool.id].color(c) }}
              label={tool.title}
              detail={tool.summary}
              onPress={() => onOpen(tool)}
            />
          ))}
        </Group>
      </ScrollView>
    </Screen>
  );
}
