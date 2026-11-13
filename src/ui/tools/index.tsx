import type { SFSymbol } from 'expo-symbols';
import type React from 'react';
import type { Repo } from '../../db/repo';
import type { Api } from '../../reader/api';
import type { ToolId, ToolInfo } from '../../tools/tools';
import type { Colors } from '../theme';
import { CountingTool } from './CountingTool';
import { DateTool } from './DateTool';
import { MoneyTool } from './MoneyTool';
import { NumbersTool } from './NumbersTool';
import { GrammarTool } from './GrammarTool';
import { TimeTool } from './TimeTool';

/** What every tool's screen is given. */
export interface ToolScreenProps {
  tool: ToolInfo;
  repo: Repo;
  /** Read & Listen's server, for a tool that needs it (Grammar); null while Read & Listen is off. */
  readerApi: Api | null;
  /** The route's parameters past `id`, such as the points a grammar drill opens on. */
  params: Record<string, string | undefined>;
  /** Leaves the tool, as Back does. */
  onClose: () => void;
}

/**
 * Each tool's screen and its icon in the Practice list, by id. Keyed by every `ToolId`, so a tool
 * added to src/tools/tools.ts doesn't typecheck until it has a screen here.
 */
export const TOOL_SCREENS: Record<ToolId, {
  Screen: React.ComponentType<ToolScreenProps>;
  icon: SFSymbol;
  /** The icon tile's color: a theme color white reads on, as NavRow asks. */
  color: (c: Colors) => string;
}> = {
  time: { Screen: TimeTool, icon: 'clock.fill', color: (c) => c.easy },
  dates: { Screen: DateTool, icon: 'calendar', color: (c) => c.again },
  money: { Screen: MoneyTool, icon: 'banknote.fill', color: (c) => c.good },
  numbers: { Screen: NumbersTool, icon: 'number', color: (c) => c.orange },
  counting: { Screen: CountingTool, icon: 'square.stack.3d.up.fill', color: (c) => c.teal },
  grammar: { Screen: GrammarTool, icon: 'text.book.closed.fill', color: (c) => c.violet },
};
