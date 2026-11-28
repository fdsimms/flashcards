import { useEffect, useMemo } from 'react';
import type { Language } from '../../reader/api';
import { recordExtraAnswer } from '../../tools/extrasStorage';
import { drawUnseen } from '../../tools/drillSeen';
import { drillSeenFor, loadDrillSeen, noteDrillAsked } from '../../tools/drillSeenStorage';
import { markList, pickWeighted, recordMark } from '../../tools/marks';
import { loadToolMarks, saveToolMarks, toolMarks } from '../../tools/storage';
import type { ToolId } from '../../tools/tools';

/**
 * A tool's answers in `language` (marks.ts): `mark` records one against its question's patterns,
 * and `pick` draws the next question leaning toward the patterns missed lately, and away from
 * the questions asked lately (drillSeen.ts), so the tool comes round like a shuffled bag.
 * `keyOf` names a question the way the tool's missed-question retry does.
 */
export function useMarks(tool: ToolId, language: Language) {
  useEffect(() => { loadToolMarks(); void loadDrillSeen(); }, []);
  return useMemo(() => {
    const list = markList(tool, language);
    return {
      pick: <T>(draw: () => T, patternsOf: (item: T) => string[], keyOf: (item: T) => string): T => {
        const recent = drillSeenFor(language, tool);
        const picked = pickWeighted(() => drawUnseen(draw, keyOf, recent), patternsOf, toolMarks()[list], Date.now());
        noteDrillAsked(language, tool, keyOf(picked));
        return picked;
      },
      /** `again`: a second mark for a question already counted (Which case's typed form), tallied but not counted twice toward Daily extras. */
      mark: (patterns: string[], right: boolean, again = false) => {
        // Every question counts once toward today's extra for this drill (Daily extras).
        if (!again) recordExtraAnswer(tool, language);
        // After the stored tallies are in, so a mark made while they load isn't overwritten by them.
        loadToolMarks().then(() => saveToolMarks(recordMark(toolMarks(), list, patterns, right, Date.now())));
      },
    };
  }, [tool, language]);
}
