import type { SFSymbol } from 'expo-symbols';
import type React from 'react';
import type { Repo } from '../../db/repo';
import type { ToolId, ToolInfo } from '../../tools/tools';
import type { Colors } from '../theme';
import { DateTool } from './DateTool';
import { MoneyTool } from './MoneyTool';
import { TimeTool } from './TimeTool';

/** What every tool's screen is given. */
export interface ToolScreenProps {
  tool: ToolInfo;
  repo: Repo;
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
};
