import { ActionSheetIOS } from 'react-native';
import { AGENT_FLAG_REASONS, type AgentFlagReason } from '../core/agentFlag';

/**
 * The "Flag for an agent" sheet, shared by Review's menu and Trouble cards so both ask the same
 * way: a reason, or Remove flag when the card already has the purple flag. `onPick` gets the
 * reason's slug, or null for Remove flag; Cancel calls nothing.
 */
export function chooseAgentFlagReason(flagged: boolean, onPick: (reason: AgentFlagReason | null) => void) {
  const options = [...AGENT_FLAG_REASONS.map((r) => r.label), ...(flagged ? ['Remove flag'] : []), 'Cancel'];
  ActionSheetIOS.showActionSheetWithOptions({
    title: 'Flag for an agent',
    message: 'An agent can find this card through the Franki MCP, check it and suggest a fix. It uses the purple flag.',
    options, cancelButtonIndex: options.length - 1,
  }, (i) => {
    if (i === options.length - 1) return;
    onPick(i < AGENT_FLAG_REASONS.length ? AGENT_FLAG_REASONS[i].slug : null);
  });
}
