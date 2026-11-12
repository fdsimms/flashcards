import React from 'react';
import type { CommonCount, Settings } from '../reader/api';
import { COMMON_COUNTS, LANGUAGES, commonLabel, commonNamed } from '../reader/languages';
import { Help, Select } from './kit';

/**
 * How many of the current language's most common words count as known, besides its deck
 * (docs/read-and-listen/architecture.md, Languages). Thai counts only its deck, so it has none, and a
 * server older than the setting doesn't send it.
 */
export function CommonWords({ settings, onChange }: { settings: Settings; onChange: (count: CommonCount) => void }) {
  const count = settings.common?.[settings.language];
  if (count === undefined) return null;
  const name = LANGUAGES[settings.language].name;
  return (
    <>
      <Select
        label="Common words counted as known"
        options={COMMON_COUNTS.map(commonLabel)}
        value={commonLabel(count)}
        onChange={(label) => {
          const next = commonNamed(label);
          if (next !== undefined && next !== count) onChange(next);
        }}
      />
      <Help>
        {count === 0
          ? `Only words from your ${name} deck count as known. Choose a number if texts feel too hard to write from the deck alone.`
          : `Texts can use the ${commonLabel(count)} most common ${name} words, in all their forms, as well as your deck. Choose fewer if texts feel too hard. Applies from the next text written.`}
      </Help>
    </>
  );
}
