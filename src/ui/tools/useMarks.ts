import { useEffect, useMemo } from 'react';
import type { Language } from '../../reader/api';
import { markList, pickWeighted, recordMark } from '../../tools/marks';
import { loadToolMarks, saveToolMarks, toolMarks } from '../../tools/storage';
import type { ToolId } from '../../tools/tools';

/**
 * A tool's answers in `language` (marks.ts): `mark` records one against its question's patterns,
 * and `pick` draws the next question leaning toward the patterns missed lately.
 */
export function useMarks(tool: ToolId, language: Language) {
  useEffect(() => { loadToolMarks(); }, []);
  return useMemo(() => {
    const list = markList(tool, language);
    return {
      pick: <T>(draw: () => T, patternsOf: (item: T) => string[]): T => pickWeighted(draw, patternsOf, toolMarks()[list], Date.now()),
      mark: (patterns: string[], right: boolean) => {
        // After the stored tallies are in, so a mark made while they load isn't overwritten by them.
        loadToolMarks().then(() => saveToolMarks(recordMark(toolMarks(), list, patterns, right, Date.now())));
      },
    };
  }, [tool, language]);
}
