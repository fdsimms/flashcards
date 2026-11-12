import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { toolById } from '../tools/tools';
import { useApp } from '../ui/AppContext';
import { TOOL_SCREENS } from '../ui/tools';

/** One Practice tool, named by the `id` parameter. */
export default function ToolRoute() {
  const { repo } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const tool = toolById(id);
  if (!tool) return null;
  const { Screen } = TOOL_SCREENS[tool.id];
  return <Screen tool={tool} repo={repo} />;
}
