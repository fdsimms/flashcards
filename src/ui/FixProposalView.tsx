import React from 'react';
import { Text, View } from 'react-native';
import type { FixProposal } from '../core/fixCard';
import { htmlToText } from '../core/html';
import { radius, smooth, space, type, useTheme } from './theme';

/**
 * A fix Claude suggested, as the learner approves it: why, then each changed field with the old text
 * above the new, and how many changes were left out for touching a recording or image. Shared by the
 * flag sheet's Fix with Claude now and Ask Claude's Change the card; the buttons are the sheet's own.
 */
export function FixProposalView({ proposal }: { proposal: FixProposal }) {
  const c = useTheme();
  return (
    <>
      {proposal.explanation ? <Text style={{ ...type.callout, color: c.textSecondary }}>{proposal.explanation}</Text> : null}
      {proposal.changes.map((ch) => {
        const before = htmlToText(ch.before);
        const after = htmlToText(ch.after);
        // A change to markup only reads the same as text, so show the HTML itself.
        const same = before === after;
        return (
          <View key={ch.field} style={{ gap: space.xs }}>
            <Text style={{ ...type.overline, color: c.textSecondary }}>{ch.field}</Text>
            <View style={{ backgroundColor: c.fill, borderRadius: radius.m, ...smooth, padding: space.m }}>
              <Text selectable style={{ ...type.subhead, color: c.textSecondary }}>{same ? ch.before : before}</Text>
            </View>
            <View style={{ backgroundColor: c.accentFill, borderRadius: radius.m, ...smooth, padding: space.m }}>
              <Text selectable style={{ ...type.subhead, color: c.text }}>{same ? ch.after : after}</Text>
            </View>
          </View>
        );
      })}
      {proposal.skipped ? (
        <Text style={{ ...type.footnote, color: c.textSecondary }}>
          {proposal.skipped === 1 ? 'Claude also suggested a change' : `Claude also suggested ${proposal.skipped} changes`} that would have dropped or added a recording or image, so {proposal.skipped === 1 ? 'it was' : 'they were'} left out.
        </Text>
      ) : null}
    </>
  );
}
