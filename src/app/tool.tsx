import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { toolById } from '../tools/tools';
import { useApp } from '../ui/AppContext';
import { TOOL_SCREENS } from '../ui/tools';

/** One Practice tool, named by the `id` parameter; the others go to the tool (a grammar drill's `points`). */
export default function ToolRoute() {
  const router = useRouter();
  const { repo, reader } = useApp();
  const { id, ...params } = useLocalSearchParams<{ id: string; points?: string }>();
  const tool = toolById(id);
  if (!tool) return null;
  const { Screen } = TOOL_SCREENS[tool.id];
  return <Screen tool={tool} repo={repo} readerApi={reader.api} params={params} onClose={() => router.back()} />;
}
